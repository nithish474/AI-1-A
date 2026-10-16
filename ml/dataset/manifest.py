import os
import csv
import json
from dataclasses import dataclass, asdict, field
from typing import List, Dict, Optional, Tuple

MANIFEST_COLUMNS = [
    "recording_id",
    "file_path",
    "species_id",
    "common_name",
    "scientific_name",
    "source",
    "source_recording_id",
    "recording_date",
    "location",
    "license",
    "duration",
    "sample_rate",
    "channels",
    "validation_status",
    "split_group"
]

@dataclass
class ManifestRecord:
    recording_id: str
    file_path: str
    species_id: str
    common_name: str
    scientific_name: str
    source: str
    source_recording_id: str
    recording_date: str = ""
    location: str = ""
    license: str = "CC BY-SA 4.0"
    duration: float = 0.0
    sample_rate: int = 16000
    channels: int = 1
    validation_status: str = "valid"  # "valid" | "rejected"
    split_group: str = "train"        # "train" | "val" | "test" | "unassigned"

def load_manifest(manifest_path: str = "ml/data/manifest.csv") -> List[ManifestRecord]:
    if not os.path.exists(manifest_path):
        return []

    records: List[ManifestRecord] = []
    with open(manifest_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                rec = ManifestRecord(
                    recording_id=row["recording_id"].strip(),
                    file_path=row["file_path"].strip(),
                    species_id=row["species_id"].strip(),
                    common_name=row["common_name"].strip(),
                    scientific_name=row["scientific_name"].strip(),
                    source=row["source"].strip(),
                    source_recording_id=row["source_recording_id"].strip(),
                    recording_date=row.get("recording_date", "").strip(),
                    location=row.get("location", "").strip(),
                    license=row.get("license", "CC BY-SA 4.0").strip(),
                    duration=float(row.get("duration", 0.0)),
                    sample_rate=int(row.get("sample_rate", 16000)),
                    channels=int(row.get("channels", 1)),
                    validation_status=row.get("validation_status", "valid").strip(),
                    split_group=row.get("split_group", "train").strip()
                )
                records.append(rec)
            except Exception as e:
                print(f"Skipping malformed manifest row: {row} ({e})")
    return records

def save_manifest(records: List[ManifestRecord], manifest_path: str = "ml/data/manifest.csv") -> None:
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, mode="w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=MANIFEST_COLUMNS)
        writer.writeheader()
        for r in records:
            writer.writerow(asdict(r))

def validate_manifest_records(records: List[ManifestRecord], base_dir: str = ".") -> Tuple[List[ManifestRecord], Dict[str, Any]]:
    stats = {
        "total": len(records),
        "valid": 0,
        "missing_files": 0,
        "too_short": 0,
        "leakage_violations": 0
    }

    validated: List[ManifestRecord] = []
    session_to_splits: Dict[str, set] = {}

    for r in records:
        full_path = os.path.join(base_dir, r.file_path)
        is_valid = True

        if not os.path.exists(full_path):
            r.validation_status = "rejected"
            stats["missing_files"] += 1
            is_valid = False
        elif r.duration < 0.5:
            r.validation_status = "rejected"
            stats["too_short"] += 1
            is_valid = False

        if is_valid:
            r.validation_status = "valid"
            stats["valid"] += 1
            # Check session leakage
            session_to_splits.setdefault(r.source_recording_id, set()).add(r.split_group)

        validated.append(r)

    # Check for session split leakage
    for sess_id, splits in session_to_splits.items():
        if len(splits) > 1:
            stats["leakage_violations"] += 1
            print(f"Warning: Session {sess_id} is present across multiple splits: {splits}")

    return validated, stats
