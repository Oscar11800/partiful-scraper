# Partiful Scraper

Extract attendee names from Partiful events and find their LinkedIn profiles.

---

## Step 1: Extract Names (Chrome Extension)

1. Open `chrome://extensions`, turn on **Developer mode** (top-right)
2. Click **Load unpacked** → select the `extension` folder
3. Go to a Partiful event → click **"View all"** on the guest list
4. Click the extension icon in your toolbar → **Extract Names**
5. CSV downloads automatically

> **Sharing:** Zip the `extension` folder and send it to anyone. They follow steps 1-5.

---

## Step 2: Find LinkedIn Profiles (Optional)

### Setup (one time)

```bash
cd partiful-scraper
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

> On subsequent runs, just activate the venv: `source venv/bin/activate`

### Run

```bash
python scripts/google_linkedin_search.py input/your_file.csv
```

A Chrome window opens, searches each name, and saves results to `output/your_file_linkedin.csv`.

Add `--delay 3` if Google starts blocking. Press `Ctrl+C` to stop — progress is saved.

If a CAPTCHA appears, solve it in the browser window. The script continues automatically.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension icon missing | Turn on Developer mode in `chrome://extensions` |
| Extract button not showing | Open the guest list first (click "View all") |
| No names found | Must be logged in and RSVP'd |
| Google blocking | Add `--delay 5` to the command |
| Python errors | Run `source venv/bin/activate` first |
