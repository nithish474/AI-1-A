import os
import sys
import re
import html
import hashlib
import json
import argparse
from typing import Dict, List, Any, Tuple, Optional

# Ensure ml/dataset directory is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from manifest import (
    load_catalog_mapping,
    write_manifest,
    read_manifest,
    MANIFEST_FIELDNAMES,
    calculate_sha256
)
from split import split_dataset_stratified, load_manifest, save_manifest

def validate_audio_file(filepath: str) -> Tuple[bool, str, float, int]:
    """Validates audio file decodability and duration >= 0.5s via soundfile or ffprobe."""
    # 1. Try soundfile
    try:
        import soundfile as sf
        info = sf.info(filepath)
        dur = float(info.duration)
        sr = int(info.samplerate)
        if dur < 0.5:
            return False, f"Audio duration too short ({dur:.2f}s < 0.5s)", round(dur, 2), sr
        return True, "Valid audio", round(dur, 2), sr
    except ImportError:
        pass
    except Exception:
        pass

    # 2. Try ffprobe
    try:
        import subprocess
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration:stream=sample_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            filepath
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
        if res.returncode == 0:
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip()]
            sr = 44100
            dur = 0.0
            for l in lines:
                try:
                    val = float(l)
                    if val > 1000:
                        sr = int(val)
                    else:
                        dur = val
                except ValueError:
                    pass
            if dur < 0.5:
                return False, f"Audio duration too short ({dur:.2f}s < 0.5s)", round(dur, 2), sr
            return True, "Valid audio", round(dur, 2), sr
        else:
            return False, f"Audio decoding failed: {res.stderr.strip() or 'ffprobe error'}", 0.0, 0
    except Exception as e:
        return False, f"Audio decoding failed: {str(e)}", 0.0, 0

