import os
import sys
import json
import time
import urllib.request
import urllib.parse
import argparse
import soundfile as sf
from manifest import load_catalog_mapping, write_manifest, read_manifest

TARGET_SPECIES = [
    {'id': 'cardinalis-cardinalis', 'genus_species': 'Cardinalis cardinalis'},
    {'id': 'turdus-migratorius', 'genus_species': 'Turdus migratorius'},
    {'id': 'bubo-virginianus', 'genus_species': 'Bubo virginianus'},
    {'id': 'dryocopus-pileatus', 'genus_species': 'Dryocopus pileatus'},
    {'id': 'poecile-atricapillus', 'genus_species': 'Poecile atricapillus'}
]

def search_commons_xc_files(genus_species: str, limit: int = 4):
    url = f"https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=incategory:Xeno-canto%20{urllib.parse.quote(genus_species)}&srnamespace=6&format=json&srlimit={limit}"
    headers = {"User-Agent": "BirdSong-Bioacoustics/1.0 (Educational Academic Project; contact: bioacoustics@example.org)"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            results = data.get('query', {}).get('search', [])
            return [r['title'] for r in results]
    except Exception as e:
        print(f"Error searching Commons for {genus_species}: {e}")
        return []

def get_commons_file_info(file_title: str):
    url = f"https://commons.wikimedia.org/w/api.php?action=query&titles={urllib.parse.quote(file_title)}&prop=imageinfo&iiprop=url|extmetadata&format=json"
    headers = {"User-Agent": "BirdSong-Bioacoustics/1.0 (Educational Academic Project; contact: bioacoustics@example.org)"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            pages = data.get('query', {}).get('pages', {})
            for _, pdata in pages.items():
                infos = pdata.get('imageinfo', [])
                if infos:
                    info = infos[0]
                    meta = info.get('extmetadata', {})
                    return {
                        'url': info.get('url'),
                        'artist': meta.get('Artist', {}).get('value', 'Unknown Recordist'),
                        'license': meta.get('LicenseShortName', {}).get('value', 'CC BY-SA 3.0'),
                        'date': meta.get('DateTimeOriginal', {}).get('value', ''),
                        'lat': meta.get('GPSLatitude', {}).get('value'),
                        'lng': meta.get('GPSLongitude', {}).get('value')
                    }
    except Exception as e:
        print(f"Error getting metadata for {file_title}: {e}")
    return None

def download_audio_file(file_url: str, dest_path: str, retries: int = 3) -> bool:
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1024:
        try:
            sf.info(dest_path)
            return True
        except Exception:
            pass

    headers = {"User-Agent": "BirdSong-Bioacoustics/1.0 (Educational Academic Project; contact: bioacoustics@example.org)"}
    req = urllib.request.Request(file_url, headers=headers)

    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read()
                with open(dest_path, 'wb') as f:
                    f.write(content)
            sf.info(dest_path)
            return True
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1.5)
            else:
                if os.path.exists(dest_path):
                    try:
                        os.remove(dest_path)
                    except Exception:
                        pass
                return False
    return False

def populate_genuine_dataset(
    dest_dir: str = "ml/data/recordings",
    manifest_path: str = "ml/data/manifest.csv",
    catalog_path: str = "src/data/birds.ts",
    limit_per_species: int = 4
):
    catalog = load_catalog_mapping(catalog_path)
    os.makedirs(dest_dir, exist_ok=True)
    existing_records = read_manifest(manifest_path)
    existing_by_rec = {r['recording_id']: r for r in existing_records}

    downloaded = 0
    print(f"Acquiring genuine bird recordings for {len(TARGET_SPECIES)} species ({limit_per_species} max per species)...")

    for item in TARGET_SPECIES:
        sp_id = item['id']
        cat = catalog.get(sp_id.lower())
        if not cat:
            continue
        common_name = cat['commonName']
        sci_name = cat['scientificName']
        genus_sp = item['genus_species']

        print(f"\nSearching open Xeno-canto records for {common_name} ({sci_name})...")
        file_titles = search_commons_xc_files(genus_sp, limit=limit_per_species)
        time.sleep(0.5)

        for title in file_titles:
            clean_title = title.replace('File:', '').replace(' ', '_')
            clean_title = "".join(c for c in clean_title if c.isalnum() or c in "._-")
            dest_file = os.path.join(dest_dir, f"{sp_id}_{clean_title}")

            info = get_commons_file_info(title)
            if not info or not info.get('url'):
                continue

            # Derive XC ID
            import re
            xc_match = re.search(r"XC(\d+)", clean_title)
            xc_id = xc_match.group(1) if xc_match else ""
            rec_id = f"xc-{xc_id}" if xc_id else f"rec-{sp_id}-{os.path.splitext(clean_title)[0]}"

            if rec_id in existing_by_rec and os.path.exists(existing_by_rec[rec_id].get('file_path', '')):
                print(f"  Already cataloged: {rec_id}")
                continue

            print(f"  Downloading: {clean_title}...")
            ok = download_audio_file(info['url'], dest_file)
            if not ok:
                print(f"  Failed: {clean_title}")
                continue

            try:
                ainfo = sf.info(dest_file)
                duration = round(float(ainfo.duration), 2)
                sample_rate = int(ainfo.samplerate)
            except Exception as e:
                print(f"  Invalid audio {clean_title}: {e}")
                continue

            loc_str = "Open Bioacoustic Archive"
            if info.get('lat') and info.get('lng'):
                loc_str = f"Lat: {info['lat']}, Lng: {info['lng']}"

            # Strip html tags from recordist name if present
            raw_artist = info.get('artist', 'Unknown')
            clean_artist = re.sub(r'<[^>]+>', '', raw_artist).strip()

            rec_entry = {
                'recording_id': rec_id,
                'file_path': os.path.relpath(dest_file, os.getcwd()),
                'species_id': sp_id,
                'scientific_name': sci_name,
                'common_name': common_name,
                'source': 'xeno-canto-open-archive',
                'source_recording_id': xc_id or rec_id,
                'recording_date': info.get('date', ''),
                'location': f"{loc_str} (Recordist: {clean_artist})",
                'license': info.get('license', 'CC BY-SA 3.0'),
                'duration': duration,
                'sample_rate': sample_rate,
                'validation_status': 'valid',
                'split_group': '',
                'rejection_reason': ''
            }
            existing_by_rec[rec_id] = rec_entry
            downloaded += 1

    write_manifest(manifest_path, list(existing_by_rec.values()))
    print(f"\nPopulation complete! {len(existing_by_rec)} total valid recordings recorded in {manifest_path}.")
    return downloaded

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Populate genuine bird recordings")
    parser.add_argument('--limit', type=int, default=4)
    args = parser.parse_args()
    populate_genuine_dataset(limit_per_species=args.limit)
