# Quality Disposition Control Dashboard

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also sent in the `X-App-Version` response
header). `CHANGELOG.md` is the version history (V65 onward; older entries are in
`docs/CHANGELOG_ARCHIVE.md`); this README always describes the current build only.

## What it does
- **Dashboard** – live filters (Month, Week, Quarter, Financial Year, Work Center, Grade, Quality
  Decision, Defect Intensity), KPI cards with period-over-period change, drill-down to underlying coils.
- **Quality Control Room (QCR)** – health score, early warnings, problem finder, why-changed analysis.
- **Work Center & Grade**, **Defects List** (with 6M Fishbone / RCA reference) and **Period Trend** tabs.
- **Chemistry SPC** tab – one heat = one point, ordered by heat number. **Filter** box: Month, Week, Quarter, Fin. Year (from the chemistry file's Date column, same labels and April–March financial year as the main dashboard), Grade, Parameter, Heat Qty (last N heats) and Heat No. **Insert** box: element Icon, Centre Line (mean) and Aim Chemistry lines on/off. Below the filters, one big card per main element (Cu + the grade's alloying elements, e.g. Cu / Zn / Ni for Ni-Brass): symbol and picture, then **Cp | Pp**, **Cpk | Ppk** and **Std. Dev. | Std. Dev.** (left column = within σ from the moving range, right column = overall σ), measured against the Standard limits. Then the I-MR control charts and histogram, each showing the **Standard LSL/USL, Aim LSL/USL and the mean**, the Cp/Cpk/Pp/Ppk/σ table of every parameter, the out-of-spec heat list, and every heat joined to its coils' defect/reject data on `heat_no`. There are no Western Electric rules and no KPI cards. Own selectors; the disposition filters do not apply. CSV downloads: Cpk table, heat-wise data of the charted parameter, and the out-of-spec heat list. Data comes from **Admin → Cast Chemistry** (validated import) and **Admin → Spec Limits** (Standard.xlsx import — sheet "Standard" and sheet "AIM" — or manual edit).
- **Compare Periods** – two dashboards side by side; saved views; global search; command palette (Ctrl/⌘+K) with categorised commands and field-name hints;
  light/dark theme; works on phones and tablets.
- **Exports** – Excel, PDF, PowerPoint (chart + table on every slide) and raw CSV.
- **Admin console** (`/admin`) – grouped, scroll-synced control center for monitoring, data operations,
  latest records, 6M Fishbone, backups/recovery, security and audit; sidebar order always matches section order. Results appear as toasts, and long jobs (import, backup/restore, downloads) show a progress bar.
- **Presentation Mode** – drill-downs stay above the presentation overlay and return cleanly to the dashboard when closed (`Esc` closes the drill-down first, preserving Presentation Mode); toolbar titles exclude the fullscreen control glyph.
- **Header clock** – a compact calendar-style clock at the top-right of the header, above Commands: local date plus a live seconds clock in 12-hour AM/PM format, in both light and dark themes.

## Run locally
```bash
pip install -r requirements.txt
python3 server.py            # http://localhost:8000/  (admin console: /admin)
```
Without `DATABASE_URL` the app uses a persistent SQLite file outside the app folder (set `DB_PATH` to choose
the location). The bundled `quality.db` seeds it on the first run only; later restarts and code replacements
never reseed it.

## Production (Render + PostgreSQL)
`render.yaml` and [docs/DEPLOY.md](docs/DEPLOY.md) describe the free Render + Supabase setup. On Render the app
fails closed if `DATABASE_URL` is missing; it never silently falls back to SQLite.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required in production) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Creates the first admin only if that username does not exist yet |
| `DB_LIMIT_MB` | Database size guard (default 500) |
| `DB_PATH` | SQLite file location (local use) |
| `PORT` | Listen port (default 8000) |
| `PGSSLMODE`, `PG_POOL_MIN`, `PG_POOL_MAX` | PostgreSQL SSL mode and pool size |
| `BACKUP_SCHEDULE_HOURS`, `BACKUP_KEEP` | Automatic backup interval and retention |
| `EXPORT_CONCURRENCY`, `EXPORT_WAIT_TIMEOUT_S` | Heavy report export throttling on small hosts (`EXPORT_CONCURRENCY` defaults to `1`) |
| `TRUST_PROXY_HEADERS` | Honour `X-Forwarded-*` behind Render's proxy |
| `APP_VERSION` | Optional override; by default read from `VERSION.txt` |

Set these in the Render dashboard, never in Git.

Health probes: `GET`/`HEAD /healthz` and `/readyz` (no database access; `render.yaml` uses `/readyz`).

## Data rules
- A normalised, non-empty `BATCH NO` identifies one coil. Existing legacy duplicates are never deleted
  automatically.
