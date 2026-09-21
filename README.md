# Quality Disposition Control Dashboard — V63.7

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also shown in the `X-App-Version` response
header). `CHANGELOG.md` is the version history; this README always describes the current build only.

## What it does
- **Dashboard** – live filters (Month, Week, Quarter, Financial Year, Work Center, Grade, Quality
  Decision, Defect Intensity), KPI cards with period-over-period change, drill-down to underlying coils.
- **Quality Control Room (QCR)** – health score, early warnings, problem finder, why-changed analysis.
- **Work Center & Grade**, **Defects List** (with 6M Fishbone / RCA reference) and **Period Trend** tabs.
- **Compare Periods** – two dashboards side by side; saved views; global search; command palette (Ctrl/⌘+K);
  light/dark theme; works on phones and tablets.
- **Exports** – Excel, PDF, PowerPoint (chart + table on every slide) and raw CSV.
- **Admin console** (`/admin`) – add/import records, validation, users and roles, KPI targets, 6M Fishbone
  import, audit trail, backups and restore, service/database health.

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
| `periods.py` | Month / week / quarter / financial-year helpers |
| `index.html`, `app.js`, `app.css`, `sfx.js` | Dashboard UI |
| `admin.html` | Admin console (single file) |
| `supabase_schema.sql` | Reference PostgreSQL schema (startup migrations stay authoritative) |
| `build_db.py`, `add_favicon.py`, `code_health.py` | Maintenance helpers |
| `regression_smoke.py`, `http_smoke.py`, `smoke_test.py`, `regression_test.py`, `export_acceptance.py`, `export_stress.py` | Release-gate tests |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |

## Release gate
Before deploying, run every command in `RELEASE_GATE.md` (all must pass, on an isolated database).

## Troubleshooting
- **Old look / dark mode wrong after a deploy** – hard-refresh once (Ctrl+Shift+R); CSS and JS are cached
  by version.
- **Uptime monitor shows the service down** – point it at `/healthz` (GET or HEAD).
- **Admin says login required after a restore** – expected: restore replaces the user/session tables; log in again.
