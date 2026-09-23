### Latest V64.6 header alignment + Live Users relocation patch (2026-09-23)

- Fixed the header's "Last Updated" block floating unevenly relative to the clock/Live Data/Commands cluster — it now bottom-aligns with that row, matching how the header looked before the digital clock was added.
- Removed the "NOW ACTIVE" live-user pill from the header. The same live count now shows as "🟢 Live Now" inside Admin → Activity, next to the other activity stats. Heartbeat tracking from the dashboard is unchanged — only the display location moved.
- No app-version bump; see `CHANGELOG.md` for the full entry.

### Latest V64.6 KPI stagger / toast cap / font fallback patch (2026-09-23)

- KPI cards now animate in with a subtle stagger on refresh instead of all flashing at once (respects reduced-motion).
- Toast notifications are capped at 4 visible at a time (oldest auto-dismisses when more arrive) and the toast stack now scrolls instead of overflowing the viewport if it ever gets long.
- The "QUALITY INTELLIGENCE" script-font title now falls back to a real serif (Georgia/Times New Roman) instead of the unpredictable generic `cursive` keyword if the Allura webfont fails to load.
- Checked and confirmed already in place: filter dropdown search, Google Fonts `display=swap`, and `fonts.gstatic.com` preconnect.
- No app-version bump; see `CHANGELOG.md` for the full entry.

### Latest V64.6 header clock + card elevation patch (2026-09-23)

- Removed the redundant "Current Time" label text from the header clock widget; it now shows just a calendar/clock icon, date and live time, colored to match the header's blue brand palette. Position unchanged — still directly above the Commands button.
- Introduced a shared elevation design-token scale (`--radius-card`, `--radius-menu`, `--radius-modal`, `--shadow-card`, `--shadow-card-hover`, `--shadow-sticky`, `--shadow-menu`, `--shadow-modal`) and applied it to every card/panel surface (`.kpi-card`, `.panel`, `.insights-panel`, `.qcr-hero`, `.filters`, `.filter-menu`, `.drill-dialog`), fixing a corner-radius mismatch (10/11/12px) between panels and KPI cards.
- Fixed a dark-mode bug where panels, filters, and the insights banner kept a light, blue-tinted shadow instead of a proper dark one; the token-based approach fixes this automatically for every surface that uses it.
- Raised dark-mode secondary/muted text color for better contrast (≈6.6:1 → ≈8.5:1 against the dark card background), improving legibility of the header kicker/sub-lines and other muted text in dark mode.
- Bumped the `app.css` cache-buster so the update isn't served from a stale browser cache.
- No app-version bump; see `CHANGELOG.md` for the full entry.

### Latest V64.6 time/display patch

- All visible UI time values now use **12-hour time with AM/PM**; operational timestamps show seconds only where useful.
- The main dashboard header now includes a **live digital clock** with seconds. It refreshes every second while visible.
- Admin server timestamps are parsed as UTC when they arrive without an explicit timezone, then displayed in the browser's local timezone to avoid timestamp drift caused by browser-local parsing.
- Fixed the Admin `R` keyboard shortcut so it uses the canonical loaded-panel refresh path.
- Static Admin version metadata is aligned to **V64.6**.
- No database seed/data files were modified and no application version bump was made.


### Latest V64.6 full-audit patch

- Primary dashboard tabs now use the same blue-gradient visual family as table headers in both light and dark themes; QCR contribution sub-tabs remain separate.
- A full Admin refresh audit found and removed a legacy `refreshBtn` override that could restore the old all-panels request burst.
- Home, Data Quality, Records and Database Status are now part of the explicitly tracked 60-second live refresh set from initial load.
- Manual Admin refresh preserves the current Records query/date/record-id/page state.
- V64.6 remains the runtime version; no application version bump was made.

### UI improvement suggestions for a future approved pass
The following are intentionally **suggestions only** and are not implemented in the current build:
- compact data-status strip (active filters, data-through date, last refresh)
- optional chart label-density mode for crowded cards
- single “Reset view” action for filters + sorting + saved views
- remembered table-density presets

### Full webapp re-audit verification
- `code_health.py` — PASS
- `regression_smoke.py` — PASS
- `regression_v64_3.py` — PASS
- `regression_v64_5.py` — PASS
- `regression_v64_6.py` — PASS
- `admin_ux_audit.py` — PASS (21 sections)
- `smoke_test.py` — PASS
- `http_smoke.py` — PASS (47 routes)
- `export_acceptance.py` — PASS
- `export_stress.py` — PASS


### V64.6 latest audit patch