def import_recordings(
    audio_dir: str,
    metadata_csv: str = "",
    output_manifest_csv: str = "ml/data/manifest.csv",
    catalog_path: str = "src/data/birds.ts",
    merge: bool = True,
    default_species_id: str = "",
    auto_split: bool = True
) -> Dict[str, Any]:
    catalog = load_catalog_mapping(catalog_path)
    seen_hashes: Dict[str, str] = {}
    seen_ids = set()

    existing_records: List[Dict[str, Any]] = []

    # If merge is requested and output manifest already exists, load existing records
    if merge and os.path.exists(output_manifest_csv):
        existing_records = read_manifest(output_manifest_csv)
        for r in existing_records:
            rec_id = r.get("recording_id", "").strip()
            fpath = r.get("file_path", "").strip()
            if rec_id:
                seen_ids.add(rec_id)

            # Get or compute hash for existing record
            fhash = r.get("sha256", "").strip()
            if not fhash and fpath and os.path.exists(fpath):
                try:
                    fhash = calculate_sha256(fpath)
                    r["sha256"] = fhash
                except Exception:
                    pass
            if fhash:
                seen_hashes[fhash] = fpath

    accepted = []
    rejected = []
    duplicates = []

    # Read optional metadata CSV if provided
    metadata_map: Dict[str, Dict[str, str]] = {}
    if metadata_csv and os.path.exists(metadata_csv):
        import csv
        with open(metadata_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = row.get("filename") or row.get("recording_id") or row.get("file_name")
                if key:
                    metadata_map[key.strip()] = row

    # Collect audio files to scan
    allowed_exts = {".wav", ".flac", ".mp3", ".ogg"}
    scanned_files = []

    if os.path.isfile(audio_dir):
        ext = os.path.splitext(audio_dir)[1].lower()
        if ext in allowed_exts:
            scanned_files.append(audio_dir)
    elif os.path.isdir(audio_dir):
        for root, _, files in os.walk(audio_dir):
            for f in sorted(files):
                ext = os.path.splitext(f)[1].lower()
                if ext in allowed_exts:
                    scanned_files.append(os.path.join(root, f))

    new_manifest_records = []

    for fpath in sorted(scanned_files):
        fname = os.path.basename(fpath)
        rel_path = os.path.relpath(fpath, os.getcwd())

        # Duplicate detection by content SHA256 checksum against both current run and existing manifest
        try:
            fhash = calculate_sha256(fpath)
        except Exception as e:
            rejected.append({"file_path": rel_path, "reason": f"Cannot read file for SHA256 calculation: {e}"})
            continue

        if fhash in seen_hashes:
            duplicates.append({
                "file_path": rel_path,
                "duplicate_of": seen_hashes[fhash],
                "reason": "Identical SHA256 content checksum"
            })
            continue
        seen_hashes[fhash] = rel_path

        # Validate audio decodability and duration >= 0.5s
        is_valid, validation_msg, duration, sr = validate_audio_file(fpath)
        if not is_valid:
            rejected.append({"file_path": rel_path, "reason": validation_msg})
            new_manifest_records.append({
                "recording_id": f"rec-{os.path.splitext(fname)[0]}",
                "file_path": rel_path,
                "species_id": default_species_id or "unknown",
                "scientific_name": "",
                "common_name": "",
                "source": "user-upload",
                "source_recording_id": "",
                "recording_date": "",
                "location": "Local Recording",
                "license": "CC BY-SA 4.0",
                "duration": duration,
                "sample_rate": sr,
                "validation_status": "rejected",
                "split_group": "unassigned",
                "rejection_reason": validation_msg,
                "sha256": fhash
            })
            continue

        # Look up metadata
        meta = metadata_map.get(fname) or metadata_map.get(os.path.splitext(fname)[0]) or {}
        raw_sci = meta.get("scientific_name") or meta.get("species") or ""
        raw_common = meta.get("common_name") or ""
        raw_sp_id = meta.get("species_id") or default_species_id or ""

        # If not in metadata or default, infer from prefix / filename
        if not (raw_sci or raw_common or raw_sp_id):
            parent_dir = os.path.basename(os.path.dirname(fpath))
            if parent_dir.lower() in catalog:
                raw_sp_id = parent_dir
            else:
                # Check if filename starts with species ID, e.g. "cardinalis-cardinalis_..."
                file_stem = os.path.splitext(fname)[0]
                for cat_key in catalog:
                    if file_stem.lower().startswith(cat_key.lower()):
                        raw_sp_id = catalog[cat_key]["id"]
                        break

        matched_cat = (
            catalog.get(raw_sp_id.lower())
            or catalog.get(raw_sci.lower())
            or catalog.get(raw_common.lower())
        )

        if not matched_cat:
            reason = f"Species '{raw_sci or raw_common or raw_sp_id or 'unknown'}' not found in catalog"
            rejected.append({"file_path": rel_path, "reason": reason})
            new_manifest_records.append({
                "recording_id": f"rec-{os.path.splitext(fname)[0]}",
                "file_path": rel_path,
                "species_id": raw_sp_id or "unknown",
                "scientific_name": "",
                "common_name": "",
                "source": "user-upload",
                "source_recording_id": "",
                "recording_date": "",
                "location": "Local Recording",
                "license": "CC BY-SA 4.0",
                "duration": round(duration, 2),
                "sample_rate": sr,
                "validation_status": "rejected",
                "split_group": "unassigned",
                "rejection_reason": reason,
                "sha256": fhash
            })
            continue

        # Generate unique recording ID
        base_rec_id = meta.get("recording_id") or f"rec-{matched_cat['id']}-{os.path.splitext(fname)[0]}"
        rec_id = base_rec_id
        counter = 1
        while rec_id in seen_ids:
            rec_id = f"{base_rec_id}-{counter}"
            counter += 1
        seen_ids.add(rec_id)

        source = meta.get("source") or "field-recording"
        license_str = meta.get("license") or "CC BY-SA 4.0"
        raw_loc = meta.get("location") or "Bioacoustic Monitoring Station"
        loc = html.unescape(raw_loc)
        rec_date = meta.get("recording_date") or meta.get("date") or ""

        rec_entry = {
            "recording_id": rec_id,
            "file_path": rel_path,
            "species_id": matched_cat["id"],
            "scientific_name": matched_cat["scientificName"],
            "common_name": matched_cat["commonName"],
            "source": source,
            "source_recording_id": meta.get("source_recording_id") or meta.get("id") or rec_id,
            "recording_date": rec_date,
            "location": loc,
            "license": license_str,
            "duration": round(duration, 2),
            "sample_rate": sr,
            "validation_status": "valid",
            "split_group": "",  # Unassigned initially; assigned during incremental re-split
            "rejection_reason": "",
            "sha256": fhash
        }
        new_manifest_records.append(rec_entry)
        accepted.append(rec_entry)

    # Merge records
    final_records = list(existing_records) + new_manifest_records if merge else new_manifest_records
    write_manifest(output_manifest_csv, final_records)

    # Perform incremental re-split so new valid recordings are immediately assigned without altering old splits
    if auto_split and len(accepted) > 0:
        manifest_objs = load_manifest(output_manifest_csv)
        split_updated = split_dataset_stratified(manifest_objs, incremental=True)
        save_manifest(split_updated, output_manifest_csv)

    report = {
        "totalScanned": len(scanned_files),
        "acceptedCount": len(accepted),
        "rejectedCount": len(rejected),
        "duplicateCount": len(duplicates),
        "manifestPath": output_manifest_csv,
        "rejected": rejected[:10],
        "duplicates": duplicates[:10],
        "newRecordings": [r["recording_id"] for r in accepted]
    }
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import and validate bird recordings into dataset manifest")
    parser.add_argument("--audio-dir", required=True, help="Directory or file containing audio recordings")
    parser.add_argument("--metadata-csv", default="", help="Optional CSV with recording metadata")
    parser.add_argument("--output-manifest", default="ml/data/manifest.csv", help="Output manifest CSV path")
    parser.add_argument("--merge", action="store_true", default=True, help="Merge into existing manifest without overwriting")
    parser.add_argument("--no-merge", dest="merge", action="store_false", help="Overwrite existing manifest")
    parser.add_argument("--species-id", default="", help="Default species ID for audio files if unassigned")
    parser.add_argument("--no-split", dest="auto_split", action="store_false", default=True, help="Skip incremental split after import")
    args = parser.parse_args()

    report = import_recordings(
        audio_dir=args.audio_dir,
        metadata_csv=args.metadata_csv,
        output_manifest_csv=args.output_manifest,
        merge=args.merge,
        default_species_id=args.species_id,
        auto_split=args.auto_split
    )
    print(json.dumps(report, indent=2))
