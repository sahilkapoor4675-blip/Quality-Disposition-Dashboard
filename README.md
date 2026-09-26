# Quality Disposition Control Dashboard — V65.0

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also shown in the `X-App-Version` response
header). `CHANGELOG.md` is the version history; this README always describes the current build only.

## What changed in V65.0 (follow-up: frontend sorting, QCR KPI animation, drilldown safety, filter refresh feedback)
- **Table sorting handles signed numeric and unit-suffixed values correctly.** Sorting now normalises signed numbers, percentages, and common `pp` / `pts` / `MT` / `coils` suffixes before comparison, so trend/change columns sort by their numeric value instead of their displayed string.
- **Quality Control Room KPI count-up animation fixed.** The shared KPI animation helper now accepts both the Dashboard and QCR animation cancellation tokens, restoring QCR numeric count-up on refreshes.
- **Drilldown rendering hardened against missing optional elements.** Title, subtitle, count, scope, and export element access is guarded so partial markup or future UI refactors do not crash the entire drilldown render.
- **Filter refresh feedback fixed.** The filter bar's `filter-pulse` animation is explicitly retriggered on every filter change by removing the class, forcing a reflow, and re-adding it.
- **Reduced-motion support preserved.** The new filter pulse is disabled under `prefers-reduced-motion: reduce`; no database, API, schema, or data changes were made.

## What changed in V65.0 (follow-up: SQLite WAL mode for concurrency/lag, sticky-filter scroll-jank fix)
- **Enabled SQLite WAL mode** so readers no longer block behind a writer (and vice versa) the way the old default journal mode did. Benchmarked under a workload shaped like this app's real traffic (concurrent readers + a batch writer): writer stall time dropped from 4.67s to 0.45s — about 10x. Pure concurrency/perf change; no schema or data change, fully reversible, and confirmed not to affect the existing backup/restore mechanism.
- **Fixed the sticky filter bar's scroll jank.** Its glass-blur effect (`backdrop-filter`) has to be recomputed every scroll frame while it stays pinned at the top — added a standard `will-change` compositing hint (no visual change) and now drop the blur entirely for anyone with OS-level reduced-motion enabled. Checked the rest of the UI for likely jank sources too: animations already respect `prefers-reduced-motion`, scroll/resize handlers were already debounced/`requestAnimationFrame`-throttled, and network responses are already gzip-compressed with long-lived immutable caching on static assets.
- Full regression pass — all suites pass; see `CHANGELOG.md` for the complete write-up.

## What changed in V65.0 (follow-up: structured logging, multi-instance session/login sync, streaming CSV export, dead-CSS cleanup, dependency-vulnerability CI)
- **Structured, rotating logging.** Every `print()` in `server.py` now goes through `logging` (see `logging_setup.py`): unchanged console output, plus a JSON-lines rotating file (`<persistent dir>/logs/app.log`) so operational history survives a redeploy. New admin endpoint `GET /api/admin/system_log` tails it in-app.
- **Admin visibility into rate limiting.** New `GET /api/admin/rate_limit_status` (and a matching panel in Admin → Security) shows who's tracked/throttled by the general per-IP request limiter and the login brute-force lockout, including currently locked-out IPs.
- **Sessions and login-attempt tracking now sync across instances when running on Postgres** (`session_store.py`). SQLite deployments (single process by construction) are completely unaffected; on Postgres, a login on one instance is now recognized by another, and brute-force lockout counts attempts across every instance rather than just the one that saw them.
- **`/api/export/csv` streams instead of loading the whole export into memory.** Rows are pulled and sent in batches instead of one `fetchall()` + one big in-memory CSV string + one more encoded copy — the shape of the file is unchanged, but an export of the largest imports this app is designed to hold no longer risks a large memory spike.
- **Removed 110 confirmed-dead CSS rules (~11 KB)** — an entire legacy "Quality Intelligence" styling section the current UI no longer uses — after teaching `code_health.py`'s orphan detector to stop flagging classes that `app.js` builds dynamically at runtime (which would otherwise have been false positives for anyone acting on its report).
- **Added CI dependency-vulnerability scanning** (`.github/workflows/dependency-audit.yml`, `pip-audit` on every change/PR/weekly). Ran it locally against the current pins: no known vulnerabilities found.
- **Fixed a locking bug the streaming CSV change would otherwise have introduced** (and a related pre-existing robustness gap): an open export cursor briefly overlapped with an unrelated activity-log write on SQLite, and that write's error handler leaked its connection on failure instead of closing it — caught by the full regression suite before shipping, fixed on both sides.
- Full regression pass (all `regression.py` suites, smoke test, export acceptance/stress, HTTP smoke across 47 endpoints, admin UX audit, code health) plus a fresh Python compile check — all pass. See `CHANGELOG.md` for the complete write-up.

## What changed in V65.0 (follow-up audit: session-lock race fixed, no version bump)
- **Fixed:** the admin `/api/logout` endpoint removed a session from the shared, in-memory session store without taking the `SESSION_LOCK` that every other session read/write in `server.py` uses (login, viewer logout, revoke-session, change-password, user-toggle, and the periodic session-cleanup sweep all take it, since the server runs one thread per request). Under concurrent admin traffic this could occasionally race with one of those locked operations and surface as an unrelated request failing with a dictionary-mutation error. The pop is now taken under the same lock as everywhere else; the logout response and cookies are unchanged.
- **Verified:** every release-gate script (smoke test, all regression suites including security/session hardening, HTTP smoke across 47 endpoints, admin UX audit) plus a Python compile check and a JavaScript syntax check of `app.js` all pass. This was the only defect found in this pass.

