# Quality Disposition Control Dashboard — Web App

Pure Python (built-in `http.server`) + SQLite. No Flask. No external CDN.
Everything runs locally, no internet connection required after setup.

## Contents
- `server.py` — the web server (routes + KPI calculation engine)
- `index.html` — the dashboard frontend (vanilla HTML/CSS/JS)
- `quality.db` — SQLite database (4,820 records imported from your workbook)
- `build_db.py` — script used to (re)build `quality.db` from the original .xlsm

## How to run
1. Make sure Python 3 is installed (`python3 --version`).
2. Open a terminal in this folder.
3. Run:
   ```
   python3 server.py
   ```
4. Open your browser at: **http://localhost:8000/**
5. To share on your local office network, run:
   ```
   python3 server.py 8000
   ```
   and give colleagues `http://<your-pc-ip-address>:8000/` (find your IP with `ipconfig` on Windows).

## To refresh data later
If you get a new/updated workbook, just re-run:
```
python3 build_db.py
```
This rebuilds `quality.db` from the .xlsm file. Then restart `server.py`.

## What's included
- ✅ Exactly 16 KPI cards (matches original workbook formulas — verified against Aug-2026 sample: all 16 values matched exactly)
- ✅ 4,820/4,820 records imported, all with Output Weight
- ✅ 8 live filters: Month, Work Center, Grade, Quality Decision, Week, Quarter, Financial Year, Defect Intensity
- ✅ KPIs, Quality Decision table, Top-5 Defect Pareto, and Intensity Breakdown all recalculate instantly when filters change
- ✅ No external dependencies (no Flask, no CDN) — works fully offline

## Next step for company-wide sharing
This local version is great for testing. For real multi-user access with logins/roles,
this same server.py logic can be deployed to a small always-on machine or cloud VM
(so it's reachable at all times, not just when your PC is on).

## Deploy online — so NOBODY needs Python installed (recommended)
Use **Render.com** (free tier). Render's servers already have Python installed —
you never install anything on your own PC, and colleagues just open a link in
their browser.

### Steps
1. Go to https://github.com and create a free account (if you don't have one).
2. Create a new repository (e.g. "quality-dashboard") → click **"uploading an
   existing file"** → drag-and-drop all files from this folder
   (`server.py`, `index.html`, `quality.db`, `build_db.py`, `render.yaml`,
   `runtime.txt`) → commit.
3. Go to https://render.com → sign up free (no card required for free tier) →
   **New +** → **Web Service** → connect your GitHub repo.
4. Render auto-detects `render.yaml`. Confirm:
   - Build Command: `echo 'no build needed'`
   - Start Command: `python3 server.py`
5. Click **Create Web Service**. Wait ~2 minutes for the first deploy.
6. You'll get a public URL like `https://quality-dashboard.onrender.com`.
   Share this link with anyone — they open it in any browser, no install needed.

### Updating data later
Whenever you get a new workbook: run `build_db.py` once on your PC (needs
Python only for this one-time step) to regenerate `quality.db`, then upload
the updated `quality.db` file to the same GitHub repo — Render auto-redeploys
and everyone sees the new data on the same link.

Note: Render's free tier "sleeps" after 15 minutes of no traffic and takes
~30 seconds to wake up on the next visit. For an always-instant company
dashboard, a paid tier (~$7/month) removes the sleep delay.