- Primary navigation tabs now match the dashboard table-header blue-gradient family in light and dark themes.
- Admin manual refresh now uses the optimized loaded-panel refresh path instead of the legacy all-panel request storm.
- Home, Data Quality, Records, and Database Status are included in the 60-second live refresh set.
- Records search/date/page state is preserved during manual Admin refresh.
- V64.6 remains the application version; only asset cache-busters were advanced.

# Quality Disposition Control Dashboard — V64.6

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also shown in the `X-App-Version` response
header). `CHANGELOG.md` is the version history; this README always describes the current build only.

## What changed in V64.6 (sorting + targeted chart/QCR/card-heading refinement)
- **Three-state table sorting:** click a dashboard table header once for ascending order, twice for descending order, and a third time to restore the natural/server order. Sort state is preserved through filter refreshes until the third click resets it.
- **Accessible sort state:** sortable headers expose `aria-sort` as `ascending`, `descending`, or `none`.
- **Targeted chart precision:** only the Dashboard **Decision Mix donut chart** shows Qty (MT) and % values to exactly 3 decimal places. Pareto, Work Center, Grade, Intensity and Period Trend charts retain their prior display precision.
- **QCR 6M Fishbone → RCA header:** the RCA table header uses the same blue-gradient palette as dashboard table headers in both light and dark themes.
- **Dashboard card-heading polish:** only card headings in Dashboard, Work Center & Grade, Defect List and Period Trend use a subtle navy/blue gradient, very soft depth shadow and thin blue accent line. Existing heading text is unchanged. QCR/Admin headings are intentionally not restyled by this rule.
- **No version bump:** this follow-up remains **V64.6**; runtime version metadata is unchanged. `app.js` is explicitly included so the Decision Mix donut formatter is actually deployed, and the JS/CSS asset cache-busters advance without changing the runtime version.
- **UI polish:** numeric table cells use tabular numerals for cleaner visual alignment; existing sticky filters, chart hover/focus cues and sort-state indicators remain enabled.

### V64.6 re-audit checkpoints
- Same table header, three clicks = ascending → descending → natural order.
- Sorted header has `aria-sort="ascending"` or `"descending"`; reset returns the sortable headers to `aria-sort="none"`.
- Decision Mix donut Qty/% values show 3 fractional digits; all other chart precision remains at the existing V64.5 contract.
- `app.js` is part of the V64.6 follow-up patch; this is required for the donut formatter and three-state sort behavior to actually reach the browser.
- Dashboard/drill/RCA numeric cells use tabular numerals; this changes alignment only, not numeric values.
- QCR 6M Fishbone → RCA header uses the same blue gradient as dashboard tables in light and dark mode.
- Dashboard, Work Center & Grade, Defect List and Period Trend card headings keep their original text and receive the scoped gradient/accent/shadow treatment in both themes.
- QCR, Admin and drill-down headings are not affected by the new dashboard-card heading rule.

## What changed in V64.5 (Admin correctness, performance, freshness + security hardening)
- **Data freshness fixed:** Admin service health and Overview now measure freshness from the latest `disposition.insp_lot_date` (“Data Through”), never from dashboard activity/heartbeat timestamps. Activity remains monitoring-only metadata.
- **Freshness mismatch fixed:** the Admin header chip and Overview KPI use the same source-date definition and show the data age in days. Missing source dates are reported as a warning instead of a healthy state.
- **Admin request storm reduced:** the old chain of delayed `showAdmin()` wrappers and duplicated 60-second timers was replaced by one centralized lazy loader. Overview/Data Quality/Latest Records are loaded first; deeper sections load when first viewed.
- **Polling consolidated:** background Admin polling now refreshes only the already-used live monitoring sections once per minute while the page is visible. Deep governance/backup/report sections are not re-fetched unless opened.
- **Backup list performance fixed:** `/api/admin/backup/list` no longer decompresses and parses every retained backup on every refresh. Validated metadata is cached with a file signature and invalidated whenever backups change.
- **Viewer heartbeat load reduced:** public dashboard heartbeat cadence changed from 20 seconds to 30 seconds and only runs while the tab is visible. The live-user window is 90 seconds and the live-user count is briefly cached to absorb concurrent requests.
- **Data Quality query optimized:** the old set of independent full-table scans and repeated duplicate subqueries is now one conditional aggregate plus a small duplicate-group query. Duplicate correction counts still represent distinct records.
- **Quality Records invalid-date check optimized:** invalid dates are filtered in SQL instead of loading the entire disposition table into Python. Duplicate-batch grouping is handled through a CTE.
- **Records total optimized:** the unfiltered live record count used by Admin Records is cached briefly and cleared after data mutations.
- **Import preview race fixed:** previews store the disposition mutation revision. Confirm refuses to proceed when the underlying disposition dataset changed after Preview, forcing a fresh preview rather than applying stale review numbers.
- **Mutation revision tracking added:** an idempotent `app_state` table tracks `disposition_revision` and `disposition_changed_at`; inserts/updates, deletes, bulk deletes and restores advance the revision atomically.
- **Session revocation fixed:** disabling a user immediately removes all of that user’s in-memory sessions. Viewer authentication also rejects sessions marked inactive.
- **Sensitive Admin authorization tightened:** Users, security session status, backup list/verify/download and audit analytics/export are now Super Admin-only at the backend. UI visibility remains a convenience, not the security boundary.
- **Security-status duplicate request removed:** the Admin Security panel now renders its session list from the same API response instead of requesting `/api/admin/security_status` twice.
- **Admin refresh behavior clarified:** the main refresh button now refreshes only sections already opened/loaded, avoiding a full-console request burst. New sections load automatically when viewed.
- **Audit/recheck tooling added:** `regression_v64_5.py` verifies mutation revisions, inactive-session rejection, user-session revocation, backup-list caching and bundled-data invariants without modifying the repository seed database.
- `regression_v64_6.py` verifies the three-state table sort cycle, sortable-header ARIA state, donut-only 3-decimal chart formatting, dashboard card-heading scope/theme treatment, RCA header palette and V64.6 metadata.
- **Version bumped:** `VERSION.txt` and runtime `APP_VERSION` now report `V64.6`.

