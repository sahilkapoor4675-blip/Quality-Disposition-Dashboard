# Quality Disposition Control Dashboard — Web App

Pure Python (built-in `http.server`) + SQLite. No Flask. No external CDN.
Everything runs locally, no internet connection required after setup.

## Contents
- `server.py` — the web server (routes + KPI calculation engine)
- `index.html` — the dashboard frontend (vanilla HTML/CSS/JS)
- `quality.db` — SQLite database (4,936 records imported from your workbook)
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
- ✅ Exactly 16 KPI cards, colored exactly like the original workbook (green=good, red=bad, amber=caution, purple, slate — extracted directly from the workbook's cell font colors)
- ✅ **Previous-period comparison on every KPI card** — "Prev: X" + ▲/▼ trend arrow + %/pts change, exactly replicating the "KPI Comparison" sheet engine (auto-detects Month/Week/Quarter/FY comparison mode based on which single filter is active)
- ✅ 4,820/4,936 records imported, all with Output Weight
- ✅ 8 live filters: Month, Work Center, Grade, Quality Decision, Week, Quarter, Financial Year, Defect Intensity
- ✅ Real charts matching the original workbook's embedded Excel charts:
  - Pie chart — Quality Decision Mix (Qty MT)
  - Bar chart — Quality Decision by category (color-coded: green=Prime, red=Reject, amber=Hold, etc.)
  - Combo chart (bar + line) — Top 5 Defects Pareto with cumulative %
  - Bar chart — Defect Intensity Breakdown
  - Bar charts — Work Center & Grade performance
  - Line charts — Monthly and Weekly trends
- ✅ 5 tabs, replicating all sheets from your original workbook
- ✅ All charts are hand-drawn inline SVG (no chart libraries, no CDN — fully offline)
- ✅ No external dependencies (no Flask) — works fully offline

### Note on Monthly/Period Trend
The original workbook pre-lists every month/week through the year 2030 (mostly
showing 0s for future dates that haven't happened yet). This web app instead
shows only the months/weeks that actually have data in your file — cleaner to
read, and it will automatically extend as you add new records via `build_db.py`.

### How the "Previous Period" comparison works
Select exactly ONE time filter (Month, Week, Quarter, or Financial Year) —
leave the others on "All". The dashboard automatically compares against the
immediately preceding period of that type (e.g. selecting "Aug-2026" compares
against "Jul-2026"). If no time filter is selected, comparison is not shown
(same as the original workbook's behaviour).

## 🔐 Admin / Viewer security and data updates
The web app now has two access levels:

- **Viewer:** dashboard, filters, charts and tables are read-only. Viewers cannot add, import or delete records.
- **Admin:** protected `/admin` page for adding one record, bulk importing `.xlsx/.xlsm/.tsv/.csv`, reviewing the latest records and deleting incorrect records. Write APIs are checked server-side, so hiding a button is not the security mechanism.

### Admin credentials
For local testing the default credentials are:
- Username: `admin`
- Password: `ChangeMe@123`

**Before publishing the link, change these using environment variables:**
```
ADMIN_USERNAME=your_admin_name
ADMIN_PASSWORD=your_strong_password
```
Do not put the production password inside the source code or Git repository.

### Adding future data
1. Open the shared dashboard link.
2. Open **🔐 Admin**.
3. Login.
4. Either use **Add One Record** for a single coil/record, or **Bulk Import** for an Excel/TSV/CSV file.
5. The importer validates required fields, skips exact duplicates, and derives Month/Week/Quarter/FY from `Insp Lot Date` when those fields are not supplied.
6. The existing 16 KPIs, filters, charts, tables and dynamic totals read the live database and update after the new records are saved.

### Important for online deployment
The database must live on **persistent storage**. A temporary/free cloud filesystem can be reset when a service restarts or is redeployed. For a company-wide production deployment, use a persistent disk/volume or a managed database. The current package is designed so the SQLite database remains the single source of truth; the dashboard stays read-only for viewers while only authenticated admins can write to it.

### Local sharing
If the server runs on an always-on company PC/server, colleagues can use `http://<server-ip>:8000/`. They do not need Python installed. Keep the server machine secured and use a strong admin password.

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


### Data update included
- Sep-2026 data from the workbook's **Disposition Data** sheet has been imported (116 records), bringing the database to 4,936 records.
- All existing filters are database-driven, so Sep-2026 values automatically appear in Month, Week, Quarter, Financial Year, Work Center, Grade, Quality Decision and Defect Intensity filters and in all dashboard/trend views.


## Render production storage

This app supports a Render Persistent Disk for the SQLite database. The included `render.yaml` mounts a 1 GB disk at `/var/data` and sets `DB_PATH=/var/data/quality.db`. The bundled `quality.db` is copied to that persistent location only if the persistent database does not exist, so normal redeploys do not overwrite admin-imported data.

### Deployment flow
1. Connect the GitHub repository to Render and deploy the Web Service.
2. Use the Blueprint configuration in `render.yaml`, or add the disk manually at `/var/data`.
3. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` as Render environment variables; do not commit them to GitHub.
4. After the first deploy, all Admin imports are written to `/var/data/quality.db`.
5. Future GitHub code pushes trigger Render redeploys, but the persistent database remains intact.

Because SQLite is stored on a persistent disk, keep the service at one instance.

## Free Render + External PostgreSQL

For Render Free, do not use a Render Persistent Disk. Set `DATABASE_URL` in Render Environment Variables to your external PostgreSQL connection string (for example from a free Supabase/Neon project). The app uses PostgreSQL whenever `DATABASE_URL` is present and falls back to SQLite locally when it is absent.

On the first PostgreSQL deployment, if the PostgreSQL `disposition` table is empty, the bundled `quality.db` seed records are copied once. Existing PostgreSQL data is never overwritten by a redeploy. After that, Admin imports are written directly to PostgreSQL, so GitHub/Render code redeploys do not erase the data.

Admin -> Database Status shows provider, record count, used MB, configured capacity and health threshold. `DB_LIMIT_MB` defaults to 500 MB and can be changed if your provider's actual limit differs.

Important: keep `DATABASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in Render Environment Variables, not in GitHub.

## FREE production data setup
For Render Free, use an external PostgreSQL database such as Supabase Free. Set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `DB_LIMIT_MB=500` in Render Environment Variables. See `SUPABASE_RENDER_FREE_SETUP.md` for the exact setup and migration flow.

## Dashboard Export

The live dashboard now provides **Excel, PDF, and CSV** export buttons in the Dashboard Filters toolbar. Exports use the current dashboard filters, so the report matches the selected Month, Work Center, Grade, Decision, Week, Quarter, Financial Year, and Defect Intensity.

- **Excel**: KPI Summary, Defect Analysis, Work Center, Grade Analysis, Monthly/Weekly/Quarterly/FY trend sheets, with totals.
- **PDF**: print-ready KPI summary, defect analysis, work-center and grade tables, with active filters and generation time.
- **CSV**: filtered record-level data for operational use.
- Viewer export endpoints are read-only; Admin-only database backup remains separate.


### Viewer login & activity monitoring
Viewer login is currently disabled. The main dashboard is open to all visitors without username/password. Every dashboard page visit and dashboard action is recorded with the visitor IP address, timestamp, event, tab and browser/user-agent. Admin can review **Dashboard Activity** to see unique IPs, opens, last seen time, browser/device information and recent activity. Named viewer login can be enabled in a future version if required. Admin/data-management APIs remain protected by Admin login.

For the first deployment, the environment-backed `ADMIN_USERNAME` / `ADMIN_PASSWORD` account is automatically created as the administrator. Log in to `/admin`, create viewer accounts, then share those credentials with authorized viewers.

## Admin Control Center (Upgraded)

The Admin Panel now includes:
- Admin Home KPIs: total records, last data update, database size, active admins, dashboard views, last login and failed login attempts.
- Monthly Data Import Wizard for XLSX/XLSM, CSV and TSV/TAB with detect → validate → duplicate check → preview → confirm → summary flow.
- Import preview prevents direct writes to the live database until Confirm Import is clicked.
- Data Quality Monitor with completeness, invalid value, duplicate and missing-intensity checks plus a Data Quality Score.
- Import History for traceability of every confirmed bulk import.
- Exportable Admin Audit Log (up to the latest 5,000 activity entries).
- KPI Target History with old/new target values, effective date, changed-by and timestamp.
- Role-aware administration: Super Admin, Data Admin, Quality Manager and Viewer. Backend permissions restrict sensitive actions by role.
