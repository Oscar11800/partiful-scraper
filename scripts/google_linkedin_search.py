#!/usr/bin/env python3
"""
Google LinkedIn Search Script
Searches Google for LinkedIn profiles and extracts the first LinkedIn URL.
Pauses for manual CAPTCHA solving when detected.

Usage:
    python google_linkedin_search.py names.csv
    python google_linkedin_search.py names.csv -o results.csv
    python google_linkedin_search.py names.csv --delay 3
"""

import argparse
import csv
import time
import re
import os
from pathlib import Path
from urllib.parse import unquote
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager

LOCATION = "san francisco"
CAPTCHA_SIGNAL_FILE = "captcha_solved"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Search Google for LinkedIn profiles from a CSV of names."
    )
    parser.add_argument(
        "input",
        help="Input CSV file with a 'name' column",
    )
    parser.add_argument(
        "-o", "--output",
        help="Output CSV file (default: <input>_linkedin.csv)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds between searches (default: 1.0, increase if getting blocked)",
    )
    args = parser.parse_args()

    if not args.output:
        stem = Path(args.input).stem
        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)
        args.output = str(output_dir / f"{stem}_linkedin.csv")

    return args


def setup_driver():
    chrome_options = Options()
    chrome_options.add_argument("--start-maximized")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option('useAutomationExtension', False)

    chrome_options.add_argument("--disable-images")
    chrome_options.add_argument("--blink-settings=imagesEnabled=false")
    chrome_options.page_load_strategy = 'eager'

    chrome_options.binary_location = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return driver


def check_for_captcha(driver):
    captcha_indicators = [
        "unusual traffic",
        "not a robot",
        "recaptcha",
        "verify you're human",
        "automated queries",
        "sorry/index",
    ]
    try:
        current_url = driver.current_url.lower()
        if "sorry" in current_url or "captcha" in current_url:
            return True

        page_source = driver.page_source
        if page_source is None:
            return False
        page_source = page_source.lower()
        return any(indicator in page_source for indicator in captcha_indicators)
    except:
        return False


def wait_for_captcha_resolution(driver):
    print("\n" + "="*60)
    print("CAPTCHA DETECTED!")
    print("    1. Solve the CAPTCHA in the browser window")
    print(f"    2. Then run: touch {CAPTCHA_SIGNAL_FILE}")
    print("       Or just wait - script will auto-detect when solved")
    print("="*60)

    if os.path.exists(CAPTCHA_SIGNAL_FILE):
        os.remove(CAPTCHA_SIGNAL_FILE)

    while True:
        if os.path.exists(CAPTCHA_SIGNAL_FILE):
            print("    Signal file detected - continuing...")
            os.remove(CAPTCHA_SIGNAL_FILE)
            time.sleep(2)
            break

        if not check_for_captcha(driver):
            print("    CAPTCHA appears solved - continuing...")
            time.sleep(2)
            break

        time.sleep(2)


def extract_linkedin_url(driver):
    try:
        WebDriverWait(driver, 5).until(
            EC.presence_of_element_located((By.ID, "search"))
        )

        links = driver.find_elements(By.CSS_SELECTOR, "#search a[href*='linkedin.com/in/']")

        for link in links:
            href = link.get_attribute("href")
            if href:
                if "/url?q=" in href:
                    match = re.search(r'linkedin\.com/in/[^&?]+', href)
                    if match:
                        return "https://www." + match.group(0)
                else:
                    match = re.search(r'https?://[^/]*linkedin\.com/in/[^?&\s]+', href)
                    if match:
                        return match.group(0)

        return None
    except Exception as e:
        print(f"    Error extracting URL: {e}")
        return None


def search_google(driver, name, location):
    query = f"linkedin {name} {location}"
    search_url = f"https://www.google.com/search?q={query.replace(' ', '+')}"

    driver.get(search_url)

    try:
        WebDriverWait(driver, 3).until(
            EC.presence_of_element_located((By.ID, "search"))
        )
    except TimeoutException:
        pass

    if check_for_captcha(driver):
        wait_for_captcha_resolution(driver)
        driver.get(search_url)
        time.sleep(1)

    return extract_linkedin_url(driver)


def load_existing_results(output_file):
    processed = {}
    if os.path.exists(output_file):
        with open(output_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                processed[row['name']] = row['linkedin_url']
    return processed


def main():
    args = parse_args()

    print("="*60)
    print("Google LinkedIn Search")
    print("="*60)
    print(f"  Input:    {args.input}")
    print(f"  Output:   {args.output}")
    print(f"  Location: {LOCATION}")
    print(f"  Delay:    {args.delay}s")
    print("="*60)

    names = []
    with open(args.input, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('name', '').strip()
            if name:
                names.append(name)

    print(f"Found {len(names)} names to search")

    existing = load_existing_results(args.output)
    if existing:
        print(f"Found {len(existing)} already processed - will skip those")

    print("\nStarting browser...")
    driver = setup_driver()

    print("Loading Google homepage...")
    driver.get("https://www.google.com")
    time.sleep(1)

    results = []

    for name in names:
        if name in existing:
            results.append({'name': name, 'linkedin_url': existing[name]})

    try:
        for i, name in enumerate(names, 1):
            if name in existing:
                print(f"[{i}/{len(names)}] Skipping {name} (already processed)")
                continue

            print(f"[{i}/{len(names)}] Searching: {name}...", end=" ", flush=True)

            linkedin_url = search_google(driver, name, LOCATION)

            if linkedin_url:
                print(f"Found: {linkedin_url}")
            else:
                print("No LinkedIn URL found")
                linkedin_url = ""

            results.append({
                'name': name,
                'linkedin_url': linkedin_url
            })

            with open(args.output, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['name', 'linkedin_url'])
                writer.writeheader()
                writer.writerows(results)

            if i < len(names):
                time.sleep(args.delay)

    except KeyboardInterrupt:
        print(f"\n\nInterrupted by user. Progress saved to {args.output}")

    finally:
        print("\nClosing browser...")
        driver.quit()

    found = sum(1 for r in results if r['linkedin_url'])
    print("\n" + "="*60)
    print("COMPLETE!")
    print(f"  Total names:         {len(results)}")
    print(f"  LinkedIn URLs found: {found}")
    print(f"  Results saved to:    {args.output}")
    print("="*60)


if __name__ == "__main__":
    main()
