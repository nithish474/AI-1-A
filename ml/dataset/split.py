import os
import re
import sys
import html
import random
import argparse
from typing import List, Dict, Set, Tuple
from manifest import load_manifest, save_manifest, ManifestRecord

def extract_group_key(record: ManifestRecord) -> str:
    """
    Groups recordings by (recordist + rounded lat/lng) parsed from the `location` column.
    Falls back to recording ID / source_recording_id when location cannot be parsed.
    """
    loc = getattr(record, 'location', '') or ''
    rec_id = getattr(record, 'recording_id', '') or ''
    src_id = getattr(record, 'source_recording_id', '') or rec_id

    if not loc:
        return src_id or rec_id

    loc_clean = html.unescape(loc).strip()

    # 1. Parse recordist name
    recordist_match = re.search(r'Recordist:\s*([^)]+)', loc_clean, re.IGNORECASE)
    recordist = recordist_match.group(1).strip().lower() if recordist_match else ""

    # 2. Parse latitude and longitude
    lat_match = re.search(r'Lat:\s*([+-]?\d+(?:\.\d+)?)', loc_clean, re.IGNORECASE)
    lng_match = re.search(r'Lng:\s*([+-]?\d+(?:\.\d+)?)', loc_clean, re.IGNORECASE)

    if lat_match and lng_match and recordist:
        try:
            lat_rnd = round(float(lat_match.group(1)), 2)
            lng_rnd = round(float(lng_match.group(1)), 2)
            return f"{recordist}_{lat_rnd:.2f}_{lng_rnd:.2f}"
        except Exception:
            pass
    elif recordist:
        loc_prefix = loc_clean.split('(')[0].strip().lower()
        loc_prefix_clean = re.sub(r'[^a-z0-9]+', '_', loc_prefix).strip('_')
        return f"{recordist}_{loc_prefix_clean or 'loc'}"

    # Fallback to source recording ID or recording ID
    return src_id or rec_id

def split_dataset_stratified(
    records: List[ManifestRecord],
    train_ratio: float = 0.6,
    val_ratio: float = 0.2,
    test_ratio: float = 0.2,
    seed: int = 42,
    incremental: bool = True
) -> List[ManifestRecord]:
    """
    Performs reproducible stratified splitting grouped by (recordist + rounded lat/lng).
    When incremental=True, existing assigned splits ('train', 'val', 'test') are preserved,
    preventing held-out test set leakage and avoiding churn on previously assigned recordings.
    Guarantee every species with 3 or more recordings has at least 1 recording in each split,
    and logs a clear warning for species with fewer than 3.
    """
    random.seed(seed)

    # 1. Mark non-valid records as unassigned
    for r in records:
        if r.validation_status != "valid":
            r.split_group = "unassigned"

    valid_records = [r for r in records if r.validation_status == "valid"]

    # 2. Group by species
    species_map: Dict[str, List[ManifestRecord]] = {}
    for r in valid_records:
        species_map.setdefault(r.species_id, []).append(r)

    target_splits = ["train", "val", "test"]

    for sp_id, sp_records in species_map.items():
        total_count = len(sp_records)
        if total_count < 3:
            print(f"Warning: Species '{sp_id}' has {total_count} recordings (< 3); cannot guarantee coverage across train/val/test splits.")

        # Group recordings by acoustic group key
        group_to_records: Dict[str, List[ManifestRecord]] = {}
        for r in sp_records:
            gk = extract_group_key(r)
            group_to_records.setdefault(gk, []).append(r)

        if incremental:
            # Check which groups already have split assignments from existing records
            group_assigned_split: Dict[str, str] = {}
            unassigned_groups: Dict[str, List[ManifestRecord]] = {}

            for gk, grecs in group_to_records.items():
                existing_assigned = [r.split_group for r in grecs if r.split_group in target_splits]
                if existing_assigned:
                    split_choice = existing_assigned[0]
                    group_assigned_split[gk] = split_choice
                    # Assign ONLY previously unassigned records in this group to the same split!
                    for r in grecs:
                        if r.split_group not in target_splits:
                            r.split_group = split_choice
                else:
                    unassigned_groups[gk] = grecs

            # Count current distribution for this species
            split_counts = {
                "train": sum(1 for r in sp_records if r.split_group == "train"),
                "val": sum(1 for r in sp_records if r.split_group == "val"),
                "test": sum(1 for r in sp_records if r.split_group == "test")
            }

            # Assign unassigned groups
            for gk, grecs in unassigned_groups.items():
                # If species has >= 3 recordings, guarantee at least 1 in each split first
                if total_count >= 3:
                    empty_splits = [s for s in target_splits if split_counts[s] == 0]
                    if empty_splits:
                        chosen_split = empty_splits[0]
                    else:
                        # Balance according to ratios: train 60%, val 20%, test 20%
                        weights = {"train": train_ratio, "val": val_ratio, "test": test_ratio}
                        chosen_split = min(
                            target_splits,
                            key=lambda s: split_counts[s] / max(weights[s], 0.01)
                        )
                else:
                    # For species < 3, assign train first, then test
                    if split_counts["train"] == 0:
                        chosen_split = "train"
                    elif split_counts["test"] == 0:
                        chosen_split = "test"
                    else:
                        chosen_split = "train"

                for r in grecs:
                    if r.split_group not in target_splits:
                        r.split_group = chosen_split
                split_counts[chosen_split] += len(grecs)

        else:
            # Fresh stratified splitting (only when incremental is False)
            group_keys = list(group_to_records.keys())
            random.shuffle(group_keys)
            split_counts = {"train": 0, "val": 0, "test": 0}

            # Ensure every split gets at least 1 group if >= 3 groups
            if len(group_keys) >= 3:
                for i, s in enumerate(target_splits):
                    for r in group_to_records[group_keys[i]]:
                        r.split_group = s
                    split_counts[s] += len(group_to_records[group_keys[i]])

                remaining_keys = group_keys[3:]
                weights = {"train": train_ratio, "val": val_ratio, "test": test_ratio}
                for gk in remaining_keys:
                    chosen_split = min(
                        target_splits,
                        key=lambda s: split_counts[s] / max(weights[s], 0.01)
                    )
                    for r in group_to_records[gk]:
                        r.split_group = chosen_split
                    split_counts[chosen_split] += len(group_to_records[gk])
            else:
                for i, gk in enumerate(group_keys):
                    s = "train" if i == 0 else "test"
                    for r in group_to_records[gk]:
                        r.split_group = s

    return records

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stratify bird recording dataset into train/val/test splits")
    parser.add_argument("--manifest", default="ml/data/manifest.csv", help="Path to manifest CSV")
    parser.add_argument("--force-fresh", action="store_true", help="Force fresh reshuffle instead of incremental split")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    args = parser.parse_args()

    manifest_path = args.manifest
    if os.path.exists(manifest_path):
        recs = load_manifest(manifest_path)
        updated = split_dataset_stratified(
            recs,
            seed=args.seed,
            incremental=not args.force_fresh
        )
        save_manifest(updated, manifest_path)
        train_n = sum(1 for r in updated if r.split_group == "train")
        val_n = sum(1 for r in updated if r.split_group == "val")
        test_n = sum(1 for r in updated if r.split_group == "test")
        print(f"Successfully stratified {len(updated)} recordings: {train_n} train / {val_n} val / {test_n} test.")
    else:
        print(f"Manifest not found at {manifest_path}")
