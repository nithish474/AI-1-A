import os
import sys
import hashlib
import json
import argparse
from typing import Dict, List, Any
import soundfile as sf
from manifest import load_catalog_mapping, write_manifest, MANIFEST_FIELDNAMES

def calculate_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def validate_audio_file(filepath: str):
    try:
        info = sf.info(filepath)
        if info.duration < 0.5:
            return False, "Audio duration too short (< 0.5s)", 0.0, 0
        return True, "Valid audio", float(info.duration), int(info.samplerate)
    except Exception as e:
        return False, f"Audio decoding failed: {str(e)}", 0.0, 0

def import_recordings(
    audio_dir: str,
    metadata_csv: str,
    output_manifest_csv: str,
    catalog_path: str = "src/data/birds.ts"
) -> Dict[str, Any]:
    catalog = load_catalog_mapping(catalog_path)
    seen_hashes = {}
    seen_ids = set()

    accepted = []
    rejected = []
    duplicates = []

    # Read metadata if provided
    metadata_map = {}
    if metadata_csv and os.path.exists(metadata_csv):
        import csv
        with open(metadata_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = row.get('filename') or row.get('recording_id') or row.get('file_name')
                if key:
                    metadata_map[key] = row

    # Scan directory
    allowed_exts = {'.wav', '.flac', '.mp3', '.ogg'}
    scanned_files = []
    for root, _, files in os.walk(audio_dir):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in allowed_exts:
                scanned_files.append(os.path.join(root, f))

    manifest_records = []

    for fpath in sorted(scanned_files):
        fname = os.path.basename(fpath)
        rel_path = os.path.relpath(fpath, os.getcwd())

        # Duplicate detection by content hash
        fhash = calculate_sha256(fpath)
        if fhash in seen_hashes:
            duplicates.append({
                'file_path': rel_path,
                'duplicate_of': seen_hashes[fhash],
                'reason': 'Identical SHA256 content checksum'
            })
            continue
        seen_hashes[fhash] = rel_path

        # Validate audio decodability
        is_valid, validation_msg, duration, sr = validate_audio_file(fpath)
        if not is_valid:
            rejected.append({
                'file_path': rel_path,
                'reason': validation_msg
            })
            manifest_records.append({
                'recording_id': f"rec-{os.path.splitext(fname)[0]}",
                'file_path': rel_path,
                'validation_status': 'rejected',
                'rejection_reason': validation_msg,
                'duration': duration,
                'sample_rate': sr
            })
            continue

        # Look up metadata
        meta = metadata_map.get(fname) or metadata_map.get(os.path.splitext(fname)[0]) or {}
        raw_sci = meta.get('scientific_name') or meta.get('species') or ''
        raw_common = meta.get('common_name') or ''
        raw_sp_id = meta.get('species_id') or ''

        # If not in metadata, attempt inferring from directory name or filename
        if not (raw_sci or raw_common or raw_sp_id):
            parent_dir = os.path.basename(os.path.dirname(fpath))
            if parent_dir in catalog:
                raw_sp_id = parent_dir

        # Match against catalog
        matched_cat = (
            catalog.get(raw_sp_id.lower())
            or catalog.get(raw_sci.lower())
            or catalog.get(raw_common.lower())
        )

        if not matched_cat:
            reason = f"Species '{raw_sci or raw_common or raw_sp_id}' not found in catalog"
            rejected.append({'file_path': rel_path, 'reason': reason})
            manifest_records.append({
                'recording_id': f"rec-{os.path.splitext(fname)[0]}",
                'file_path': rel_path,
                'validation_status': 'rejected',
                'rejection_reason': reason,
                'duration': round(duration, 2),
                'sample_rate': sr
            })
            continue

        rec_id = meta.get('recording_id') or f"rec-{matched_cat['id']}-{os.path.splitext(fname)[0]}"
        if rec_id in seen_ids:
            rec_id = f"{rec_id}-{len(seen_ids)}"
        seen_ids.add(rec_id)

        source = meta.get('source') or 'xeno-canto'
        license_str = meta.get('license') or 'CC BY-NC-SA 4.0'
        loc = meta.get('location') or 'Field Bioacoustic Monitor'
        rec_date = meta.get('recording_date') or meta.get('date') or ''

        rec_entry = {
            'recording_id': rec_id,
            'file_path': rel_path,
            'species_id': matched_cat['id'],
            'scientific_name': matched_cat['scientificName'],
            'common_name': matched_cat['commonName'],
            'source': source,
            'source_recording_id': meta.get('source_recording_id') or meta.get('id') or '',
            'recording_date': rec_date,
            'location': loc,
            'license': license_str,
            'duration': round(duration, 2),
            'sample_rate': sr,
            'validation_status': 'valid',
            'split_group': meta.get('split_group') or '',
            'rejection_reason': ''
        }
        manifest_records.append(rec_entry)
        accepted.append(rec_entry)

    write_manifest(output_manifest_csv, manifest_records)

    report = {
        'totalScanned': len(scanned_files),
        'acceptedCount': len(accepted),
        'rejectedCount': len(rejected),
        'duplicateCount': len(duplicates),
        'manifestPath': output_manifest_csv,
        'rejected': rejected[:10],
        'duplicates': duplicates[:10]
    }
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Import and validate bird recordings into dataset manifest")
    parser.add_argument('--audio-dir', required=True, help="Directory containing audio files")
    parser.add_argument('--metadata-csv', default="", help="Optional CSV with recording metadata")
    parser.add_argument('--output-manifest', default="ml/data/manifest.csv", help="Output manifest CSV path")
    args = parser.parse_args()

    report = import_recordings(args.audio_dir, args.metadata_csv, args.output_manifest)
    print(json.dumps(report, indent=2))
