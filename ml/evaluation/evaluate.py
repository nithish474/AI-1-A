import os
import sys
import json
import argparse
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from models.bioacoustic_cnn import BioacousticCNN
from training.train import BioacousticDataset
from dataset.manifest import read_manifest

def compute_classification_metrics(y_true: np.ndarray, y_pred: np.ndarray, num_classes: int):
    # Confusion matrix
    cm = np.zeros((num_classes, num_classes), dtype=int)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1

    per_class = {}
    precisions = []
    recalls = []
    f1s = []
    supports = []

    for c in range(num_classes):
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

        per_class[c] = {
            'precision': round(prec, 4),
            'recall': round(rec, 4),
            'f1_score': round(f1, 4),
            'support': support
        }

    total_samples = len(y_true)
    accuracy = float((y_true == y_pred).sum() / max(1, total_samples))

    macro_precision = float(np.mean(precisions))
    macro_recall = float(np.mean(recalls))
    macro_f1 = float(np.mean(f1s))

    total_support = sum(supports)
    weighted_f1 = float(sum(f1 * s for f1, s in zip(f1s, supports)) / max(1, total_support))

    return {
        'accuracy': round(accuracy, 4),
        'macro_precision': round(macro_precision, 4),
        'macro_recall': round(macro_recall, 4),
        'macro_f1': round(macro_f1, 4),
        'weighted_f1': round(weighted_f1, 4),
        'confusion_matrix': cm.tolist(),
        'per_class': per_class
    }

