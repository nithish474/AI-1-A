import os
import random
from typing import List, Dict
from manifest import load_manifest, save_manifest, ManifestRecord

def split_dataset_stratified(
    records: List[ManifestRecord],
    train_ratio: float = 0.6,
    val_ratio: float = 0.2,
    test_ratio: float = 0.2,
    seed: int = 42
) -> List[ManifestRecord]:
    """
    Performs reproducible, session-grouped stratified splitting.
    Crucial requirement: All recordings sharing the same `source_recording_id`
    are grouped into the same split to prevent acoustic leakage between train/val/test.
    """
    random.seed(seed)

    # 1. Group records by species, then by source_recording_id (sessions)
    species_sessions: Dict[str, Dict[str, List[ManifestRecord]]] = {}
    for r in records:
        if r.validation_status != "valid":
            r.split_group = "unassigned"
            continue
        species_sessions.setdefault(r.species_id, {}).setdefault(r.source_recording_id, []).append(r)

    # 2. Assign entire sessions to splits per species
    for sp_id, sessions_dict in species_sessions.items():
        session_keys = list(sessions_dict.keys())
        random.shuffle(session_keys)
        n_sessions = len(session_keys)

        if n_sessions == 1:
            # Single session defaults to train
            for r in sessions_dict[session_keys[0]]:
                r.split_group = "train"
        elif n_sessions == 2:
            # 1 train, 1 test
            for r in sessions_dict[session_keys[0]]:
                r.split_group = "train"
            for r in sessions_dict[session_keys[1]]:
                r.split_group = "test"
        else:
            n_test = max(1, round(n_sessions * test_ratio))
            n_val = max(1, round(n_sessions * val_ratio))
            n_train = max(1, n_sessions - n_test - n_val)

            test_keys = set(session_keys[:n_test])
            val_keys = set(session_keys[n_test:n_test + n_val])
            train_keys = set(session_keys[n_test + n_val:])

            for sess_k, recs in sessions_dict.items():
                if sess_k in test_keys:
                    grp = "test"
                elif sess_k in val_keys:
                    grp = "val"
                else:
                    grp = "train"
                for r in recs:
                    r.split_group = grp

    return records

if __name__ == "__main__":
    manifest_path = "ml/data/manifest.csv"
    if os.path.exists(manifest_path):
        recs = load_manifest(manifest_path)
        updated = split_dataset_stratified(recs)
        save_manifest(updated, manifest_path)
        print(f"Successfully stratified {len(updated)} recordings across train/val/test.")
    else:
        print(f"Manifest not found at {manifest_path}")
