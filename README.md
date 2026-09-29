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
- Sidebar navigation is grouped into a canonical 21-section sequence; sidebar and content use the same order.
- While scrolling, the active sidebar tab follows the section in view; clicking a tab jumps to the top of that section.
- Overview production-health content and KPI target history live inside their logical parent sections; Import History is in the navigation.
- There is no global search bar in Admin; use **Latest Records** (search + date filters + export/delete).

## Repository layout

The repository root holds **only what the running app needs** (the server serves these files by name
from the root, so they must stay there). Tests and documentation live in their own folders.

| Path | Role |
|---|---|
| `server.py` | HTTP server, API, database layer, imports, backups, admin |
| `reports.py` | Excel / PDF / PowerPoint / CSV report builders |
| `alerts.py`, `logging_setup.py`, `session_store.py` | Backup-failure alerts, rotating logs, session/login store |
| `dr_storage.py`, `dr_recovery.py`, `dr_pg_backup.py` | Off-site storage, snapshot verify/restore CLI, PostgreSQL dump runner (used by the GitHub Action) |
| `index.html`, `app.js`, `app.css`, `sfx.js` | Dashboard UI |
| `admin.html` | Admin console (single file) |
| `sw.js`, `site.webmanifest`, `favicon*`, `jsl-*.png`, `intro-photo-*.webp` | PWA shell and images |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |
| `supabase_schema.sql` | Reference PostgreSQL schema (startup migrations stay authoritative) |
| `requirements.txt`, `runtime.txt`, `render.yaml`, `Procfile`, `.env.example`, `VERSION.txt` | Deployment config |
| `.github/workflows/` | `dr-backup.yml` (12-hourly PostgreSQL dump), `dependency-audit.yml` (weekly `pip-audit`) |
| `tests/` | Release gate: `run_gate.py` runs `static_checks.py`, `regression.py`, `test_units.py`, `test_smoke.py`, `test_data_lifecycle.py`, `test_exports.py`, `test_browser.py` |
| `tools/self_host_fonts.sh` | One-time script to self-host Google Fonts locally (see "Fonts" below) — not needed for the app to run |
| `docs/` | `DEPLOY.md`, `DISASTER_RECOVERY.md`, `SECURITY.md`, `CHANGELOG_ARCHIVE.md` |

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
