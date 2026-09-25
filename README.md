# Quality Disposition Control Dashboard — V65.0

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also shown in the `X-App-Version` response
header). `CHANGELOG.md` is the version history; this README always describes the current build only.

## What changed in V65.0 (presentation mode fits screen, field-name hover tag, icons; header/intro are the plain Classic look)
- **Presentation mode fits at 100% zoom:** legend, chart and table share the screen; nothing overlaps and nothing needs zooming out. Chart is reshaped to the free space, the table scrolls inside itself (max 38% height).
- **Field-name hover tag:** a small tag near the cursor names the field (KPI parts, table column + row, filters, legends, icon-only buttons). Ctrl+K → "Field Name Hints" toggles it.
- **Intro screen bug fixed:** the "QUALITY INTELLIGENCE" headline could break mid-word ("INTEL" / "LIGENCE") on narrow screens; each word is now one unbreakable unit.
- **Icons:** one SVG sprite (top of `index.html`) + `qdIc('name')` in `app.js`; added to filters, selection, presets, export, search, drill-down, compare, Control Room headings, presentation mode.
- **Admin icons:** the Admin console has the same icon set; every button label (including dynamically built ones) gets a matching icon, plus login fields, section kickers and the theme toggle.
- **Chart tooltip** now has styling (it had none) and names the measure on single-series charts.
- **"Copper Mill" theme shipped and then removed within this same release:** an animated factory-bay header and a redesigned intro (copper coils, "Cu 29" mark, scan-line + "QC SCAN PASSED" panel) were added and later reverted per feedback. The dashboard always shows the plain **Classic** header and intro now; there's nothing to switch, so no theme command remains in Ctrl+K.

### V65.0 checkpoints
- Browser at 100%: open the expand button on every chart. Chart, legend and table are fully visible with no overlap.
- Hover a KPI value, a table header and a table cell: the tag shows KPI name / column name / column + "Row: …".
- Filters, Selection, Save/Manage Presets, Export, Commands, Search show icons.
- Fresh browser, no prior `localStorage`: dashboard loads with the plain Classic header and intro — no coil artwork, no scan-line/badge sequence, no swinging 3D logo. Ctrl+K has no "Theme" entry.

The bundled `quality.db` is unchanged (4,936 disposition rows).

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

## Security
- Admin APIs require an authenticated session plus CSRF validation; sensitive Users, Security, Backup and audit-export endpoints are Super Admin (`admin` role) only; login attempts are rate-limited.
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
| `regression.py`, `http_smoke.py`, `smoke_test.py`, `export_acceptance.py`, `export_stress.py`, `admin_ux_audit.py` | Release-gate tests |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |

## Release gate
Before deploying, run every command in `RELEASE_GATE.md` (all must pass, on an isolated database).
The regression suite is consolidated into a single `regression.py`; deleted legacy `regression_*.py` files are not required at runtime.

## Troubleshooting
- **Old look / dark mode wrong after a deploy** – hard-refresh once (Ctrl+Shift+R); CSS and JS are cached
  by version.
- **Uptime monitor shows the service down** – point it at `/healthz` (GET or HEAD).
- **Admin says login required after a restore** – expected: restore replaces the user/session tables; log in again.
