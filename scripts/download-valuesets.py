#!/usr/bin/env python3
"""
Download ValueSets from VSAC for MADiE CQL Package Testing

This script extracts ValueSet OIDs from CQL files and downloads them from VSAC.
The downloaded ValueSets are cached locally for use by the CQL execution engine.

Usage:
    python scripts/download-valuesets.py --api-key YOUR_VSAC_KEY
    python scripts/download-valuesets.py --api-key YOUR_VSAC_KEY --cql path/to/file.cql

Environment:
    VSAC_API_KEY: Alternative to --api-key flag
"""

import os
import sys
import argparse
import glob

# Load .env file if it exists
def load_env_file():
    """Load environment variables from .env file."""
    env_paths = [
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'),
        '.env'
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        os.environ.setdefault(key.strip(), value.strip())
            break

load_env_file()

# Import from same directory
from vsac_client import (
    VSACClient,
    extract_valuesets_from_cql,
    extract_codesystems_from_cql,
    VSACError
)


def find_cql_files(package_dir: str) -> list:
    """Find all CQL files in a MADiE package directory."""
    cql_dir = os.path.join(package_dir, 'cql')
    if os.path.exists(cql_dir):
        return glob.glob(os.path.join(cql_dir, '*.cql'))
    return []


def main():
    parser = argparse.ArgumentParser(
        description='Download ValueSets from VSAC for CQL testing'
    )
    parser.add_argument(
        '--api-key',
        help='VSAC API key (base64 encoded). Can also use VSAC_API_KEY env var.'
    )
    parser.add_argument(
        '--cql',
        help='Path to specific CQL file. If not specified, searches in package dirs.'
    )
    parser.add_argument(
        '--package',
        default='NHSNACHMonthly1-v0.0.000-FHIR',
        help='MADiE package directory name'
    )
    parser.add_argument(
        '--output',
        default='valuesets/nhsn',
        help='Output directory for downloaded ValueSets'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Force re-download even if cached'
    )

    args = parser.parse_args()

    # Get API key
    api_key = args.api_key or os.environ.get('VSAC_API_KEY')
    if not api_key:
        print("Error: VSAC API key required. Use --api-key or set VSAC_API_KEY env var.")
        print("\nTo get a VSAC API key:")
        print("1. Create an account at https://uts.nlm.nih.gov/uts/")
        print("2. Generate an API key in your profile")
        print("3. Base64 encode: echo -n 'apikey:YOUR_KEY' | base64")
        sys.exit(1)

    # Find CQL files
    if args.cql:
        cql_files = [args.cql]
    else:
        cql_files = find_cql_files(args.package)
        if not cql_files:
            print(f"No CQL files found in {args.package}/cql/")
            sys.exit(1)

    # Extract ValueSet OIDs from all CQL files
    all_valuesets = {}
    all_codesystems = {}

    for cql_file in cql_files:
        print(f"\nProcessing: {cql_file}")
        try:
            with open(cql_file, 'r', encoding='utf-8') as f:
                content = f.read()

            valuesets = extract_valuesets_from_cql(content)
            codesystems = extract_codesystems_from_cql(content)

            all_valuesets.update(valuesets)
            all_codesystems.update(codesystems)

            print(f"  Found {len(valuesets)} valuesets, {len(codesystems)} codesystems")

        except Exception as e:
            print(f"  Error: {e}")

    if not all_valuesets:
        print("\nNo ValueSets found in CQL files.")
        sys.exit(0)

    print(f"\n{'='*60}")
    print(f"Total ValueSets to download: {len(all_valuesets)}")
    print(f"{'='*60}")

    for name, oid in all_valuesets.items():
        print(f"  {name}: {oid}")

    # Create output directory
    os.makedirs(args.output, exist_ok=True)

    # Download ValueSets
    print(f"\nDownloading to: {args.output}")
    print("="*60)

    client = VSACClient(
        api_key=api_key,
        cache_dir=args.output,
        verbose=True
    )

    try:
        results = client.download_multiple(
            all_valuesets,
            force_refresh=args.force,
            continue_on_error=True
        )

        # Summary
        print(f"\n{'='*60}")
        print("Download Summary")
        print(f"{'='*60}")

        success_count = sum(1 for codes in results.values() if codes)
        fail_count = len(results) - success_count

        print(f"Successfully downloaded: {success_count}/{len(all_valuesets)}")
        if fail_count > 0:
            print(f"Failed: {fail_count}")

        # Save code systems info for reference
        codesystems_path = os.path.join(args.output, '_codesystems.txt')
        with open(codesystems_path, 'w') as f:
            f.write("# Code Systems referenced in CQL\n")
            f.write("# (These are typically terminology systems, not ValueSets)\n\n")
            for name, url in sorted(all_codesystems.items()):
                f.write(f"{name}: {url}\n")
        print(f"\nCode systems list saved to: {codesystems_path}")

    except VSACError as e:
        print(f"\nVSAC Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