- Imports (`.xlsx/.xlsm/.csv/.tsv`) are validated and previewed before writing; each data-changing import
  creates a safety backup. Imports are transaction-locked so concurrent uploads cannot create the same batch.
- CSV exports neutralise spreadsheet-formula characters.

## Backups
JSON-GZIP snapshots with integrity checksums, created after every import, on demand (Admin → Backups) and on
a schedule. Restore verifies the checksum first and rolls back on failure. The built-in backup is a recovery
aid, not a substitute for provider-level backups: copy backups off the server periodically.

Disaster recovery (recovery points, off-site copies, restore, provider switch): [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md). Off-site bucket / encryption / alert setup: [docs/DEPLOY.md](docs/DEPLOY.md).

## Security
- Admin APIs require an authenticated session plus CSRF validation; sensitive Users, Security, Backup and audit-export endpoints are Super Admin (`admin` role) only; login attempts are rate-limited.
- Public activity endpoints are rate-limited separately; request bodies, sessions and import previews are
  size-bounded.
- `script-src` has no `'unsafe-inline'`: every inline `<script>` is stamped with a random per-request
  nonce, and interactive admin rows use `data-action` attributes + `addEventListener` delegation rather
  than `onclick="..."`, so an injected `<script>` tag can't execute even if it reaches the page.
- Server errors (HTTP 5xx) return only a reference id to the browser; the real message is in the server log.
- See [docs/SECURITY.md](docs/SECURITY.md) for the full baseline.

## Admin console navigation
- Sidebar navigation is grouped into a canonical 23-section sequence; sidebar and content use the same order.
- While scrolling, the active sidebar tab follows the section in view; clicking a tab jumps to the top of that section.
- Overview production-health content and KPI target history live inside their logical parent sections; Import History is in the navigation, followed by Cast Chemistry and Spec Limits (Chemistry SPC data).
- There is no global search bar in Admin; use **Latest Records** (search + date filters + export/delete).

## Repository layout

The repository root holds **only what the running app needs** (the server serves these files by name
from the root, so they must stay there). Tests and documentation live in their own folders.

| Path | Role |
|---|---|
| `server.py` | HTTP server, API, database layer, imports, backups, admin |
| `reports.py` | Excel / PDF / PowerPoint / CSV report builders |
| `chem_spc.py` | Chemistry import validation, spec matching and SPC maths (pure functions; tested by `tests/test_chem_spc.py`) |
| `alerts.py`, `logging_setup.py`, `session_store.py` | Backup-failure alerts, rotating logs, session/login store |
| `dr_storage.py`, `dr_recovery.py`, `dr_pg_backup.py` | Off-site storage, snapshot verify/restore CLI, PostgreSQL dump runner (used by the GitHub Action) |
| `index.html`, `sfx.js` | Dashboard UI |
| `src/js/`, `src/css/` | `app.js` / `app.css` source, split into small numbered files — see "Frontend source layout" below |
| `admin.html` | Admin console (single file) |
| `sw.js`, `site.webmanifest`, `favicon*`, `jsl-*.png`, `intro-photo-*.webp` | PWA shell and images |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |
| `supabase_schema.sql` | Reference PostgreSQL schema (startup migrations stay authoritative) |
| `requirements.txt`, `runtime.txt`, `render.yaml`, `Procfile`, `.env.example`, `VERSION.txt` | Deployment config |
| `.github/workflows/` | `dr-backup.yml` (12-hourly PostgreSQL dump), `dependency-audit.yml` (weekly `pip-audit`) |
| `tests/` | Release gate: `run_gate.py` runs `static_checks.py`, `regression.py`, `test_units.py`, `test_smoke.py`, `test_chem_spc.py`, `test_data_lifecycle.py`, `test_exports.py`, `test_browser.py` |
| `tools/self_host_fonts.sh` | One-time script to self-host Google Fonts locally (see "Fonts" below) — not needed for the app to run |
| `docs/` | `DEPLOY.md`, `DISASTER_RECOVERY.md`, `SECURITY.md`, `CHANGELOG_ARCHIVE.md` |

## Frontend source layout

`app.js` and `app.css` are not files in the repo — they're built by `server.py` at request time by concatenating:

- `src/js/01-…` through `src/js/22-…` (filename order = script load order), and
- `src/css/01-…` through `src/css/15-…` (filename order = cascade order — later files can override earlier ones, same as before the split).

Every piece is cut on a safe boundary (a top-level JS statement, or a top-level CSS rule/comment), so each file is independently valid and the join is byte-for-byte identical to the old single `app.js`/`app.css`. The browser still only ever requests one `/app.js` and one `/app.css`; nothing about page load or the CSS cascade changed.

