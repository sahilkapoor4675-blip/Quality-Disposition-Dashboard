# Quality Disposition Control Dashboard — V64.3

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also shown in the `X-App-Version` response
header). `CHANGELOG.md` is the version history; this README always describes the current build only.

## What changed in V64.3 (bug-fix release)
- One HTTP response per request (a mis-chained `if` made every normal route also send a stray `404`).
- Hand-edited or stale filter values (`month=garbage`, `financial_year=junk`, `month=ALL`) no longer cause HTTP 500; they simply have no previous-period comparison.
- Admin Data Quality Monitor tiles now read the keys the server actually returns, and "records require correction" is filled in.
- Defect Intensity is only required for coils that actually have a defect (`NO DEFECT` coils are no longer flagged).
- Drill-down totals and rows use one shared filter builder; bad `page` / `page_size` fall back to defaults.
- Quarterly trend groups by financial year (labels become `Q1 (FY 2026-27)` once more than one FY exists).
- QCR executive trend arrow now compares monthly First Pass Yield correctly.
- KPI target save rejects NaN/infinite values and inverted Target/Warning/Critical bands.
- CSV import accepts Windows-1252 files saved by Excel.
- Switching dashboard tabs always opens the new tab scrolled to the top (previously kept the old tab's scroll position).
- Restoring a backup containing fishbone-import history no longer fails.
- KPI cards no longer show a dead gap on the right; admin danger buttons (Logout/Delete) are readable in light theme; sound effects no longer fail to load when browser storage is blocked.
- Donut/bar/Pareto charts and the 6M Fishbone diagram now use a subtle gradient + soft shadow instead of flat color fills, and the fishbone has a faint watermark behind the spine. Each chart instance has its own gradient/shadow id namespace so charts on the same page never collide.
- Admin: Database panel loads at login; background polling stops while logged out; QA Manager sessions are listed in Security.
- `VERSION.txt` now matches the release.

## Admin console navigation
- Sidebar navigation is grouped into a canonical 21-section sequence; sidebar and content use the same order.
- While scrolling, the active sidebar tab follows the section in view; clicking a tab jumps to the top of that section.
- Overview production-health content and KPI target history live inside their logical parent sections; Import History is in the navigation.
- There is no global search bar in Admin; use **Latest Records** (search + date filters + export/delete).

## What it does
- **Dashboard** – live filters (Month, Week, Quarter, Financial Year, Work Center, Grade, Quality
  Decision, Defect Intensity), KPI cards with period-over-period change, drill-down to underlying coils.
- **Quality Control Room (QCR)** – health score, early warnings, problem finder, why-changed analysis.
- **Work Center & Grade**, **Defects List** (with 6M Fishbone / RCA reference) and **Period Trend** tabs.
- **Compare Periods** – two dashboards side by side; saved views; global search; command palette (Ctrl/⌘+K);
  light/dark theme; works on phones and tablets.
- **Exports** – Excel, PDF, PowerPoint (chart + table on every slide) and raw CSV.
- **Admin console** (`/admin`) – grouped, scroll-synced control center for monitoring, data operations,
  latest records, 6M Fishbone, backups/recovery, security and audit; sidebar order always matches section order.

## Run locally
```bash
pip install -r requirements.txt
python3 server.py            # http://localhost:8000/  (admin console: /admin)
```
Without `DATABASE_URL` the app uses a persistent SQLite file outside the app folder (set `DB_PATH` to choose
the location). The bundled `quality.db` seeds it on the first run only; later restarts and code replacements
never reseed it.

## Production (Render + PostgreSQL)
`render.yaml` and `SUPABASE_RENDER_FREE_SETUP.md` describe the free Render + Supabase setup. On Render the app
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
| `EXPORT_CONCURRENCY`, `EXPORT_WAIT_TIMEOUT_S` | Heavy report export throttling on small hosts |
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

## Security
- Admin APIs require an authenticated admin session plus CSRF validation; login attempts are rate-limited.
- Public activity endpoints are rate-limited separately; request bodies, sessions and import previews are
  size-bounded.
- Server errors (HTTP 5xx) return only a reference id to the browser; the real message is in the server log.
- See `SECURITY.md` for the full baseline.

## Repository layout
| Path | Role |
|---|---|
| `server.py` | HTTP server, API, database layer, imports, backups, admin |
| `reports.py` | Excel / PDF / PowerPoint report builders |
| `index.html`, `app.js`, `app.css`, `sfx.js` | Dashboard UI |
| `admin.html` | Admin console (single file) |
| `supabase_schema.sql` | Reference PostgreSQL schema (startup migrations stay authoritative) |
| `code_health.py` | Maintenance helpers |
| `regression_smoke.py`, `http_smoke.py`, `smoke_test.py`, `regression_test.py`, `regression_v64_3.py`, `export_acceptance.py`, `export_stress.py`, `admin_ux_audit.py` | Release-gate tests |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |

## Release gate
Before deploying, run every command in `RELEASE_GATE.md` (all must pass, on an isolated database).

## Troubleshooting
- **Old look / dark mode wrong after a deploy** – hard-refresh once (Ctrl+Shift+R); CSS and JS are cached
  by version.
- **Uptime monitor shows the service down** – point it at `/healthz` (GET or HEAD).
- **Admin says login required after a restore** – expected: restore replaces the user/session tables; log in again.
