import os
import sys
import json
import time
import argparse
import hashlib
from typing import Dict, List, Tuple
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# Ensure local imports work
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from models.bioacoustic_cnn import BioacousticCNN
from training.audio_transforms import (
    load_audio_mono,
    pad_or_crop_audio,
    compute_mel_spectrogram,
    augment_audio,
    SAMPLE_RATE,
    DURATION_SECONDS,
    TARGET_SAMPLES,
    N_MELS,
    N_FFT,
    HOP_LENGTH,
    F_MIN,
    F_MAX
)
from dataset.manifest import read_manifest

class BioacousticDataset(Dataset):
    def __init__(self, records: List[Dict], label_to_idx: Dict[str, int], is_training: bool = False):
        self.records = records
        self.label_to_idx = label_to_idx
        self.is_training = is_training

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx):
        rec = self.records[idx]
        fpath = rec['file_path']
        sp_id = rec['species_id']
        label = self.label_to_idx[sp_id]

        try:
            audio = load_audio_mono(fpath, sr=SAMPLE_RATE)
            if self.is_training:
                # Random window offset during training
                offset = np.random.uniform(0.0, 1.0)
                audio = pad_or_crop_audio(audio, TARGET_SAMPLES, offset_ratio=offset)
                audio = augment_audio(audio)
            else:
                # Center crop / deterministic window for val/test
                audio = pad_or_crop_audio(audio, TARGET_SAMPLES, offset_ratio=0.5)

            mel = compute_mel_spectrogram(audio, sr=SAMPLE_RATE)
            tensor = torch.from_numpy(mel).unsqueeze(0) # (1, n_mels, time_frames)
            return tensor, label, sp_id
        except Exception as e:
            # Fallback for unexpected file corruptions
            zeros = torch.zeros((1, N_MELS, int(np.ceil(TARGET_SAMPLES / HOP_LENGTH)) + 1), dtype=torch.float32)
            return zeros, label, sp_id

def compute_manifest_fingerprint(manifest_path: str) -> str:
    h = hashlib.sha256()
    with open(manifest_path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()[:16]

def train_bioacoustic_cnn(
    manifest_path: str = "ml/data/manifest.csv",
    output_dir: str = "ml/checkpoints",
    epochs: int = 15,
    batch_size: int = 8,
    lr: float = 1e-3,
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

    # Split records
    train_records = [r for r in valid_records if r.get('split_group') == 'train']
    val_records = [r for r in valid_records if r.get('split_group') == 'val']
    test_records = [r for r in valid_records if r.get('split_group') == 'test']

    # Fallback if splits were not assigned yet
    if not train_records:
        train_records = valid_records[:int(len(valid_records) * 0.7)]
        val_records = valid_records[int(len(valid_records) * 0.7):int(len(valid_records) * 0.85)]
        test_records = valid_records[int(len(valid_records) * 0.85):]

    if not val_records:
        val_records = train_records[-max(1, int(len(train_records) * 0.2)):]

    print(f"Dataset summary: {len(species_ids)} classes | {len(train_records)} train, {len(val_records)} val, {len(test_records)} test.")

    # Class weighting to address dataset imbalance
    class_counts = np.zeros(len(species_ids), dtype=np.float32)
    for r in train_records:
        class_counts[label_to_idx[r['species_id']]] += 1
    total_samples = len(train_records)
    class_weights = np.where(class_counts > 0, total_samples / (len(species_ids) * class_counts), 1.0)
    weights_tensor = torch.tensor(class_weights, dtype=torch.float32)

    # Datasets and Loaders
    train_ds = BioacousticDataset(train_records, label_to_idx, is_training=True)
    val_ds = BioacousticDataset(val_records, label_to_idx, is_training=False)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    # Initialize model
    model = BioacousticCNN(num_classes=len(species_ids), in_channels=1, dropout=0.25)
    criterion = nn.CrossEntropyLoss(weight=weights_tensor)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_val_loss = float('inf')
    best_val_acc = 0.0
    history = []
    checkpoint_path = os.path.join(output_dir, "best_model.pt")

    start_time = time.time()
    print("\nStarting training loop on CPU...")

    for epoch in range(1, epochs + 1):
        # Training phase
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for inputs, targets, _ in train_loader:
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

        # Validation phase
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for inputs, targets, _ in val_loader:
                outputs = model(inputs)
                loss = criterion(outputs, targets)
                val_loss += loss.item() * inputs.size(0)
                preds = torch.argmax(outputs, dim=1)
                val_correct += (preds == targets).sum().item()
                val_total += targets.size(0)

        epoch_val_loss = val_loss / max(1, val_total)
        epoch_val_acc = val_correct / max(1, val_total)

        history.append({
            'epoch': epoch,
            'train_loss': round(epoch_train_loss, 4),
            'train_acc': round(epoch_train_acc, 4),
            'val_loss': round(epoch_val_loss, 4),
            'val_acc': round(epoch_val_acc, 4)
        })

        print(f"Epoch {epoch:02d}/{epochs:02d} | Train Loss: {epoch_train_loss:.4f} Acc: {epoch_train_acc:.2%} | Val Loss: {epoch_val_loss:.4f} Acc: {epoch_val_acc:.2%}")

        # Save best model checkpoint
        if epoch_val_loss < best_val_loss or (epoch_val_loss == best_val_loss and epoch_val_acc > best_val_acc):
            best_val_loss = epoch_val_loss
            best_val_acc = epoch_val_acc
            torch.save(model.state_dict(), checkpoint_path)

    training_duration = round(time.time() - start_time, 2)
    print(f"\nTraining completed in {training_duration}s. Best Val Loss: {best_val_loss:.4f}, Best Val Acc: {best_val_acc:.2%}")

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
            'duration_seconds': DURATION_SECONDS,
            'n_mels': N_MELS,
            'n_fft': N_FFT,
            'hop_length': HOP_LENGTH,
            'f_min': F_MIN,
            'f_max': F_MAX
        },
        'best_val_loss': round(best_val_loss, 4),
        'best_val_accuracy': round(best_val_acc, 4),
        'history': history
    }

    with open(os.path.join(output_dir, "model_metadata.json"), 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    with open(os.path.join(output_dir, "label_mapping.json"), 'w', encoding='utf-8') as f:
        json.dump({'label_to_idx': label_to_idx, 'idx_to_label': idx_to_label, 'species_metadata': sp_metadata}, f, indent=2)

    return metadata

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Train custom bioacoustic CNN on CPU")
    parser.add_argument('--manifest', default="ml/data/manifest.csv")
    parser.add_argument('--output-dir', default="ml/checkpoints")
    parser.add_argument('--epochs', type=int, default=15)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    train_bioacoustic_cnn(
        manifest_path=args.manifest,
        output_dir=args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        seed=args.seed
    )