## What changed in V65.0 (full audit pass, one bug fixed)
- **Fixed:** `admin.html` had two elements sharing `id="admin-field-hints"` (a `<style>` tag and a `<script>` tag), which is invalid HTML and was failing the project's own `admin_ux_audit.py` check. Renamed to `admin-field-hints-style` / `admin-field-hints-script`; nothing else referenced the old id, so this is a pure fix with no behavior change.
- **Verified:** every release-gate script (smoke test, all regression suites, HTTP smoke across 47 endpoints, code-health, admin UX audit, Excel/PDF/PPTX export acceptance and stress tests) passes, plus a full Python compile check and a JavaScript syntax check of every inline script in `index.html` and `admin.html`. This was the only defect found.

## What changed since V65.0 (intro screen side imagery)
- **Intro screen — clean side imagery, no baked-in text:** the splash screen now shows real plant photography faded in along the left and right edges (industrial plant on the left, copper-coil warehouse on the right) instead of the old illustrated coil background. The images sit behind the text and fade toward the centre, so they never overlap the headline, cards or "Enter Dashboard" button; they also narrow and dim on phone-width screens. All text stays live DOM/CSS, not baked into any image.

## What changed in V65.0 (presentation mode fits screen, field-name hover tag, icons; header/intro are the plain Classic look with a gradient accent + progress fill)
- **Presentation mode fits at 100% zoom:** legend, chart and table share the screen; nothing overlaps and nothing needs zooming out. Chart is reshaped to the free space, the table scrolls inside itself (max 38% height).
- **Field-name hover tag:** a small tag near the cursor names the field (KPI parts, table column + row, filters, legends, icon-only buttons). Ctrl+K → "Field Name Hints" toggles it.
- **Intro screen bug fixed:** the "QUALITY INTELLIGENCE" headline could break mid-word ("INTEL" / "LIGENCE") on narrow screens; each word is now one unbreakable unit.
- **Icons:** one SVG sprite (top of `index.html`) + `qdIc('name')` in `app.js`; added to filters, selection, presets, export, search, drill-down, compare, Control Room headings, presentation mode.
- **Admin icons:** the Admin console has the same icon set; every button label (including dynamically built ones) gets a matching icon, plus login fields, section kickers and the theme toggle.
- **Chart tooltip** now has styling (it had none) and names the measure on single-series charts.
- **"Copper Mill" theme shipped and then removed within this same release:** an animated factory-bay header and a redesigned intro (copper coils, "Cu 29" mark, scan-line + "QC SCAN PASSED" panel) were added and later reverted per feedback. The dashboard always shows the plain **Classic** header and intro now; there's nothing to switch, so no theme command remains in Ctrl+K.
- **Intro screen — logo scale-in + progress fill:** the logo entrance pairs a subtle scale-up with its fade, and a thin blue→orange progress bar fills under it across the whole reveal sequence, fading out as "Enter Dashboard" unlocks. Skipped under reduced-motion.
- **Header — gradient accent strip:** a thin brand-gradient line across the header's top edge (separate light/dark tones) plus a subtle glass-style top highlight, standing in for the old illustrated header scene without any decorative artwork.
- **Header — clock stacked above Commands again, no gap under the logo:** reverted a brief "one row" layout so the clock sits above the Live Data / Export / Commands row as it did a couple of releases back, and bottom-aligned the logo/title block against that row so no gap opens up underneath it.
- **Intro screen — "Enter Dashboard" delay removed:** the button no longer waits behind a leftover, invisible Copper Mill scan-badge animation; it now appears right after the intro cards finish, roughly 2 seconds sooner.

### V65.0 checkpoints
- Browser at 100%: open the expand button on every chart. Chart, legend and table are fully visible with no overlap.
- Hover a KPI value, a table header and a table cell: the tag shows KPI name / column name / column + "Row: …".
- Filters, Selection, Save/Manage Presets, Export, Commands, Search show icons.
- Fresh browser, no prior `localStorage`: dashboard loads with the plain Classic header and intro — no coil artwork, no scan-line/badge sequence, no swinging 3D logo. Ctrl+K has no "Theme" entry.
- Intro: logo scales up while fading in; a thin gradient progress bar fills and then fades out right as "Enter Dashboard" unlocks. With reduced-motion set, the bar never appears.
- Header shows a thin blue→orange gradient line across its top edge in both light and dark theme.
- Header: clock sits directly above the Live Data / Export / Commands row, with the logo/title block bottom-aligned to that row (no gap underneath), at desktop, tablet and phone widths.
- Loading the dashboard: "Enter Dashboard" unlocks shortly after the intro cards finish, with no extra silent pause.

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
- **Quality Control Room tab felt slow the first time it was opened, but instant after that** – fixed: `app.js`
  now warms the QCR data cache (`prefetchQcrCore()`) in the background right after the landing tab (usually
  Dashboard) finishes loading, instead of only warming it after a later filter change. See `CHANGELOG.md`.

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
