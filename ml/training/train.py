import os
import sys
import json
import time
import argparse
import hashlib
from typing import Dict, List, Tuple, Optional
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

# Ensure local imports work
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from models.bioacoustic_cnn import BioacousticCNN
from training.audio_transforms import (
    load_audio_mono,
    slice_audio_windows,
    compute_mel_spectrogram,
    augment_audio,
    apply_spec_augment,
    SAMPLE_RATE,
    TARGET_DURATION,
    TARGET_SAMPLES,
    HOP_DURATION,
    HOP_SAMPLES,
    RMS_SILENCE_THRESHOLD,
    N_MELS,
    N_FFT,
    HOP_LENGTH,
    F_MIN,
    F_MAX
)
from dataset.manifest import read_manifest

class BioacousticWindowDataset(Dataset):
    """
    Dataset of windowed audio segments.
    Each item is a window with its recording_id, species_id, and class index.
    Errors are raised/logged explicitly; no silent zero-tensor fallbacks.
    """
    def __init__(
        self,
        windows: List[Dict],
        is_training: bool = False
    ):
        self.windows = windows
        self.is_training = is_training

    def __len__(self):
        return len(self.windows)

    def __getitem__(self, idx):
        item = self.windows[idx]
        raw_audio = item['audio_samples']
        label = item['label']
        sp_id = item['species_id']
        rec_id = item['recording_id']

        try:
            audio = raw_audio.copy()
            if self.is_training:
                audio = augment_audio(audio)

            mel = compute_mel_spectrogram(audio, sr=SAMPLE_RATE)

            if self.is_training:
                mel = apply_spec_augment(mel, max_freq_mask=8, max_time_mask=16)

            tensor = torch.from_numpy(mel).unsqueeze(0).float() # (1, N_MELS, TIME_FRAMES)
            return tensor, label, sp_id, rec_id
        except Exception as e:
            raise RuntimeError(f"Failed to process window {idx} from recording {rec_id} ({sp_id}): {e}")

