import os
import re
import csv
import json
import html
import hashlib
from dataclasses import dataclass, asdict, field
from typing import List, Dict, Any, Optional, Tuple, Union

MANIFEST_FIELDNAMES = [
    "recording_id",
    "file_path",
    "species_id",
    "scientific_name",
    "common_name",
    "source",
    "source_recording_id",
    "recording_date",
    "location",
    "license",
    "duration",
    "sample_rate",
    "validation_status",
    "split_group",
    "rejection_reason",
    "sha256"
]
MANIFEST_COLUMNS = MANIFEST_FIELDNAMES

@dataclass
class ManifestRecord:
    recording_id: str
    file_path: str
    species_id: str
    scientific_name: str
    common_name: str
    source: str
    source_recording_id: str
    recording_date: str = ""
    location: str = ""
    license: str = "CC BY-SA 4.0"
    duration: float = 0.0
    sample_rate: int = 16000
    validation_status: str = "valid"  # "valid" | "rejected"
    split_group: str = "train"        # "train" | "val" | "test" | "unassigned"
    rejection_reason: str = ""
    sha256: str = ""

def calculate_sha256(filepath: str) -> str:
    """Computes SHA256 hex digest for a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def compute_manifest_fingerprint(manifest_path: str = "ml/data/manifest.csv") -> str:
    """Returns the first 16 hex chars of the manifest SHA256, matching train.py."""
    if not os.path.exists(manifest_path):
        return ""
    h = hashlib.sha256()
    with open(manifest_path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()[:16]

def load_catalog_mapping(catalog_path: str = "src/data/birds.ts") -> Dict[str, Dict[str, str]]:
    """Loads bird species mapping (by ID, common name, and scientific name) from birds.ts."""
    mapping: Dict[str, Dict[str, str]] = {}
    if not os.path.exists(catalog_path):
        return mapping

    try:
        content = open(catalog_path, "r", encoding="utf-8").read()
        # Find entries matching id, commonName, scientificName
        pattern = re.compile(
            r"id:\s*['\"]([^'\"]+)['\"].*?commonName:\s*['\"]([^'\"]+)['\"].*?scientificName:\s*['\"]([^'\"]+)['\"]",
            re.DOTALL
        )
        for match in pattern.finditer(content):
            sp_id, common_name, sci_name = match.groups()
            entry = {
                "id": sp_id.strip(),
                "commonName": common_name.strip(),
                "scientificName": sci_name.strip()
            }
            mapping[sp_id.strip().lower()] = entry
            mapping[common_name.strip().lower()] = entry
            mapping[sci_name.strip().lower()] = entry
    except Exception as e:
        print(f"Error parsing catalog from {catalog_path}: {e}")

    return mapping

def read_manifest(manifest_path: str = "ml/data/manifest.csv") -> List[Dict[str, Any]]:
    """Reads manifest CSV into a list of dictionaries with HTML unescaping for location."""
    if not os.path.exists(manifest_path):
        return []

    records: List[Dict[str, Any]] = []
    with open(manifest_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cleaned_row = dict(row)
            if "location" in cleaned_row and cleaned_row["location"]:
                cleaned_row["location"] = html.unescape(cleaned_row["location"])
            records.append(cleaned_row)
    return records

def load_manifest(manifest_path: str = "ml/data/manifest.csv") -> List[ManifestRecord]:
    """Reads manifest CSV into a list of ManifestRecord instances."""
    if not os.path.exists(manifest_path):
        return []

    records: List[ManifestRecord] = []
    with open(manifest_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                rec = ManifestRecord(
                    recording_id=row.get("recording_id", "").strip(),
                    file_path=row.get("file_path", "").strip(),
                    species_id=row.get("species_id", "").strip(),
                    scientific_name=row.get("scientific_name", "").strip(),
                    common_name=row.get("common_name", "").strip(),
                    source=row.get("source", "").strip(),
                    source_recording_id=row.get("source_recording_id", "").strip(),
                    recording_date=row.get("recording_date", "").strip(),
                    location=html.unescape(row.get("location", "").strip()) if row.get("location") else "",
                    license=row.get("license", "CC BY-SA 4.0").strip(),
                    duration=float(row.get("duration", 0.0) or 0.0),
                    sample_rate=int(float(row.get("sample_rate", 16000) or 16000)),
                    validation_status=row.get("validation_status", "valid").strip(),
                    split_group=row.get("split_group", "train").strip(),
                    rejection_reason=row.get("rejection_reason", "").strip(),
                    sha256=row.get("sha256", "").strip()
                )
                records.append(rec)
            except Exception as e:
                print(f"Skipping malformed manifest row: {row} ({e})")
    return records

def save_manifest(
    records: List[Union[ManifestRecord, Dict[str, Any]]],
    manifest_path: str = "ml/data/manifest.csv",
    fieldnames: Optional[List[str]] = None
) -> None:
    """Saves records to manifest CSV."""
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    if fieldnames is None:
        # Check if existing manifest already had specific header order
        if os.path.exists(manifest_path):
            with open(manifest_path, "r", encoding="utf-8") as f:
                first_line = f.readline().strip()
                if first_line:
                    existing_cols = [c.strip() for c in first_line.split(",") if c.strip()]
                    fieldnames = existing_cols
        if not fieldnames:
            fieldnames = list(MANIFEST_FIELDNAMES)
        elif "sha256" not in fieldnames:
            fieldnames.append("sha256")

    with open(manifest_path, mode="w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in records:
            row_dict = asdict(r) if isinstance(r, ManifestRecord) else dict(r)
            writer.writerow(row_dict)

def write_manifest(output_manifest_csv: str, manifest_records: List[Union[ManifestRecord, Dict[str, Any]]]) -> None:
    """Alias for saving manifest records, preserving compatibility."""
    save_manifest(manifest_records, output_manifest_csv)

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
        full_path = os.path.join(base_dir, r.file_path) if not os.path.isabs(r.file_path) else r.file_path
        is_valid = True

        if not os.path.exists(full_path):
            r.validation_status = "rejected"
            r.rejection_reason = "file missing"
            stats["missing_files"] += 1
            is_valid = False
        elif r.duration < 0.5:
            r.validation_status = "rejected"
            r.rejection_reason = "Audio duration too short (< 0.5s)"
            stats["too_short"] += 1
            is_valid = False

        if is_valid:
            r.validation_status = "valid"
            stats["valid"] += 1
            session_to_splits.setdefault(r.source_recording_id or r.recording_id, set()).add(r.split_group)

        validated.append(r)

    for sess_id, splits in session_to_splits.items():
        if len(splits) > 1:
            stats["leakage_violations"] += 1

    return validated, stats
