# Partiful Scraper

Extract attendee names from Partiful event pages and find their LinkedIn profiles.

## How It Works

**Step 1: Extract names** from a Partiful event using the Chrome extension (one click).

**Step 2: Find LinkedIn profiles** by running the search script with the downloaded CSV.

---

## Setup

### Prerequisites

- Python 3.8+
- Google Chrome
- `pip install -r requirements.txt`

### Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select the `extension/` folder from this repo
4. You should see "Partiful Name Extractor" appear

---

## Usage

### Step 1: Extract Names from Partiful

1. Go to a Partiful event page (`partiful.com/e/...`)
2. Make sure you're logged in and can see the guest list
3. Click the purple **Extract Names** button (bottom-right corner)
4. A CSV file downloads automatically

### Step 2: Search for LinkedIn Profiles

```bash
python google_linkedin_search.py partiful_names_2025-02-28.csv
```

This will:
- Open a Chrome window
- Search Google for each name + "san francisco" + "linkedin"
- Save results to `partiful_names_2025-02-28_linkedin.csv`

#### Options

```bash
# Custom output file
python google_linkedin_search.py names.csv -o results.csv

# Slower searches (if getting blocked by Google)
python google_linkedin_search.py names.csv --delay 3
```

#### CAPTCHA Handling

Google may show a CAPTCHA after many searches. When this happens:
1. The script pauses automatically
2. Solve the CAPTCHA in the browser window
3. The script detects it's solved and continues

You can also signal manually: `touch captcha_solved`

Safe to interrupt anytime with `Ctrl+C` -- progress is saved after each search.

---

## Alternative: Manual Name Input

If you can't use the Chrome extension, use `names_to_csv.py` to create the input CSV:

```bash
# Paste names interactively (Ctrl+D when done)
python names_to_csv.py

# From a text file (one name per line)
python names_to_csv.py -f raw_names.txt

# Custom output name
python names_to_csv.py -o my_event.csv
```

Or use the DevTools console script directly by pasting the contents of `name_scrape.js` into your browser console on a Partiful event page.

---

## File Structure

```
partiful-scraper/
├── extension/              # Chrome extension for name extraction
│   ├── manifest.json
│   ├── content.js
│   ├── popup.html
│   ├── styles.css
│   └── icon48.png
├── google_linkedin_search.py   # Step 2: Google -> LinkedIn URL lookup
├── names_to_csv.py             # Helper: raw names -> CSV
├── name_scrape.js              # DevTools console script (manual fallback)
├── requirements.txt
└── README.md
```