def compute_manifest_fingerprint(manifest_path: str) -> str:
    h = hashlib.sha256()
    with open(manifest_path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()[:16]

def extract_split_windows(
    records: List[Dict],
    label_to_idx: Dict[str, int],
    split_name: str
) -> Tuple[List[Dict], Dict[str, List[Dict]], int]:
    """
    Extracts overlapping 3.0s windows (hop 1.5s) from each recording in the split.
    Drops near-silent windows where RMS < threshold.
    Returns:
      - flat list of all windows
      - windows grouped by recording_id
      - number of dropped silent windows
    """
    all_windows = []
    by_recording = {}
    dropped_count = 0

    print(f"\nExtracting windowed audio for '{split_name}' split ({len(records)} recordings)...")
    for r in records:
        rec_id = r['recording_id']
        fpath = r['file_path']
        sp_id = r['species_id']
        label = label_to_idx[sp_id]

        if not os.path.exists(fpath):
            raise FileNotFoundError(f"Recording audio file not found: {fpath}")

        audio, sr = load_audio_mono(fpath, target_sr=SAMPLE_RATE)
        raw_windows = slice_audio_windows(
            audio,
            sr=sr,
            window_samples=TARGET_SAMPLES,
            hop_samples=HOP_SAMPLES,
            rms_threshold=RMS_SILENCE_THRESHOLD
        )

        # Count dropped candidate windows
        n_samples = len(audio)
        potential_windows = 1 if n_samples <= TARGET_SAMPLES else (n_samples - TARGET_SAMPLES) // HOP_SAMPLES + 1
        dropped = max(0, potential_windows - len(raw_windows))
        dropped_count += dropped

        rec_windows = []
        for win_idx, (win_audio, start_sample, win_rms) in enumerate(raw_windows):
            win_obj = {
                'recording_id': rec_id,
                'species_id': sp_id,
                'label': label,
                'window_idx': win_idx,
                'start_sample': start_sample,
                'rms': win_rms,
                'audio_samples': win_audio
            }
            all_windows.append(win_obj)
            rec_windows.append(win_obj)

        by_recording[rec_id] = rec_windows
        print(f"  • [{split_name}] {rec_id} ({sp_id}): {len(rec_windows)} windows kept ({dropped} silent dropped)")

    print(f"Total '{split_name}' windows: {len(all_windows)} (total silent dropped: {dropped_count})")
    return all_windows, by_recording, dropped_count

def evaluate_recording_level(
    model: nn.Module,
    rec_windows_map: Dict[str, List[Dict]],
    num_classes: int,
    criterion: nn.Module,
    device: torch.device
) -> Tuple[float, float, float, Dict]:
    """
    Evaluates recording-level predictions by averaging softmax probabilities across all windows of each recording.
    Returns: (val_loss, window_accuracy, recording_macro_f1, recording_metrics)
    """
    model.eval()
    total_loss = 0.0
    total_window_correct = 0
    total_windows = 0

    rec_true = []
    rec_pred = []

    with torch.no_grad():
        for rec_id, wins in rec_windows_map.items():
            if not wins:
                continue

            rec_label = wins[0]['label']
            win_mels = []
            for w in wins:
                mel = compute_mel_spectrogram(w['audio_samples'], sr=SAMPLE_RATE)
                win_mels.append(torch.from_numpy(mel).unsqueeze(0))

            batch_x = torch.stack(win_mels).to(device) # (N_wins, 1, 64, 128)
            batch_y = torch.full((len(wins),), rec_label, dtype=torch.long).to(device)

            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            total_loss += loss.item() * len(wins)
            total_windows += len(wins)

            # Window accuracy
            win_preds = torch.argmax(logits, dim=1)
            total_window_correct += (win_preds == batch_y).sum().item()

            # Recording-level aggregation: average softmax probabilities
            probs = F.softmax(logits, dim=1).mean(dim=0)
            pred_class = int(torch.argmax(probs).item())

            rec_true.append(rec_label)
            rec_pred.append(pred_class)

    mean_loss = total_loss / max(1, total_windows)
    window_acc = total_window_correct / max(1, total_windows)

    # Compute recording-level confusion matrix & macro-F1
    cm = np.zeros((num_classes, num_classes), dtype=int)
    for t, p in zip(rec_true, rec_pred):
        cm[t, p] += 1

    f1_list = []
    classes_evaluated = 0
    for c in range(num_classes):
        tp = cm[c, c]
        fp = cm[:, c].sum() - tp
        fn = cm[c, :].sum() - tp
        support = int(cm[c, :].sum())

        if support > 0:
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
            f1_list.append(f1)
            classes_evaluated += 1

    rec_macro_f1 = float(np.mean(f1_list)) if f1_list else 0.0
    rec_acc = float(np.mean([t == p for t, p in zip(rec_true, rec_pred)])) if rec_true else 0.0

    return mean_loss, window_acc, rec_macro_f1, {
        'recording_accuracy': round(rec_acc, 4),
        'recording_macro_f1': round(rec_macro_f1, 4),
        'recordings_count': len(rec_true)
    }

def train_bioacoustic_cnn(
    manifest_path: str = "ml/data/manifest.csv",
    output_dir: str = "ml/checkpoints",
    epochs: int = 35,
    batch_size: int = 16,
    lr: float = 1e-3,
    min_epochs_for_best: int = 5,
    patience: int = 8,
    seed: int = 42,
    num_threads: int = 4
):
    torch.manual_seed(seed)
    np.random.seed(seed)
    torch.set_num_threads(num_threads)
    os.makedirs(output_dir, exist_ok=True)

    records = read_manifest(manifest_path)
    valid_records = [r for r in records if r.get('validation_status') == 'valid' and os.path.exists(r.get('file_path', ''))]

    if not valid_records:
        raise ValueError("No valid recordings with existing files found in manifest!")

    # Distinct species list
    species_ids = sorted(list(set(r['species_id'] for r in valid_records)))
    label_to_idx = {sp: idx for idx, sp in enumerate(species_ids)}
    idx_to_label = {idx: sp for sp, idx in label_to_idx.items()}

    # Species metadata mapping
    sp_metadata = {}
    for r in valid_records:
        sp_id = r['species_id']
        if sp_id not in sp_metadata:
            sp_metadata[sp_id] = {
                'commonName': r.get('common_name', sp_id),
                'scientificName': r.get('scientific_name', '')
            }

    # Split records strictly at recording level
    train_records = [r for r in valid_records if r.get('split_group') == 'train']
    val_records = [r for r in valid_records if r.get('split_group') == 'val']
    test_records = [r for r in valid_records if r.get('split_group') == 'test']

    if not train_records:
        raise ValueError("No train split recordings found!")
    if not val_records:
        raise ValueError("No validation split recordings found!")

    print(f"Dataset split summary (Recordings): {len(species_ids)} classes | {len(train_records)} train, {len(val_records)} val, {len(test_records)} test.")
    print("NOTE: Test recordings are strictly held-out and NEVER accessed during training or model selection.")

    # 1. Window extraction for train and val splits
    train_windows, train_rec_map, train_dropped = extract_split_windows(train_records, label_to_idx, 'train')
    val_windows, val_rec_map, val_dropped = extract_split_windows(val_records, label_to_idx, 'val')

    if len(train_windows) == 0:
        raise ValueError("No valid training windows extracted!")

    # 2. Compute class weights from window distribution to prevent majority collapse
    class_window_counts = np.zeros(len(species_ids), dtype=np.float32)
    for w in train_windows:
        class_window_counts[w['label']] += 1

    print("\nTrain window distribution per class:")
    for idx, sp in enumerate(species_ids):
        print(f"  {sp} ({idx}): {int(class_window_counts[idx])} windows")

    total_windows = len(train_windows)
    # Balanced weights: total / (num_classes * count)
    class_weights = np.where(
        class_window_counts > 0,
        total_windows / (len(species_ids) * np.maximum(class_window_counts, 1.0)),
        1.0
    )
    # Smooth extreme weights to avoid instability
    class_weights = np.clip(class_weights, 0.2, 5.0)
    weights_tensor = torch.tensor(class_weights, dtype=torch.float32)
    print(f"Computed normalized class weights: {np.round(class_weights, 3).tolist()}")

    # 3. Create Datasets and DataLoaders
    train_ds = BioacousticWindowDataset(train_windows, is_training=True)
    train_loader = DataLoader(
        train_ds,
        batch_size=batch_size,
        shuffle=True,
        drop_last=False
    )

    # 4. Model, Loss, Optimizer, and Warmup + Cosine Scheduler
    device = torch.device('cpu')
    model = BioacousticCNN(num_classes=len(species_ids), in_channels=1).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights_tensor.to(device))
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)

    # Short warmup (3 epochs) followed by Cosine Annealing
    warmup_epochs = 3
    def lr_lambda(epoch: int) -> float:
        if epoch < warmup_epochs:
            return float(epoch + 1) / float(warmup_epochs)
        progress = float(epoch - warmup_epochs) / float(max(1, epochs - warmup_epochs))
        return 0.5 * (1.0 + np.cos(np.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda=lr_lambda)

    best_val_macro_f1 = -1.0
    best_val_loss = float('inf')
    best_epoch = -1
    epochs_without_improvement = 0
    history = []
    checkpoint_path = os.path.join(output_dir, "best_model.pt")

    start_time = time.time()
    print(f"\nStarting training loop on CPU (Target Epochs: {epochs}, Patience: {patience}, Min Epoch for Best: {min_epochs_for_best})...")
    print("-" * 88)
    print(f"{'Epoch':<7} | {'Train Loss':<10} {'Train Acc':<10} | {'Val Loss':<10} {'Val WinAcc':<11} {'Val RecF1':<10} | {'Status'}")
    print("-" * 88)

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for inputs, targets, _, _ in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * inputs.size(0)
            preds = torch.argmax(outputs, dim=1)
            train_correct += (preds == targets).sum().item()
            train_total += targets.size(0)

        scheduler.step()
        epoch_train_loss = train_loss / max(1, train_total)
        epoch_train_acc = train_correct / max(1, train_total)

        # Validation phase: recording-level aggregated evaluation
        val_loss, val_win_acc, val_rec_macro_f1, val_meta = evaluate_recording_level(
            model=model,
            rec_windows_map=val_rec_map,
            num_classes=len(species_ids),
            criterion=criterion,
            device=device
        )

        # Checkpoint selection logic:
        # Best model selected strictly by validation MACRO-F1 at recording level (tie-break by val loss)
        # Never accept a checkpoint from before epoch 5 unless nothing else exists.
        is_best = False
        if epoch >= min_epochs_for_best:
            if val_rec_macro_f1 > best_val_macro_f1:
                is_best = True
            elif val_rec_macro_f1 == best_val_macro_f1 and val_loss < best_val_loss:
                is_best = True

        status_str = ""
        if is_best:
            best_val_macro_f1 = val_rec_macro_f1
            best_val_loss = val_loss
            best_epoch = epoch
            epochs_without_improvement = 0
            torch.save(model.state_dict(), checkpoint_path)
            status_str = f"★ Best Model (Rec F1: {val_rec_macro_f1:.4f})"
        else:
            if epoch >= min_epochs_for_best:
                epochs_without_improvement += 1
            if epoch < min_epochs_for_best:
                status_str = "(warmup/eval)"
            else:
                status_str = f"(no gain: {epochs_without_improvement}/{patience})"

        history.append({
            'epoch': epoch,
            'train_loss': round(epoch_train_loss, 4),
            'train_acc': round(epoch_train_acc, 4),
            'val_loss': round(val_loss, 4),
            'val_acc': round(val_win_acc, 4),
            'val_rec_macro_f1': round(val_rec_macro_f1, 4),
            'is_best': is_best
        })

        print(f"Epoch {epoch:02d} | {epoch_train_loss:<10.4f} {epoch_train_acc:<10.2%} | {val_loss:<10.4f} {val_win_acc:<11.2%} {val_rec_macro_f1:<10.4f} | {status_str}")

        # Early stopping trigger after patience exceeded past min_epochs_for_best
        if epochs_without_improvement >= patience and epoch >= min_epochs_for_best + patience:
            print(f"\nEarly stopping triggered at epoch {epoch}. No validation improvement for {patience} epochs.")
            break

    # If no checkpoint saved past min_epochs (e.g. constant val score), save current state
    if best_epoch == -1:
        best_epoch = epochs
        best_val_macro_f1 = val_rec_macro_f1
        best_val_loss = val_loss
        torch.save(model.state_dict(), checkpoint_path)
        print(f"Note: Saved final epoch {epochs} checkpoint as fallback.")

    training_duration = round(time.time() - start_time, 2)
    print("-" * 88)
    print(f"Training completed in {training_duration}s.")
    print(f"Selected Best Checkpoint: Epoch {best_epoch} | Val Rec Macro-F1: {best_val_macro_f1:.4f} | Val Loss: {best_val_loss:.4f}")

    # Save model metadata
    metadata = {
        'model_version': 'cnn-v1.0.0-cpu',
        'architecture': 'BioacousticCNN-4Block',
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'training_duration_seconds': training_duration,
        'dataset_fingerprint': compute_manifest_fingerprint(manifest_path),
        'num_classes': len(species_ids),
        'species_ids': species_ids,
        'label_to_idx': label_to_idx,
        'idx_to_label': idx_to_label,
        'species_metadata': sp_metadata,
        'preprocessing': {
            'sample_rate': SAMPLE_RATE,
            'duration_seconds': TARGET_DURATION,
            'hop_seconds': HOP_DURATION,
            'rms_silence_threshold': RMS_SILENCE_THRESHOLD,
            'n_mels': N_MELS,
            'n_fft': N_FFT,
            'hop_length': HOP_LENGTH,
            'f_min': F_MIN,
            'f_max': F_MAX
        },
        'best_epoch': best_epoch,
        'best_val_loss': round(best_val_loss, 4),
        'best_val_macro_f1': round(best_val_macro_f1, 4),
        'total_train_windows': len(train_windows),
        'total_val_windows': len(val_windows),
        'history': history
    }

    with open(os.path.join(output_dir, "model_metadata.json"), 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    with open(os.path.join(output_dir, "label_mapping.json"), 'w', encoding='utf-8') as f:
        json.dump({'label_to_idx': label_to_idx, 'idx_to_label': idx_to_label, 'species_metadata': sp_metadata}, f, indent=2)

    return metadata

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Train custom bioacoustic CNN on CPU with windowed recordings")
    parser.add_argument('--manifest', default="ml/data/manifest.csv")
    parser.add_argument('--output-dir', default="ml/checkpoints")
    parser.add_argument('--epochs', type=int, default=35)
    parser.add_argument('--batch-size', type=int, default=16)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--patience', type=int, default=8)
    args = parser.parse_args()

    train_bioacoustic_cnn(
        manifest_path=args.manifest,
        output_dir=args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        seed=args.seed,
        patience=args.patience
    )