### Re-audit checkpoints
For the next audit/review, check these exact invariants:
1. `/api/admin/service_health` → `latest_data_date`, `freshness_age_days`, `data_revision`; `latest_activity` must not determine freshness.
2. `/api/admin/home` → `last_data_update` must be the latest disposition inspection date; `last_import_at` is informational only.
3. `app_state` → `disposition_revision` changes only when disposition data is inserted/updated/deleted/restored.
4. `/api/admin/backup/list` → unchanged backup files must not be decompressed/JSON-parsed on every call.
5. Admin login/scroll → deep sections are lazy-loaded; there are no chained `showAdmin()` wrappers creating duplicate timer bursts.
6. Disabled users → existing `qdash_admin`/`qdash_user` sessions no longer authorize access.
7. Backup/user/security GET APIs → non-Super-Admin roles receive HTTP 403.

### Verification performed for V64.6
- `python3 -m py_compile server.py`
- `node --check` on all inline scripts in `admin.html` and `index.html`
- `python3 regression_test.py`
- `python3 regression_v64_3.py`
- `python3 smoke_test.py`
- `python3 http_smoke.py`
- `python3 admin_ux_audit.py`
- `python3 export_acceptance.py`
- `python3 export_stress.py` (PASS; ~30.8s wall, ~545 MB peak RSS on the repository stress fixture)
- `python3 regression_v64_5.py`

The bundled `quality.db` remains unchanged. Its current seed invariants remain 4,936 disposition rows, 0 duplicate batch groups, and no missing/invalid core disposition fields.

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
| `regression_smoke.py`, `http_smoke.py`, `smoke_test.py`, `regression_test.py`, `regression_v64_3.py`, `export_acceptance.py`, `export_stress.py`, `admin_ux_audit.py` | Release-gate tests |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |

## Release gate
Before deploying, run every command in `RELEASE_GATE.md` (all must pass, on an isolated database).

## Troubleshooting
- **Old look / dark mode wrong after a deploy** – hard-refresh once (Ctrl+Shift+R); CSS and JS are cached
  by version.
- **Uptime monitor shows the service down** – point it at `/healthz` (GET or HEAD).
- **Admin says login required after a restore** – expected: restore replaces the user/session tables; log in again.

### V64.6 corrective sorting patch

Sortable dashboard tables use a three-state click cycle: **ascending → descending → normal/natural order**. The normal state is the current server/render order for that table after filters refresh. This behavior is preserved across supported sortable tables, including Work Center, Grade, Monthly, Weekly, Quarterly, and Yearly.

### Latest V64.6 presentation patch
- Drill-downs launched from Presentation Mode stay above the presentation overlay and return cleanly to the dashboard DOM when closed.
- `Esc` closes the drill-down first, preserving Presentation Mode.
- Presentation toolbar titles exclude the fullscreen control glyph.
- Quality Decision Mix uses a decision-oriented `⚖️` icon.
- Version remains **V64.6**; only the JS cache-buster is advanced.

### Current Time
The V64.6 header shows a compact calendar-style Current Time card at the top-right above Commands. It displays the local date and a live seconds clock in 12-hour AM/PM format in both light and dark themes.
