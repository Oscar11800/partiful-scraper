#!/usr/bin/env python3
"""
Convert a raw list of names (one per line) into a CSV with a 'name' header.

Usage:
    python names_to_csv.py                        # paste names, then Ctrl+D
    python names_to_csv.py -f raw_names.txt       # read from file
    python names_to_csv.py -o my_event.csv        # custom output name
"""

import argparse
import csv
import re
import sys
from datetime import date


def clean_name(name):
    name = name.strip()
    name = re.sub(r'[^\w\s\'\-\.\,\u00C0-\u024F]', '', name, flags=re.UNICODE)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def is_valid_name(name):
    if not name:
        return False
    if re.match(r'^and\s+\d+\s+more$', name, re.IGNORECASE):
        return False
    if re.search(r'https?://|www\.', name):
        return False
    if re.match(r'^@', name):
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Convert a list of names to CSV.")
    parser.add_argument("-f", "--file", help="Input text file (one name per line)")
    parser.add_argument(
        "-o", "--output",
        default=f"partiful_names_{date.today().isoformat()}.csv",
        help="Output CSV filename (default: partiful_names_YYYY-MM-DD.csv)",
    )
    args = parser.parse_args()

    if args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            raw_lines = f.readlines()
    else:
        print("Paste names (one per line), then press Ctrl+D when done:\n")
        raw_lines = sys.stdin.readlines()

    names = []
    seen = set()
    for line in raw_lines:
        name = clean_name(line)
        if is_valid_name(name):
            key = name.lower()
            if key not in seen:
                seen.add(key)
                names.append(name)

    if not names:
        print("No valid names found.")
        sys.exit(1)

    with open(args.output, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['name'])
        writer.writeheader()
        for name in names:
            writer.writerow({'name': name})

    print(f"Wrote {len(names)} names to {args.output}")


if __name__ == "__main__":
    main()