**When you fix a bug, upload only the one `src/js/NN-*.js` or `src/css/NN-*.css` file that changed** — not the whole bundle. The filename tells you what's inside (e.g. `15-chart-builders.js`, `06-qcr.css`). If you ever need the full single-file `app.js`/`app.css` (e.g. to hand to a tool that expects one file), request it against a running instance — `GET /app.js` / `GET /app.css` returns the built bundle.

## Fonts
By default the dashboard loads Google Fonts (DM Sans, Sora, Outfit, Allura) non-blocking from
`fonts.googleapis.com` — if that's slow or blocked on your network, the page still renders immediately
with fallback fonts. To remove that dependency entirely, run `bash tools/self_host_fonts.sh` on any
machine with internet access, then follow the printed instructions to switch `index.html` over to the
local copy it downloads into `fonts/`.

## Release gate
Before deploying, run one command from the repository root (isolated temporary databases only — never
point it at production):

```bash
python tests/run_gate.py          # everything, ~2 min (py_compile, node --check, static checks, 6 regression suites, unit tests, smoke, data lifecycle, exports + stress, browser)
python tests/run_gate.py --fast   # same, minus the slow export stress test
```

Every check must pass. The browser check (`test_browser.py`) drives a real headless Chromium and needs
`pip install playwright && playwright install chromium`; it's optional — without it, the gate prints
`[SKIP] browser (Chromium UI regression)` and still runs everything else. Export rules: Excel/PDF/PPTX
tables keep all source rows (no silent top-N truncation) and every PPTX chart section keeps its chart
image and table. After deploying, check that `/api/admin/service_health` reports `latest_data_date` and
`freshness_age_days`, then hard-refresh the browser (Ctrl+Shift+R) once so the new CSS/JS loads.

## Troubleshooting
- **Old look / dark mode wrong after a deploy** – hard-refresh once (Ctrl+Shift+R); CSS and JS are cached
  by version.
- **Uptime monitor shows the service down** – point it at `/healthz` (GET or HEAD).
- **Admin says login required after a restore** – expected: restore replaces the user/session tables; log in again.

## UI notes
### Header Design
The dashboard uses the approved **Design 4 — Industrial Copper** header: static copper-base coil/plant artwork on a steel-inspired surface, JSL orange/graphite diagonal accents, and the existing Quality Intelligence typography preserved as-is. The compact right-side toolbar remains bottom-aligned with the date/time card above it. The same composition adapts for the dark theme.

### UI note — Intro screen
The cursor-following Field Name Hover Tag is intentionally disabled on the introduction/splash screen and remains active across the dashboard/admin fields.

### Cursor-following Field Name Hover Tag
The field-name hover tag is enabled across the main dashboard and Admin UI, including dynamically rendered controls. The Intro/Splash screen is intentionally excluded.

### Header live-status behavior
- The **LIVE DATA** indicator includes a subtle pulsing status dot in the main dashboard header.
- The pulse is CSS-based and remains unobtrusive while indicating the live state.
- Existing Dashboard/Admin cursor-following field hints remain enabled; the Intro/Splash screen is excluded.

### Chemistry SPC — data rules
- **Key:** the workbook's `Coil No.` is the `heat_no` of the disposition table; one heat = one SPC point. Columns are matched by header name, so sheets with a different column order, extra columns (Hardness, Conductivity, HF No.) or a Date column (it is ignored) import fine.
- **Import checks (admin):** blank/odd heat numbers, duplicate heats in the file (identical = skipped, conflicting = all copies rejected), text (a trailing % sign is accepted) or out-of-range % (below 0 / above 100), `Total%` far from the sum of the elements, alloy that does not fit the heat prefix, denomination that does not fit the sheet (not checked for sheet names of 30+ characters, which Excel may have truncated), analyst-name typos, and values more than one spec width outside the limits. Errors skip the row; warnings import it. Nothing is written until **Confirm**; a recovery point is taken first.
- **Re-import:** the same heat updates in place (numbers are overwritten, changes are listed); identical rows are counted as unchanged; heats not in the file are never deleted. A blank analyst/sheet in the new file keeps the stored value.
- **Spec matching:** sheet name → alloy code → denomination (for alloys with several specs, e.g. Ni-Brass 5 Rs vs 10/20 Rs). Specs are matched when charts are drawn, so editing a spec applies instantly. Heats with no matching spec are charted without LSL/USL.
- **Maths:** I-chart limits = mean ± 3·MR̄/1.128, MR-chart UCL = 3.267·MR̄, Cp/Cpk use the within-σ (MR̄/d2), Pp/Ppk the overall standard deviation. Lower limits of 0 (impurity-type) are treated as "no lower limit". `Total%` gets an out-of-spec count only (it is a sum, so Cp/Cpk are not meaningful).
