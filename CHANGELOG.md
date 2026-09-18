# Quality Disposition Dashboard — Changelog

Consolidated release/fix history for the current V62 release. Everything lives in
this one file now instead of separate `CHANGELOG_V*.md` files, to keep the repo
from accumulating a changelog file per release.

## V27.1

# V27.1 — Stability & Security Maintenance Release

## Preserved exactly
- Existing `quality.db` data (4,936 disposition records)
- Existing filter keys and filter calculations
- Existing KPI calculations and 16 KPI cards
- Existing five dashboard tabs and their read-only data flows
- Existing QCR rendering and drill-down behavior

## Fixed / hardened
- Removed the hard-coded administrator password from `server.py`.
- Startup no longer deletes/resets the entire `users` table.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` are now environment-backed for new provisioning.
- Existing users, roles and passwords are preserved on startup.
- Fixed README credential documentation to match the V27.1 security model.
- Bumped frontend asset versions to `27.1` to prevent stale browser cache after deployment.
- Added a non-destructive smoke-test suite covering health, filters, 16 KPIs, QCR, core analysis endpoints and data-count integrity.

## Intentionally deferred
- Large backend/frontend module split (deferred to a separate refactor so current data/filter behavior remains untouched).
- Major CSS rewrite/design changes.
- New analytics/AI features.
- Database migration or schema redesign.

---

## V27.2

# V27.2 — Engineering Hardening

## Preserved
- Existing 4,936 disposition records.
- Existing KPI calculations and filter behavior.
- Existing 5-tab navigation and QCR payload logic.
- Existing import/export/admin workflows.

## Added
- Non-destructive HTTP regression suite covering core API endpoints and a real filter request.
- Data fingerprint check before/after regression tests to detect accidental mutation.
- Lightweight code-health gate for syntax, credential-pattern detection and CSS duplicate reporting.
- `X-Request-ID` response header for easier production troubleshooting.
- Security baseline documentation.

## Intentionally not changed
- Database schema/data model.
- KPI formulas.
- Filter/query semantics.
- QCR calculation logic.
- CSS cascade. Duplicate CSS selectors are reported for the next controlled cleanup rather than aggressively rewritten.

---

## V27.3

# V27.3 — RCA (Root Cause Analysis) + 6M Icon/Color Coding

## Added
- **RCA import**: the same "Import 6M Fishbone Master" upload in Admin now also reads two more
  sheets from the workbook, both optional:
  - `RCA_RootCause_Library` — Defect List, 6M Category, WHY-1 → WHY-5/Root Cause, Action,
    Preventive Action, Role, Responsibility (one row per defect × 6M category).
  - `Icon Color Coding` — 6M category → recommended color (icon is carried over from whatever
    emoji prefixes the category cell in the RCA sheet, e.g. "👤Man").
- **RCA panel**: a new "Root Cause Analysis (RCA)" table renders under the 6M Fishbone diagram
  on both the Quality Control Room tab and the Dashboard tab, for whichever of the Top 5 Defects
  is selected. Shows the Why-Why chain, root cause, action, preventive action and role/
  responsibility for every 6M category that has RCA data on file for that defect.
- **Dynamic icon/color coding**: the fishbone diagram (card grid, Ishikawa SVG, and the PNG used
  in Excel/PDF exports) now takes its 6M category colors and icons from the imported
  `fishbone_style` table instead of a fixed palette. Falls back to the original look until an
  admin imports a workbook that carries an Icon Color Coding sheet.
- Excel and PDF exports include a new RCA table alongside the existing 6M cause list for the
  current #1 defect.
- Backups/restore now include the RCA library and style config alongside the existing 6M
  Fishbone Master, aliases, disposition data and KPI targets.

## Preserved
- Existing 6M Fishbone Master import behavior for workbooks that only have `Master_Data` —
  RCA and style sheets are optional; nothing breaks if they're absent.
- Existing fishbone matching (manual alias → exact → fuzzy) is unchanged; RCA is attached to
  whatever the match already resolves to.
- Existing disposition data, KPI calculations, and 5-tab navigation.

## Data model
- New tables: `rca_master` (defect × 6M category → why1..why5, action, preventive_action, role,
  responsibility) and `fishbone_style` (6M category → label, icon, color). Both are created
  automatically on server startup for existing databases (no manual migration needed).

---

## V27.4

# V27.4 — Production Reliability & Performance

## What changed
- Added composite database indexes for the dashboard's most common multi-filter/grouping combinations.
- Applied the composite indexes consistently to SQLite and PostgreSQL paths.
- Added GitHub Actions CI to automatically run compile, code-health, smoke, and regression checks on pushes/PRs to `main`/`master`.
- Preserved the existing dataset, filters, KPI calculations, QCR calculations, UI behavior, and import/export logic.

## Data safety
The bundled `quality.db` remains unchanged at the row/data level. Index creation only changes database access structures.

## Export Optimization Update
- Added dedicated Export Center tab with filtered Excel, PDF and PowerPoint actions.
- Added PowerPoint (16:9) management deck export with KPI scorecard, charts, trends, QCR intelligence and root-cause slides.
- Enhanced Excel export with complete filtered row-level data plus dashboard/QCR analysis.
- Enhanced PDF export with complete trend, work-center, grade and QCR intelligence summary tables.

---

## V40

# V40 Final Clean Update

- Restored admin header to a clean white background with subtle border/shadow.
- Removed page-level horizontal overflow; responsive admin sections now fit the viewport.
- Preserved internal scrolling only for genuinely wide data tables.
- Switched the intro to the light visual only and removed the dark intro asset.
- Kept the existing intro CTA gate/background animation behavior.
- No application data or database records were changed.

---

## CHANGELOG_V46

# V46 — Intro fixes

## 1. Intro no longer goes blank after the video

Root cause was in the media asset, not the page code. The source clip
`quality_nonferrous_intro_light.mp4` was 10.0s long and its last ~1.0s washed the
whole composition out to white and then faded to black. The old script froze the
player on its "last visible frame", but that frame *was* the black one — so the
screen went dark the moment playback finished.

Fixes:

- The clip is re-encoded and trimmed to **8.70s**, dropping the wash-out/fade-to-black
  entirely (audio gets a 0.6s fade-out so the cut isn't abrupt). The final frame is now
  the fully composed end state: logo, QUALITY / TRACEABILITY / CONTINUOUS IMPROVEMENT,
  NON-FERROUS, the tagline, Cupronickel Division, QUALITY INTELLIGENCE, the QCR / RCA /
  DATA cards and the ENTER DASHBOARD button.
- New asset `quality_nonferrous_intro_endcard.png` — a pixel-exact copy of that final
  frame — is layered over the `<video>` and fades in the instant playback stops. Freezing
  no longer depends on the browser retaining a decoded frame, which is what made the
  behaviour inconsistent across browsers. It is also wired up as the `poster`, so there is
  no black flash on load and the composition still shows if autoplay is blocked outright.
- `.intro-stage` now creates its own stacking context (`z-index:1; isolation:isolate`) so
  the ambient glow, the two sweep lines and the drifting particles animate **above** the
  frozen end-card instead of being covered by it. Background motion continues; the video
  plays once and stops.
- Freeze is now driven by `timeupdate` (duration − 0.08s), with `ended`, `pause`, `error`
  and a duration-based timeout as fallbacks, so the end-card appears even if the clip
  stalls. The video never loops or restarts.

## 2. "Cupronickel Division" sat on top of the divider line

This was baked into the video frames, which is why earlier CSS-side attempts had no
effect. The orange rule was running straight through the text like a strike-through.

- The affected band is repaired at the frame level: the region is cleaned, the division
  name is re-rendered at its original size, colour and centre, and the orange rule is
  moved **below** it as a proper underline (y 352–355, x 490–790).
- The repair is composited into the video from 1.53s (matching when the rule originally
  appeared) through to the end, so it is correct during playback as well as on the
  frozen end-card.

## 3. Intro hint legibility

`CLICK ENTER DASHBOARD TO CONTINUE` was near-white. That was readable only because the
intro used to end on black; against the light composition it was invisible. It is now
dark slate, shifting to brand orange with a soft pulse once the video has stopped.

## Files touched

- `quality_nonferrous_intro_light.mp4` (re-encoded, 8.70s)
- `quality_nonferrous_intro_endcard.png` (new)
- `index.html` (intro styles, end-card markup, freeze logic)
- `server.py` (end-card added to the static asset allow-list)

---

# V46.1 — Deploy fix: port scan timeout

The build succeeded but the deploy was cancelled with
`Port scan timeout reached, no open ports detected`. The process was alive the whole
time — it just never got as far as binding a socket.

`main()` ran `_ensure_admin_schema()`, `_seed_postgres_if_empty()` and
`ensure_fast_indexes()` **before** constructing the server. Against an external Postgres
on a cold database that is not quick work: the seed inserts every historical row and
`CREATE INDEX` on a populated table takes real time. The host gave up waiting for a
listening port and cancelled the deploy long before any of it finished.

Changes:

- `main()` now binds and starts serving first. All schema/seed/index work moved into
  `_run_startup_tasks()`, which runs on a background thread. The port opens in about a
  second regardless of how slow the database is. Verified locally: healthy response at
  +2s on SQLite, and with a deliberately unreachable `DATABASE_URL` the port still opens
  immediately and the failure is logged instead of blocking the boot.
- Each startup task is individually wrapped, timed and logged, so a failure in one no
  longer stops the other two and the log shows exactly which step is slow.
- New `/healthz` (and `/readyz`) endpoint — first route checked, touches no database, no
  auth, no disk. Returns `{ok, ready, startup_error, backend}`. Wired up as Render's
  `healthCheckPath`.
- Startup logging is line-buffered and `PYTHONUNBUFFERED=1` is set in `render.yaml`.
  Previously stdout was buffered, which is why the failed deploy log showed no output
  from the app at all and a slow boot looked identical to a silent one.
- `render.yaml` gains an explicit `buildCommand`.

Note: the build log shows cp314 wheels, so the host is using Python 3.14 and ignoring
`runtime.txt` (which asks for 3.11.9). Everything installed and parses fine on 3.14, so
this is informational — but if you want the pinned version, set it in the service's
environment settings rather than `runtime.txt`.

---

## P0_FIXES

# P0 Fixes — Data-Preserving Release

This release closes the identified P0 reliability/data-safety issues without modifying any live database or bundled data.

## Fixed
- PostgreSQL uses a thread-safe `ThreadedConnectionPool` with locked lazy initialization.
- `/readyz` is now the deployment readiness gate; startup stays unready if schema/seed/index initialization fails. `/healthz` remains a process-liveness endpoint.
- Render health check points to `/readyz`.
- Imported period fields are checked against `INSP LOT DATE`; existing rows are not rewritten.
- Non-finite output weights (`NaN`, `Infinity`, `-Infinity`) are rejected.
- Backup restore is atomic and fail-closed: any restore component failure rolls back the complete restore instead of reporting success with partial data.
- KPI target restore is true snapshot replacement for that table (targets absent from the backup are removed inside the same transaction; failure rolls everything back).

## Data-safety note
No production database, user data, or existing backup was opened, rewritten, migrated, or deleted while producing this release. Validation was performed only against isolated temporary test databases/mocks.

---

## P0_REPAIR_V55

# P0 Repair — Backup Regression Fix

Release repair applied to the V54 P2 hardened build.

## Fixed
- Repaired the backup snapshot envelope mismatch that caused backup creation to fail with `KeyError: counts`.
- Backup snapshots now consistently include `backup_version`, `created_at`, `reason`, `database_backend`, `counts`, and all restore-required data sections.
- Timestamp/date values are converted to JSON-safe ISO strings during snapshot serialization.
- Backup list validation and restore compatibility were re-tested.

## Validation
- `server.py` Python syntax: PASS
- `reports.py` Python syntax: PASS
- `app.js` Node syntax: PASS
- Empty-schema SQLite backup creation: PASS
- Populated SQLite backup + restore smoke test: PASS
- No production PostgreSQL connection or live data was touched.

---

## P1_FIXES

# P1 Bug-Fix Release

This release is built on the P0-fixed package and keeps existing production data untouched.

## Data/KPI correctness
- Canonical validation now treats `INSP LOT DATE` as the source of truth for Month/Week/Quarter/Financial Year.
- Defect Intensity `NONE` is normalized for new records; filters treat blank and legacy literal `NONE` consistently.
- Trend period discovery respects active filters, preventing no-data periods from becoming false 0% observations.
- Quarter period-over-period comparison is disabled when FY is `All`, avoiding ambiguous cross-year comparisons.
- Historical KPI targets are resolved by effective date rather than always using the current target; report exports use the same historical targets.
- QCR forecast risk uses the configurable KPI target/warning/direction settings.
- Data-integrity checks now detect finite/non-positive weights, missing batch numbers, and legacy `NONE` intensity consistently.
- A normalized unique index protects non-empty BATCH NO values where no legacy duplicates exist; legacy duplicates are never deleted automatically.

## Backup/recovery
- Backup snapshots include KPI target history and import history.
- DB-native date/time values are serialized safely as ISO strings in backups.
- Restore remains atomic and fail-closed.
- Restore includes imported history sections and true snapshot replacement for KPI targets.
- Mutating admin workflows require a pre-change safety backup before writing live data.

## Security/export safety
- Main dashboard/QCR database-derived HTML/SVG values are escaped before insertion.
- CSV exports escape spreadsheet formula prefixes for text values.
- XLSX report text values are protected from formula injection.
- Viewer login uses the shared login-failure rate limiter.
- Client IP forwarding headers are only trusted when `TRUST_PROXY_HEADERS` is enabled.

## Audit/workflow consistency
- Single-record add, direct import, delete, KPI-target changes, Fishbone import, and Fishbone-alias changes now write activity/audit signals consistently and invalidate response caches where required.
- Direct import now records an `import_history` row.
- Delete returns `404` when the target record does not exist instead of reporting a successful zero-row deletion.

## Validation performed
- Python syntax check: PASS
- JavaScript syntax check: PASS
- Isolated P1 regression suite: PASS
- Atomic restore rollback test: PASS
- Normalized BATCH NO uniqueness test: PASS
- Backup JSON serialization test: PASS
- Spreadsheet formula-safety helper test: PASS
- Fresh local startup `/healthz`: PASS
- Fresh local startup `/readyz`: PASS

No production database or user data was modified while building or validating this release.

---

## P1_FIXES_V53

# V53.0 — P1 fixes

- Fixed PostgreSQL invalid-weight integrity SQL.
- Repaired Excel workbook save/return path and rejected empty workbooks.
- Hardened export filenames against CR/LF/header injection.
- Added spreadsheet-formula neutralization helper for CSV export paths.
- Hardened admin inline JavaScript arguments with JS-string escaping.
- HTML-escaped administrative inspection dates.
- Hardened fishbone inline handler arguments.
- Destructive fishbone/disposition imports now fail closed if the safety backup fails.
- Direct disposition imports now create import-history entries after successful mutation.
- Corrected malformed fishbone SVG label markup.
- No production database was accessed or modified.

---

## P1_FIXES_V56

# P1 Fixes — V56.0

## Fixed
1. Admin CSV export now uses the same spreadsheet-formula safety function as public CSV exports.
2. Activity-log retention is now actually invoked, with a five-minute cleanup interval and a 10,000-row bound.
3. The activity rate limiter was moved off the global POST path and is now scoped to `/api/activity/event` and `/api/activity/heartbeat`. Admin imports, KPI updates, backups and password actions are no longer accidentally throttled by activity traffic.
4. Disposition imports are serialized with a process lock; PostgreSQL also uses a transaction-scoped advisory lock and SQLite uses `BEGIN IMMEDIATE`, preventing concurrent imports from racing on new BATCH NO values.
5. Existing legacy duplicate BATCH NO groups are preserved; V56 does not delete or merge them.
6. `supabase_schema.sql` now reflects runtime columns/tables including `batch_no`, `ud_date`, `must_reset_password`, activity IP/visitor fields, audit trail, KPI history and Fishbone/RCA/style tables.
7. Release identity is unified at V56.0 (`APP_VERSION`, `VERSION.txt`, frontend asset query strings).
8. README now documents Render + external PostgreSQL as the canonical production path and removes stale `build_db.py` / bundled `quality.db` deployment instructions.

## Data-safety statement
No live/production PostgreSQL connection is used during build or tests. No existing application rows are deleted as part of these P1 fixes.

---

## P2_FIXES

# P2 Hardening — V52.0

Data-preserving maintenance release.

- Unified application release version to V52.0.
- Added thread-safe response/session/login state handling and bounded in-memory maps.
- Added cache invalidation on all known state-changing dashboard/admin paths.
- Made local backup writes atomic (temp file + fsync + os.replace).
- Added backup manifest metadata and backup-file integrity visibility.
- Added app-version response headers.
- Aligned static asset cache-busting with the release version.
- Bounded import preview memory and expired previews proactively.
- No production database was modified by this release build.

---

## P2_FIXES_V54

# V54.0 — P2 hardening

- Consistent backup snapshot helper using a single read transaction.
- Backup filename collision hardening.
- Activity-log retention cap and public activity endpoint rate limiting.
- Persistent server-error event recording for the admin error monitor.
- Render deployment now fails closed if DATABASE_URL is absent instead of silently using SQLite.
- Restore paths clear response cache.
- Added normalized BATCH NO lookup index for import performance.
- Fishbone full refresh clears obsolete style rows.
- Existing production data is preserved; no live database was accessed.

---

## P2_FIXES_V57

# V57.0 — P2 hardening

- Bounded the in-process response cache by both entry count and serialized payload bytes.
- Added an embedded SHA-256 integrity checksum to every new backup; V57 verifies it during listing, explicit verification, and restore. Pre-V57 backups remain structurally restoreable without a checksum.
- Serialized backup writers and retained atomic temp-file + fsync + replace behavior.
- Tightened activity-rate map cleanup to remove the oldest keys first.
- Added a large configurable audit-trail retention ceiling (`AUDIT_RETENTION_MAX`, default 100,000) so long-lived deployments do not grow audit storage without bound.
- Reject unsupported HTTP `Transfer-Encoding` bodies before body parsing; the app expects a bounded `Content-Length`.
- Kept existing P0 backup/restore rollback and P1 import-concurrency protections intact.
- Release/versioned static asset identity moved to V57.0.

These changes are data-preserving and were tested only against isolated local copies.

---

## V58_STABILITY

# V58 Stability Baseline

V58 does not introduce a new business-data model. It establishes a stable release baseline around the V57 P0/P1/P2 repairs and packages the regression checks used to prevent those fixes from regressing again.

Validated in isolated test databases:

- disposition insert/update/idempotency and concurrent import serialization
- KPI and analysis calculation smoke tests
- response-cache entry/byte ceilings
- activity-log retention ceiling
- backup creation, checksum verification, tamper detection, and restore
- input validation and CSV formula-injection protection
- health/readiness and 45 registered HTTP/admin read routes
- release/version consistency and shipped-artifact hygiene

The tests are intentionally isolated from production PostgreSQL.

---

## V59_FINAL

# V59.0 Final Stability Hardening

- Fixed admin inline JavaScript argument handling for usernames and defect names.
- Fixed quality-drill record button handler generation.
- Added HTML-attribute-safe JavaScript escaping helper.
- Preserved V58 P0/P1/P2 data-safety, backup, import-concurrency, and release-gate behavior.

---

## V60_FINAL_STABILITY_HARDENED

# V60.0 Final Stability Hardened

V60 is the post-V59 deep-audit release. It keeps the V59 regression and HTTP release gates and closes the remaining production-safety findings.

## Deep-audit fixes

- Render `ADMIN_USERNAME` / `ADMIN_PASSWORD` are provisioning-only. Once a matching database user exists, authentication uses the stored database password only.
- Import confirmation now takes a pre-change safety backup, matching direct import behavior.
- Record deletion now takes a pre-change safety backup.
- Fishbone alias create/update/delete now take pre-change safety backups.
- Backups now snapshot the full persistent application state: users, activity log, audit trail, fishbone import history, and existing quality/configuration tables.
- Backup validation checks section types/counts and validates the V4 full-state scope.
- Session dictionary reads/writes used by authentication/admin flows are synchronized with `SESSION_LOCK`.
- Proxy forwarding headers are untrusted by default; Render explicitly enables trusted proxy headers through `TRUST_PROXY_HEADERS=true`.
- Report filenames strip control characters, quotes, separators, and unsafe characters before entering `Content-Disposition`.

## Verification

- Deep regression suite: PASS
- 45-route HTTP smoke suite: PASS
- Admin inline JavaScript syntax checks: PASS
- App JS syntax check: PASS
- Python AST checks: PASS
- Backup integrity, tamper detection, full-state restore: PASS
- Concurrent import: PASS
- Environment-password authentication transition: PASS
- Report filename header-safety test: PASS

Production PostgreSQL was not modified during this audit.

---

## V61_EXPORT_HARDENING

# V61.0 Export Hardening

## Fixed export failure

Excel, PDF and PowerPoint reports previously rendered charts for every Work Center and Grade returned by the database. On high-cardinality data this could exhaust rendering resources and surface the generic “unexpectedly deep processing limit” error, while Raw Data CSV continued to work.

V61 bounds only rendered report elements: chart category count, trend points, PDF/PPTX tables, Excel presentation tables, and 6M/RCA presentation rows. The underlying database rows and Raw Data CSV export remain complete.

Heavy report exports default to one-at-a-time on small hosts. The global Python recursion limit is no longer raised to mask report-generation problems.

## Verification

- Excel export stress: 8,000 Work Centers + 8,000 Grades — PASS
- PDF export stress: 8,000 Work Centers + 8,000 Grades — PASS
- PowerPoint export stress: 8,000 Work Centers + 8,000 Grades — PASS
- Existing regression suite — PASS
- HTTP smoke suite — PASS

---

## V62_EXPORT_COMPLETE

# V62 Export Completeness

- Excel: complete underlying tables; visual charts remain bounded for readability/performance.
- PDF: complete tables paginate; matching chart appears with the start of each section.
- PowerPoint: complete tables paginate, and the matching chart(s) are repeated on every continuation slide, so every table chunk stays paired with its chart.
- No source rows are silently dropped from report tables.
- Raw CSV remains complete and unchanged.

---

## V62.1

# V62.1 — Header / Filter Toolbar Reorganization

## What changed
- **Reset All** moved out of the header and into the Dashboard Filters panel
  (`#filters`), next to the "Dashboard Filters" title and the active-filter
  count badge — it's a filter action, so it now lives with the filters.
- **Export buttons** (Quality Report • Excel / PDF / PPT, Raw Data • CSV) stay
  in the header, now right-aligned in the header toolbar row instead of being
  mixed in with the title/badge/reset button.

## Files touched
- `app.js` — `loadFilters()` now renders export buttons into
  `#headerFilterToolbar` and the title/badge/Reset All into `#filters`,
  instead of putting everything into the header. Element IDs and event
  listeners are unchanged.
- `app.css` — `.header-toolbar-row .filter-toolbar` switched from
  `justify-content:space-between` to `flex-end` (only the export actions live
  there now, so they should sit on the right).

## Preserved
- All export/reset functionality and behavior — only the markup location and
  alignment changed, not the IDs, handlers, or filter/export logic.

---