def evaluate_checkpoint(
    checkpoint_path: str = "ml/checkpoints/best_model.pt",
    metadata_path: str = "ml/checkpoints/model_metadata.json",
    manifest_path: str = "ml/data/manifest.csv",
    output_dir: str = "ml/evaluation",
    uncertainty_threshold: float = 0.40
):
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.exists(checkpoint_path) or not os.path.exists(metadata_path):
        raise FileNotFoundError(f"Model checkpoint or metadata not found at {checkpoint_path}")

    with open(metadata_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)

    label_to_idx = meta['label_to_idx']
    idx_to_label = {int(k): v for k, v in meta['idx_to_label'].items()}
    sp_metadata = meta.get('species_metadata', {})
    num_classes = meta['num_classes']

    # Read test split
    records = read_manifest(manifest_path)
    test_records = [r for r in records if r.get('split_group') == 'test' and r.get('validation_status') == 'valid' and r.get('species_id') in label_to_idx]

    if not test_records:
        # Fallback to validation split if test split empty in small sample runs
        print("Notice: 'test' split has 0 examples, evaluating on 'val' split...")
        test_records = [r for r in records if r.get('split_group') == 'val' and r.get('validation_status') == 'valid' and r.get('species_id') in label_to_idx]

    if not test_records:
        raise ValueError("No test or validation recordings found for evaluation!")

    print(f"Evaluating model on {len(test_records)} held-out recordings across {num_classes} classes...")

    # Load model
    model = BioacousticCNN(num_classes=num_classes, in_channels=1)
    state_dict = torch.load(checkpoint_path, map_location='cpu')
    model.load_state_dict(state_dict)
    model.eval()

    test_ds = BioacousticDataset(test_records, label_to_idx, is_training=False)
    test_loader = DataLoader(test_ds, batch_size=4, shuffle=False)

    y_true = []
    y_pred = []
    all_confidences = []
    detailed_predictions = []

    with torch.no_grad():
        for inputs, targets, sp_ids in test_loader:
            outputs = model(inputs)
            probs = F.softmax(outputs, dim=1)
            confidences, preds = torch.max(probs, dim=1)

            for i in range(targets.size(0)):
                true_idx = targets[i].item()
                pred_idx = preds[i].item()
                conf = confidences[i].item()

                y_true.append(true_idx)
                y_pred.append(pred_idx)
                all_confidences.append(conf)

                detailed_predictions.append({
                    'species_id': sp_ids[i],
                    'true_class': idx_to_label[true_idx],
                    'predicted_class': idx_to_label[pred_idx],
                    'model_confidence': round(conf, 4),
                    'is_correct': bool(true_idx == pred_idx),
                    'is_uncertain': bool(conf < uncertainty_threshold)
                })

    metrics = compute_classification_metrics(np.array(y_true), np.array(y_pred), num_classes)

    # Annotate class labels
    annotated_per_class = {}
    for idx_str, cdata in metrics['per_class'].items():
        idx = int(idx_str)
        sp_id = idx_to_label.get(idx, f"class_{idx}")
        info = sp_metadata.get(sp_id, {})
        annotated_per_class[sp_id] = {
            'common_name': info.get('commonName', sp_id),
            'scientific_name': info.get('scientificName', ''),
            **cdata
        }

    # Error analysis: identify common confusion pairs
    cm = np.array(metrics['confusion_matrix'])
    confusion_pairs = []
    for r in range(num_classes):
        for c in range(num_classes):
            if r != c and cm[r, c] > 0:
                confusion_pairs.append({
                    'actual': idx_to_label[r],
                    'predicted': idx_to_label[c],
                    'count': int(cm[r, c])
                })
    confusion_pairs.sort(key=lambda x: x['count'], reverse=True)

    report_data = {
        'model_version': meta.get('model_version', 'cnn-v1.0.0'),
        'evaluation_date': meta.get('created_at'),
        'dataset_size_held_out': len(test_records),
        'num_classes': num_classes,
        'overall_metrics': {
            'accuracy': metrics['accuracy'],
            'macro_precision': metrics['macro_precision'],
            'macro_recall': metrics['macro_recall'],
            'macro_f1': metrics['macro_f1'],
            'weighted_f1': metrics['weighted_f1'],
            'average_confidence': round(float(np.mean(all_confidences)), 4)
        },
        'per_species': annotated_per_class,
        'confusion_matrix': metrics['confusion_matrix'],
        'class_labels': [idx_to_label[i] for i in range(num_classes)],
        'common_confusion_pairs': confusion_pairs[:5],
        'uncertainty_threshold': uncertainty_threshold,
        'detailed_predictions': detailed_predictions
    }

    # Save JSON report
    report_json_path = os.path.join(output_dir, "evaluation_report.json")
    with open(report_json_path, 'w', encoding='utf-8') as f:
        json.dump(report_data, f, indent=2)

    # Save Human-Readable Text Report
    report_txt_path = os.path.join(output_dir, "evaluation_report.txt")
    with open(report_txt_path, 'w', encoding='utf-8') as f:
        f.write("=" * 70 + "\n")
        f.write("BIRDSONG BIOACOUSTICS - CUSTOM CNN EVALUATION REPORT\n")
        f.write("=" * 70 + "\n")
        f.write(f"Model Version: {report_data['model_version']}\n")
        f.write(f"Held-Out Test Samples: {len(test_records)}\n")
        f.write(f"Number of Species Classes: {num_classes}\n")
        f.write("-" * 70 + "\n")
        f.write("OVERALL PERFORMANCE (Held-Out Split):\n")
        f.write(f"  Test Accuracy:     {metrics['accuracy']:.2%}\n")
        f.write(f"  Macro Precision:   {metrics['macro_precision']:.2%}\n")
        f.write(f"  Macro Recall:      {metrics['macro_recall']:.2%}\n")
        f.write(f"  Macro F1-Score:    {metrics['macro_f1']:.4f}\n")
        f.write(f"  Weighted F1-Score: {metrics['weighted_f1']:.4f}\n")
        f.write("-" * 70 + "\n")
        f.write("PER-SPECIES METRICS:\n")
        for sp_id, data in annotated_per_class.items():
            f.write(f"  {data['common_name']} ({sp_id}):\n")
            f.write(f"    Precision: {data['precision']:.2%} | Recall: {data['recall']:.2%} | F1: {data['f1_score']:.4f} | Support: {data['support']}\n")
        f.write("-" * 70 + "\n")
        f.write("TOP CONFUSION PAIRS:\n")
        if confusion_pairs:
            for pair in confusion_pairs[:5]:
                f.write(f"  Actual: {pair['actual']} -> Predicted: {pair['predicted']} ({pair['count']} occurrences)\n")
        else:
            f.write("  No misclassifications detected on test set.\n")
        f.write("=" * 70 + "\n")

    print(f"Evaluation complete! Results saved to {report_json_path} and {report_txt_path}.")
    return report_data

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Evaluate trained bioacoustic CNN on held-out test data")
    parser.add_argument('--checkpoint', default="ml/checkpoints/best_model.pt")
    parser.add_argument('--metadata', default="ml/checkpoints/model_metadata.json")
    parser.add_argument('--manifest', default="ml/data/manifest.csv")
    parser.add_argument('--output-dir', default="ml/evaluation")
    args = parser.parse_args()

    evaluate_checkpoint(
        checkpoint_path=args.checkpoint,
        metadata_path=args.metadata,
        manifest_path=args.manifest,
        output_dir=args.output_dir
    )
