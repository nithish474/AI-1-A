import os
import sys
import json
import argparse
import hashlib
import time
from typing import Dict, List, Tuple, Any
import numpy as np
import torch
import torch.nn.functional as F

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from models.bioacoustic_cnn import BioacousticCNN
from training.audio_transforms import (
    load_audio_mono,
    slice_audio_windows,
    compute_mel_spectrogram,
    SAMPLE_RATE,
    TARGET_SAMPLES,
    HOP_SAMPLES,
    RMS_SILENCE_THRESHOLD
)
from dataset.manifest import read_manifest

def compute_manifest_fingerprint(manifest_path: str) -> str:
    h = hashlib.sha256()
    with open(manifest_path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()[:16]

def wilson_score_interval(k: int, n: int, confidence: float = 0.95) -> Tuple[float, float]:
    """
    Wilson score interval for binomial proportion with continuity-friendly limits.
    Well-conditioned for small sample sizes (e.g. n = 5).
    """
    if n <= 0:
        return 0.0, 0.0
    # For 95% confidence level, z = 1.95996
    z = 1.95996398454
    p = float(k) / float(n)
    denom = 1.0 + (z * z) / n
    center = (p + (z * z) / (2.0 * n)) / denom
    margin = (z / denom) * np.sqrt((p * (1.0 - p) / n) + ((z * z) / (4.0 * n * n)))
    lower = max(0.0, float(center - margin))
    upper = min(1.0, float(center + margin))
    return round(lower, 4), round(upper, 4)

def evaluate_checkpoint(
    checkpoint_path: str = "ml/checkpoints/best_model.pt",
    metadata_path: str = "ml/checkpoints/model_metadata.json",
    manifest_path: str = "ml/data/manifest.csv",
    output_dir: str = "ml/evaluation",
    uncertainty_threshold: float = 0.40
) -> Dict[str, Any]:
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(f"Model checkpoint not found at {checkpoint_path}")
    if not os.path.exists(metadata_path):
        raise FileNotFoundError(f"Model metadata not found at {metadata_path}")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Dataset manifest not found at {manifest_path}")

    with open(metadata_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)

    label_to_idx = meta['label_to_idx']
    idx_to_label = {int(k): v for k, v in meta['idx_to_label'].items()}
    sp_metadata = meta.get('species_metadata', {})
    num_classes = meta['num_classes']
    model_version = meta.get('model_version', 'cnn-v1.0.0-cpu')

    # Read manifest and extract strictly held-out test records
    records = read_manifest(manifest_path)
    test_records = [
        r for r in records
        if r.get('split_group') == 'test'
        and r.get('validation_status') == 'valid'
        and r.get('species_id') in label_to_idx
    ]

    # Strictly do NOT fall back to validation split
    if not test_records:
        raise ValueError(
            "Evaluation failed: No valid recordings found in 'test' split. "
            "Held-out evaluation requires designated test recordings."
        )

    print(f"\nEvaluating model checkpoint on {len(test_records)} held-out TEST recordings...")
    print(f"Checkpoint: {checkpoint_path}")

    # Load model
    device = torch.device('cpu')
    model = BioacousticCNN(num_classes=num_classes, in_channels=1).to(device)
    state_dict = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(state_dict)
    model.eval()

    detailed_predictions = []
    rec_true = []
    rec_pred = []
    rec_top2 = []
    total_test_windows = 0
    window_correct = 0

    # Process every held-out recording
    for r in test_records:
        rec_id = r['recording_id']
        fpath = r['file_path']
        sp_id = r['species_id']
        true_idx = label_to_idx[sp_id]

        if not os.path.exists(fpath):
            raise FileNotFoundError(f"Test audio file not found: {fpath}")

        audio, sr = load_audio_mono(fpath, target_sr=SAMPLE_RATE)
        windows = slice_audio_windows(
            audio,
            sr=sr,
            window_samples=TARGET_SAMPLES,
            hop_samples=HOP_SAMPLES,
            rms_threshold=RMS_SILENCE_THRESHOLD
        )

        if not windows:
            raise RuntimeError(f"No usable audio windows extracted from test recording {rec_id} ({sp_id})")

        total_test_windows += len(windows)

        # Batch compute spectrograms for all windows of this recording
        win_mels = []
        for w_audio, _, _ in windows:
            mel = compute_mel_spectrogram(w_audio, sr=SAMPLE_RATE)
            win_mels.append(torch.from_numpy(mel).unsqueeze(0))

        batch_x = torch.stack(win_mels).to(device) # (N_wins, 1, 64, 128)

        with torch.no_grad():
            logits = model(batch_x)
            win_probs = F.softmax(logits, dim=1) # (N_wins, num_classes)

            # Window-level predictions
            win_preds = torch.argmax(win_probs, dim=1).cpu().numpy()
            window_correct += int(np.sum(win_preds == true_idx))

            # Recording-level aggregation: mean of softmax probabilities across all windows
            mean_probs = win_probs.mean(dim=0).cpu().numpy()

        pred_idx = int(np.argmax(mean_probs))
        confidence = float(mean_probs[pred_idx])

        # Top-2 prediction check
        top2_indices = np.argsort(mean_probs)[::-1][:2].tolist()
        is_top2 = bool(true_idx in top2_indices)
        rec_top2.append(is_top2)

        is_correct = bool(true_idx == pred_idx)
        is_uncertain = bool(confidence < uncertainty_threshold)

        rec_true.append(true_idx)
        rec_pred.append(pred_idx)

        prob_dict = {
            idx_to_label[i]: round(float(mean_probs[i]), 4)
            for i in range(num_classes)
        }

        detailed_predictions.append({
            'recording_id': rec_id,
            'species_id': sp_id,
            'common_name': sp_metadata.get(sp_id, {}).get('commonName', sp_id),
            'scientific_name': sp_metadata.get(sp_id, {}).get('scientificName', ''),
            'true_class': idx_to_label[true_idx],
            'predicted_class': idx_to_label[pred_idx],
            'model_confidence': round(confidence, 4),
            'is_correct': is_correct,
            'is_top2': is_top2,
            'is_uncertain': is_uncertain,
            'num_windows': len(windows),
            'class_probabilities': prob_dict
        })

        print(f"  • {rec_id} ({sp_id}): true={idx_to_label[true_idx]} -> pred={idx_to_label[pred_idx]} "
              f"conf={confidence:.2%} correct={is_correct} windows={len(windows)}")

    # 1. Confusion Matrix (Full num_classes x num_classes)
    cm = np.zeros((num_classes, num_classes), dtype=int)
    for t, p in zip(rec_true, rec_pred):
        cm[t, p] += 1

    # 2. Per-class metrics
    per_class = {}
    precisions = []
    recalls = []
    f1s = []
    supports = []

    for c in range(num_classes):
        sp_id = idx_to_label[c]
        info = sp_metadata.get(sp_id, {})
        tp = cm[c, c]
        fp = cm[:, c].sum() - tp
        fn = cm[c, :].sum() - tp
        support = int(cm[c, :].sum())
        supports.append(support)

        prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

        precisions.append(prec)
        recalls.append(rec)
        f1s.append(f1)

        per_class[sp_id] = {
            'common_name': info.get('commonName', sp_id),
            'scientific_name': info.get('scientificName', ''),
            'precision': round(prec, 4),
            'recall': round(rec, 4),
            'f1_score': round(f1, 4),
            'support': support
        }

    # 3. Overall Recording-level metrics
    total_recordings = len(rec_true)
    correct_recordings = sum(t == p for t, p in zip(rec_true, rec_pred))
    rec_accuracy = float(correct_recordings / max(1, total_recordings))

    # 95% Wilson Confidence Interval
    ci_lower, ci_upper = wilson_score_interval(correct_recordings, total_recordings, confidence=0.95)

    macro_prec = float(np.mean(precisions))
    macro_rec = float(np.mean(recalls))
    macro_f1 = float(np.mean(f1s))

    total_supp = sum(supports)
    weighted_f1 = float(sum(f1 * s for f1, s in zip(f1s, supports)) / max(1, total_supp)) if total_supp > 0 else 0.0
    weighted_prec = float(sum(p * s for p, s in zip(precisions, supports)) / max(1, total_supp)) if total_supp > 0 else 0.0
    weighted_rec = float(sum(r * s for r, s in zip(recalls, supports)) / max(1, total_supp)) if total_supp > 0 else 0.0

    # 4. Top-2 & Window-level accuracy
    top2_accuracy = float(np.mean(rec_top2)) if rec_top2 else 0.0
    win_accuracy = float(window_correct / max(1, total_test_windows))

    # 5. Baselines
    random_chance_baseline = round(1.0 / float(num_classes), 4)
    majority_count = max(supports) if supports else 0
    majority_class_baseline = round(float(majority_count) / float(max(1, total_recordings)), 4)

    # 6. Statistical Reliability Flag & Warning
    is_statistically_weak = (total_recordings < 20) or any(s < 3 for s in supports)
    reliability = "low" if is_statistically_weak else "acceptable"

    warnings = []
    if is_statistically_weak:
        warnings.append(
            f"Statistical reliability is LOW: held-out test split contains only {total_recordings} recording(s) "
            f"({min(supports) if supports else 0} to {max(supports) if supports else 0} per species). "
            f"With N={total_recordings}, a single misclassification swings accuracy by {100.0/total_recordings:.1f}%. "
            f"The 95% Wilson confidence interval is wide [{ci_lower*100:.1f}% - {ci_upper*100:.1f}%]. "
            f"To achieve statistically robust evaluation, add at least 15-20 recordings per species."
        )

    # Check if predictions collapsed to a single class
    unique_preds = set(rec_pred)
    if len(unique_preds) == 1 and num_classes > 1:
        collapsed_label = idx_to_label[list(unique_preds)[0]]
        warnings.append(
            f"WARNING: Model collapsed to single class '{collapsed_label}'. All test clips received identical label."
        )

    # 7. Traceability Metadata
    current_manifest_fingerprint = compute_manifest_fingerprint(manifest_path)
    created_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

    report_data = {
        'model_version': model_version,
        'dataset_fingerprint': current_manifest_fingerprint,
        'created_at': created_at,
        'checkpoint_path': checkpoint_path,
        'reliability': reliability,
        'warnings': warnings,
        'test_recordings_count': total_recordings,
        'test_windows_count': total_test_windows,
        'num_classes': num_classes,
        'overall_metrics': {
            'accuracy': round(rec_accuracy, 4),
            'accuracy_ci_95': [ci_lower, ci_upper],
            'macro_precision': round(macro_prec, 4),
            'macro_recall': round(macro_rec, 4),
            'macro_f1': round(macro_f1, 4),
            'weighted_precision': round(weighted_prec, 4),
            'weighted_recall': round(weighted_rec, 4),
            'weighted_f1': round(weighted_f1, 4),
            'top2_accuracy': round(top2_accuracy, 4),
            'window_level_accuracy': round(win_accuracy, 4),
            'average_confidence': round(float(np.mean([d['model_confidence'] for d in detailed_predictions])), 4)
        },
        'baselines': {
            'random_chance': random_chance_baseline,
            'majority_class': majority_class_baseline
        },
        'per_species': per_class,
        'class_labels': [idx_to_label[i] for i in range(num_classes)],
        'confusion_matrix': cm.tolist(),
        'uncertainty_threshold': uncertainty_threshold,
        'detailed_predictions': detailed_predictions
    }

    # Write JSON report
    report_json_path = os.path.join(output_dir, "evaluation_report.json")
    with open(report_json_path, 'w', encoding='utf-8') as f:
        json.dump(report_data, f, indent=2)

    # Write Human-Readable Text Report
    report_txt_path = os.path.join(output_dir, "evaluation_report.txt")
    with open(report_txt_path, 'w', encoding='utf-8') as f:
        f.write("=" * 76 + "\n")
        f.write("BIRDSONG BIOACOUSTICS - HELD-OUT CNN EVALUATION REPORT\n")
        f.write("=" * 76 + "\n")
        f.write(f"Model Version:         {model_version}\n")
        f.write(f"Dataset Fingerprint:   {current_manifest_fingerprint}\n")
        f.write(f"Evaluation Timestamp:  {created_at}\n")
        f.write(f"Evaluated Checkpoint:  {checkpoint_path}\n")
        f.write(f"Statistical Rigor:     {reliability.upper()}\n")
        f.write(f"Test Recordings:       {total_recordings} held-out recordings\n")
        f.write(f"Test Audio Windows:    {total_test_windows} (3.0s windows, hop 1.5s)\n")
        f.write(f"Species Classes:       {num_classes}\n")
        f.write("-" * 76 + "\n")
        f.write("OVERALL PERFORMANCE (Recording-Level Aggregation):\n")
        f.write(f"  Accuracy:            {rec_accuracy:.2%} (95% Wilson CI: [{ci_lower:.2%}, {ci_upper:.2%}])\n")
        f.write(f"  Macro Precision:     {macro_prec:.2%}\n")
        f.write(f"  Macro Recall:        {macro_rec:.2%}\n")
        f.write(f"  Macro F1-Score:      {macro_f1:.4f}\n")
        f.write(f"  Weighted F1-Score:   {weighted_f1:.4f}\n")
        f.write(f"  Top-2 Accuracy:      {top2_accuracy:.2%}\n")
        f.write(f"  Window Accuracy:     {win_accuracy:.2%} ({window_correct}/{total_test_windows} windows)\n")
        f.write("-" * 76 + "\n")
        f.write("BASELINES FOR COMPARISON:\n")
        f.write(f"  Random Chance:       {random_chance_baseline:.2%}\n")
        f.write(f"  Majority Class:      {majority_class_baseline:.2%}\n")
        f.write("-" * 76 + "\n")
        if warnings:
            f.write("STATISTICAL WARNINGS:\n")
            for w in warnings:
                f.write(f"  ! {w}\n")
            f.write("-" * 76 + "\n")
        f.write("PER-SPECIES METRICS (Held-Out Support):\n")
        f.write(f"  {'Species ID':<26} | {'Precision':<10} | {'Recall':<8} | {'F1':<7} | {'Support'}\n")
        f.write("  " + "-" * 70 + "\n")
        for sp_id, data in per_class.items():
            f.write(f"  {sp_id:<26} | {data['precision']:<10.2%} | {data['recall']:<8.2%} | {data['f1_score']:<7.4f} | {data['support']}\n")
        f.write("-" * 76 + "\n")
        f.write("FULL CONFUSION MATRIX (Rows: Actual, Columns: Predicted):\n")
        col_header = "Actual \\ Pred"
        hdr = "  " + f"{col_header:<24} " + " ".join([f"{idx_to_label[c][:5]:>6}" for c in range(num_classes)])
        f.write(hdr + "\n")
        for r_idx in range(num_classes):
            row_str = "  " + f"{idx_to_label[r_idx]:<24} " + " ".join([f"{cm[r_idx, c]:>6d}" for c in range(num_classes)])
            f.write(row_str + "\n")
        f.write("-" * 76 + "\n")
        f.write("PER-RECORDING PREDICTIONS:\n")
        for d in detailed_predictions:
            mark = "✓" if d['is_correct'] else "✗"
            f.write(f"  [{mark}] {d['recording_id']:<14} ({d['true_class']}): "
                    f"predicted={d['predicted_class']} (conf: {d['model_confidence']:.2%}, windows: {d['num_windows']})\n")
        f.write("=" * 76 + "\n")

    print(f"\nEvaluation successfully written to:\n  • {report_json_path}\n  • {report_txt_path}")
    print(f"Test Accuracy: {rec_accuracy:.2%} (95% CI: [{ci_lower:.2%}, {ci_upper:.2%}]) | Reliability: {reliability}")
    return report_data

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Evaluate trained bioacoustic CNN on held-out test data")
    parser.add_argument('--checkpoint', default="ml/checkpoints/best_model.pt")
    parser.add_argument('--metadata', default="ml/checkpoints/model_metadata.json")
    parser.add_argument('--manifest', default="ml/data/manifest.csv")
    parser.add_argument('--output-dir', default="ml/evaluation")
    parser.add_argument('--uncertainty', type=float, default=0.40)
    args = parser.parse_args()

    evaluate_checkpoint(
        checkpoint_path=args.checkpoint,
        metadata_path=args.metadata,
        manifest_path=args.manifest,
        output_dir=args.output_dir,
        uncertainty_threshold=args.uncertainty
    )
