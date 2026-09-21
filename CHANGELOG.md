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

## V62.2

# V62.2 — Export RecursionError Fix + Header Branding Scale-Up

## Root cause of the recurring export failure
Every "This report hit an unexpectedly deep processing limit…" export failure
traced back to `_chart_png()`'s Pareto chart (the dual-axis defect chart used
in Excel/PDF/PPT exports). It combines `ax.twinx()` (for the Qty / Cumulative %
dual axis) with `fig.savefig(..., bbox_inches="tight")`. On matplotlib 3.8.x,
that combination can recurse deep enough — the recursion depth scales with the
number of distinct defect labels on the chart — to blow past Python's stack
limit with a genuine `RecursionError`, which is why a narrower filter (fewer
defect labels) "worked around" it and a broad/unfiltered report didn't.

## Fixed
- `reports.py` — dropped `bbox_inches="tight"` from both chart PNG savefig()
  calls (`_chart_png()` and `_fishbone_png()`). `fig.tight_layout()` already
  lays the figure out correctly; re-tightening at savefig() time was the
  actual recursion trigger, not merely something that needed a higher
  recursion limit or a smaller payload.
- `requirements.txt` — bumped `matplotlib` from `~=3.8.0` to `~=3.10.0` (a
  deliberate minor-version bump, not just a patch bump) as defense-in-depth.
  Stress-tested the exact Pareto-chart code path at up to 3,000 chart labels
  and 400 repeated chart renders in one process on 3.10.x with no recursion
  or slowdown.
- Existing recursion-safety scaffolding in `server.py` (raised recursion
  limit, larger thread stack, one-time capped-payload retry, and the
  diagnostic error response) is left in place as a general safety net for any
  other unrelated deep-recursion edge case — it's just no longer needed for
  this particular failure.

## Header branding scale-up
- `app.css` — the earlier header-height reduction shrank the logo and title
  text along with the header's own padding, which left the branding looking
  small/lost inside the header. Scaled the logo (58px, 42px on mobile) and
  every title/subtitle line back up together so the branding fills the
  header's footprint again, without the header itself growing tall.

## Preserved
- All export formats, filters, KPI/QCR calculations and chart appearance are
  otherwise unchanged — only the two `savefig()` calls and the matplotlib
  version changed on the backend; only sizing changed in the header.

---

## V62.3

# V62.3 — Dashboard Fishbone Cause Text Size

## What changed
- `app.js` — `buildFishboneSvg()` (the true Ishikawa diagram on the Dashboard
  tab): cause-label font size raised from 12.5px to 14px (fallback minimum
  8.5px → 9.5px to match), and the vertical spacing between causes along
  each of the 6 bones (`ROW_GAP`) increased from 48 to 56 so the now-larger,
  still auto-wrapping text has enough room and doesn't overlap a neighboring
  cause. The diagram's existing auto-wrap/auto-shrink logic (`fbFitBox`) is
  untouched — a long cause still wraps onto up to 3 lines, and only shrinks
  toward the (now slightly higher) minimum font size on the rare cause that
  still won't fit, so nothing gets visually cut off.

## Preserved
- QCR tab's card-grid fishbone layout (a separate function) is unchanged —
  this was a Dashboard-tab-only request.
- Cause data, matching logic, RCA table, and every other diagram element
  (spine, head box, branch color/icon boxes) are unchanged.

---

## V62.4

# V62.4 — Site-Wide Sound Effects

## What changed
- Added `sfx.js`: a small, self-contained sound-effect engine. Every sound is
  synthesized on the fly with the Web Audio API (short tones through a
  gentle low-pass filter) — there are no audio files to host or download,
  so it loads instantly and works offline.
- One delegated click/change listener (in `sfx.js` itself) covers the whole
  app instead of wiring every button by hand, since both the dashboard and
  admin panel build most of their buttons dynamically. Different UI
  conditions get audibly different sounds:
  - `click` — a generic secondary button/link
  - `confirm` — a primary/submit button (Save, Login, the export buttons)
  - `select` — picking a filter option, a fishbone-defect chip, a native
    `<select>` value, or a checkbox/radio
  - `open` / `close` — opening a filter dropdown or a file picker
  - `tab` — switching dashboard tabs or admin sidebar sections
  - `toggle` — the dark-mode and sound-mute buttons
  - `success` — an admin action's `setMsg(..., 'ok')` result
  - `error` — an admin action's `setMsg(..., 'err')` result
  - `warning` — Reset All, Delete, Logout and other destructive actions
  - `notify` — the app's existing `alert()` calls (wrapped, not rewritten)
- Added a small 🔊/🔈 mute button next to the existing dark-mode toggle in
  both `index.html` and `admin.html`. The on/off preference is remembered in
  `localStorage`, independent of the dark-mode preference.
- `server.py` — added `/sfx.js` to the same versioned-static-asset route
  `/app.js` already uses (this server has no generic static-file handler;
  every servable path is explicit), so the new file is actually reachable.
- `admin.html` — its shared `setMsg(id, text, kind)` helper (used by every
  admin panel for its inline success/error messages) now also plays the
  matching sound, so real success/failure outcomes are covered, not just
  the click that triggered them.

## Preserved
- No existing click handler, export, filter, or admin workflow logic was
  touched — the listener only *observes* clicks/changes to play a sound; it
  never calls `preventDefault()` or otherwise intercepts the interaction.
- Sound is on by default but fully mutable per browser/device; muting is
  remembered across visits.

---

## V62.5

# V62.5 — Dark Mode: Charts, 6M Fishbone, and Admin Panels

## Root causes found
- **Charts (Dashboard/QCR/all analysis tabs) stayed on a white card in dark
  mode.** Every chart-building function in `app.js` draws its own inline SVG
  (pie, bar, horizontal bar, grouped bar, line, combo/Pareto) with axis text,
  gridlines and baselines as hardcoded hex colors tuned for a white
  background. A previous pass deliberately left the chart card forced white
  in dark mode as a workaround, since re-theming the card alone would have
  made that baked-in dark navy text invisible.
- **QCR tab's 6M Fishbone was "pura white" in dark mode.** Its container
  (`#qcrFishboneDiagram`) was being force-set to `background:#fff !important`
  by that same old workaround, and several of its own elements (cause list
  text, "no cause on file" text, the spine caption, the note banner's text/
  border) had no dark-mode color at all.
- **Some Admin tabs stayed white in dark mode.** Admin has two separate CSS
  variable families: `--card`/`--text`/`--border` (redefined for dark mode
  already) and a second one — `--admin-surface`, `--admin-surface-2`,
  `--admin-heading`, `--admin-line`, `--admin-accent` — used by the Command
  Center, Recovery Center, activity timeline, health-score/notification
  cards, and the KPI import-diff preview. That second family was **never
  redefined for dark mode**, so every panel built from it stayed on its
  light default regardless of theme, while panels using the first family
  correctly went dark — hence only *some* tabs looking broken.

## Fixed
- `app.css` — added a `--chart-*` variable set (axis text, gridlines,
  baseline, marker halo) and an `--fb-*` set (Ishikawa spine/head/cause
  text) to `:root`, with dark-mode-legible values redefined under
  `html[data-theme="dark"]`. Light-mode values are identical to the old
  hardcoded hex, so light mode is pixel-for-pixel unchanged.
- `app.js` — every chart function (`makePieChart`, `makeBarChart`,
  `makeHBarChart`, `makeHGroupedBarChart`, `makeGroupedBarChart`,
  `makeLineChart`, `makeComboChart`, the axis-title helpers) and
  `buildFishboneSvg` (the Dashboard tab's true Ishikawa diagram) now read
  those variables instead of hardcoded hex for every "chrome" element —
  never the data bar/slice/line colors, which already read fine on both
  themes.
- `app.css` — removed the forced-white override on `.chart-scroll`,
  `#dashFishboneDiagram` and `#qcrFishboneDiagram`; they now go properly
  dark like every other card. Added the missing dark colors for
  `.qcr-fb-ul li`, `.qcr-fb-empty`, `.qcr-fb-spine` (+ its border and pill),
  `.qcr-fb-note`, `.qcr-fishbone-chip`, `.qcr-rca-chain` and `.legend`.
- `admin.html` — redefined `--admin-surface`, `--admin-surface-2`,
  `--admin-heading`, `--admin-line`, `--admin-accent` inside the existing
  dark-mode block, fixing the Command Center, Recovery Center, activity
  timeline, health-score/notification cards and import-diff preview in one
  change. Also added explicit dark colors for the handful of elements that
  don't use either variable family at all: `.admin-sidebar`, `.sidebar-link`
  (default/hover/active), `kbd`, `.shortcut-key`, `.activity-icon`,
  `.notify-count`, `.v29-alert.warn`/`.bad` borders, and `.diff-changes
  span`. The Command Center health ring's progress-track color is set via
  inline JS (can't be reached by CSS), so it now picks a dark-safe track
  color when `data-theme="dark"` is active.

## Preserved
- Light mode is visually unchanged everywhere — every new dark value is
  additive, gated behind `html[data-theme="dark"]`.
- No chart data, KPI/QCR calculation, or admin workflow logic was touched;
  only which color each existing SVG/HTML element draws with in dark mode.

---

## V62.6

# V62.6 — Light Mode Is Always the Default

## What changed
- `index.html` and `admin.html` — the pre-paint theme bootstrap no longer
  falls back to the OS's `prefers-color-scheme: dark` when there's no saved
  preference. A first-time visitor now always lands on light mode, even on
  a device set to dark mode at the OS level. Dark mode only activates once
  someone explicitly clicks the 🌙 toggle — from then on their choice is
  remembered in `localStorage` (`qdash_theme`) exactly as before.

## Preserved
- The toggle button, its icon/label sync, and the saved-preference
  persistence are all unchanged — this only removes the *system* fallback
  used when nothing has been saved yet.

---

## V62.7

# V62.7 — Intro Screen: Text/Sound Sync Fix

## Root cause
The intro's text reveal and its procedurally-generated sound cues were
driven by two different clocks that could drift apart:
- **Visuals** (`show()`, revealing each letter/line/card) run off plain
  `setTimeout` delays — not perfectly precise; the browser can be a little
  busy right at page load (fonts, other scripts still loading).
- **Audio** was scheduled all at once, up front, as one absolute Web Audio
  timeline (`audioBase + when/1000` for every cue) computed before any of
  the `setTimeout`s had even started firing.

Two separate problems came from this:
1. If a `setTimeout` fired a few ms late (page busy), that visual reveal
   drifted out of step with its already-fixed audio cue.
2. More significantly: a fresh page load has had **no user gesture yet**,
   so the browser's autoplay policy starts the `AudioContext` in a
   `"suspended"` state. `AudioContext.currentTime` does not advance while
   suspended, so every cue scheduled during that window landed at
   essentially the same frozen instant — and only actually played once the
   context resumed (typically when the person finally clicks something,
   often the "Enter Dashboard" button at the very end). By then the text
   had long since finished appearing, and the sound would land late.

## Fixed (`index.html`, intro script)
- Every tone/whoosh/chime is now scheduled with a freshly-read `now()`
  (`ctx.currentTime`, read at the exact moment its `setTimeout` callback
  actually runs) instead of a precomputed future point on a single timeline
  set up in advance. A delayed visual and its sound are now the same
  event, so they can no longer drift apart from each other.
- `tone()` and `whoosh()` now check `ctx.state === 'running'` before
  scheduling anything. If the context is still suspended (no gesture yet),
  that one cue is silently skipped instead of sitting queued to fire late —
  so a not-yet-interacted-with intro plays its visuals with no delayed/
  out-of-sync sound catching up afterwards, rather than a mistimed one.

## Preserved
- The intro's visual timing, letter-by-letter reveal, and overall pacing are
  completely unchanged — only how (and whether) each accompanying sound
  cue gets scheduled.

---

## V62.8

# V62.8 — Intro "QUALITY INTELLIGENCE" Now Matches the Header Font

## What changed
- `index.html` — the intro screen's "QUALITY INTELLIGENCE" headline used a
  bold sans-serif font (`'Sora'`), different from the header's own
  "QUALITY INTELLIGENCE" title, which is set in the script font `'Allura'`
  (see `.quality-intelligence-title` in `app.css`). Switched the intro's
  headline to the same `'Allura'` cursive font, sized up (script fonts read
  smaller at the same point size than a bold sans) and given the header's
  same soft two-tone text-shadow (a thin dark offset plus a light highlight)
  instead of the old harder drop-shadow, so it reads as the same brand
  wordmark in both places. `Allura` was already being loaded (it's in the
  page's Google Fonts link, used by the header), so nothing new to load.
- Colors were already identical between the two (red "QUALITY" / blue
  "INTELLIGENCE") — only the font, size, weight and shadow style changed.

## Preserved
- The letter-by-letter reveal animation and its timing/sound cues are
  untouched — each letter is still its own `<span>`, just rendered in the
  new font.

---

## V62.9

# V62.9 — The Real Reason Dark Mode Looked Broken: Stale Cached CSS/JS

## Root cause
`/app.css` and `/app.js` are served with `Cache-Control: public,
max-age=31536000, immutable` — a full year, never revalidated — which is
exactly what makes the dashboard load instantly on repeat visits. The
cache-busting for that is the `?v=61.0` query string linked from
`index.html`. Every dark-mode fix since V62.5 (charts, the QCR 6M
fishbone/RCA table, admin panels) was made correctly in `app.css`/`app.js`
on disk — but **`?v=61.0` was never bumped**, so any browser that had
already loaded this dashboard before kept using its year-old cached copy of
`app.css`/`app.js` forever, completely unaware the file on the server had
changed. That's exactly why it looked "kahin dark, kahin white" — the HTML
itself is never cached (`Cache-Control: no-store`) so it always reflected
the latest markup, but the CSS/JS actually painting the colors was stuck on
a much older version underneath it.

## Fixed
- `index.html` — bumped `/app.css` and `/app.js` to `?v=63.0`, forcing every
  browser to fetch the current files at least this once.
- `server.py` — added `_asset_version()`/`_inject_asset_versions()`: when
  serving `index.html` or `admin.html`, the server now rewrites every
  `/app.css`, `/app.js` and `/sfx.js` reference to carry that file's actual
  on-disk last-modified time as its `?v=`, regardless of whatever version
  string is hardcoded in the HTML source. This is the permanent fix —
  correctness no longer depends on remembering to bump a number by hand
  every time one of these three files changes; it's now automatic on every
  deploy.

## Preserved
- The one-year immutable caching itself (what makes repeat visits fast) is
  unchanged — only how the cache gets busted when the file actually changes.

---

## V63.0

# V63.0 — UI Improvements: Breadcrumbs, Compare-to-Previous, Toasts, Export Spinner, Contrast Fixes

## Drill-down breadcrumb ("You are here")
- `index.html`/`app.js` — the drill-down modal (defect → records → Heat
  detail) now keeps a real stack (`drillStack`) instead of one flat state
  that got overwritten every time you went one level deeper. A breadcrumb
  bar appears once there are 2+ levels (e.g. "Defect: Casting Mark ›
  Heat H12345"), each earlier crumb is clickable to jump straight back to
  it, and it stays hidden entirely at a single level so it never clutters
  the common case. `openDrilldown()` still starts a fresh trail (for a new
  chart click); the new `pushDrilldown()` is used for the "go one level
  deeper" case (the Heat No. link inside the records table).

## Chart "compare to previous period"
- `app.js`/`index.html` — added a "Compare to previous period" checkbox
  above the Monthly Quality Trend chart. When on, each of the three metric
  lines gets a second, dashed/lighter line built from the same data already
  on hand (each point shifted back one month), so the gap between the solid
  and dashed line at any given month reads directly as "how much did this
  move since last month" — no extra API call needed. `makeLineChart()` now
  supports a per-series `dashed:true` flag (dash pattern, lighter opacity,
  no dot/value clutter) for this and any future overlay series.

## Friendly empty states
- `app.js`/`app.css` — every chart's "No data to display" and the
  drill-down's "no records" state now render through one shared
  `emptyStateMarkup()` helper: a soft dashed-circle icon plus a title and a
  short, actionable sub-line ("Try widening the date range or clearing a
  filter") instead of a single bare sentence.

## Export button progress + toast notifications
- `app.js` — the four export buttons (Excel/PDF/PPT/CSV) now use
  `fetch()` + a blob download instead of a bare `location.href` redirect.
  This does two things at once: the button shows a spinner and "Generating…"
  the whole time the file is being built, and — because the request now has
  a real success/failure result — a toast notification confirms it
  ("Export ready — filename.xlsx has finished downloading") or explains
  what went wrong, instead of a silent click with no feedback either way.
- Added a small, reusable `showToast(kind, title, message)` (`app.js`) and
  its styling (`app.css`): a top-right stack of auto-dismissing cards for
  success/error/info, independent of sfx.js's sound cues — so someone with
  sound muted still gets a clear visual confirmation.

## Admin: relative "X min ago" timestamps
- `admin.html` — the Dashboard Activity timeline and the per-IP "Last Seen"
  column showed a frozen, literal date/time string. Added `timeAgo()` plus
  a `data-ts`-driven `setInterval` (every 30s) that keeps every timestamp
  reading "just now" → "2 min ago" → "1 hr ago" → "3d ago" as time passes,
  with no page reload and no extra API calls — it's purely re-formatting a
  timestamp the page already has.
- (Checked, already in place: sidebar links and Command Center cards both
  already call `scrollIntoView({behavior:'smooth',block:'start'})` on
  switch — no change needed there.)

## Accessibility: WCAG AA contrast pass
- Ran every dark-mode text/background color pair introduced across the
  recent dark-mode work through the WCAG contrast formula — all pass AA
  (4.5:1) for normal text, several comfortably (7:1+).
- Found and fixed a **pre-existing, theme-independent** gap: `--muted`
  (`app.css`, light mode) was `#6b7c93` on white — 4.26:1, just under the
  4.5:1 AA minimum for normal text — used everywhere from chart axis labels
  to the new toast/empty-state sub-text. Darkened it to `#5b6c82` (5.37:1).
  Found and fixed the same issue in `admin.html`'s separate `--muted`
  (`#718096` → `#5c6b7d`, 4.02:1 → 5.45:1). Both are CSS variables, so this
  one change corrects contrast everywhere they're used, in both files.

## Preserved
- All existing chart/table/export/admin data and calculations are
  untouched — this batch is presentation and feedback only.

---

## V63.1

# V63.1 — Desktop Power-User Features, Batch 1: URL State, Keyboard Shortcuts, Table Sort

## URL reflects tab + filters
- `app.js` — the active tab and every non-"All" filter now show up in the
  address bar (e.g. `?tab=wcgrade&work_center=WC-12`). Filter changes use
  `history.replaceState` (no extra back-button stop per click); switching
  tabs uses `history.pushState` (each tab is its own back/forward stop).
  A `popstate` listener restores whichever tab+filters that history entry
  represents, and `init()` now reads the URL on first load — so a
  bookmarked or pasted link opens straight into that exact view instead of
  always starting blank. "Save current view" now goes through the same
  `syncFilterUiFromState()` used for this, instead of its own copy of that
  DOM-sync logic.

## Keyboard shortcuts
- `app.js`/`index.html` — `/` focuses the global search box, `1`–`5` switch
  tabs, `Ctrl+E` (`Cmd+E` on Mac) triggers the Excel export, and `?` shows a
  toast listing them. All are disabled while typing in any input/textarea/
  select/contenteditable, so normal typing is never hijacked. A small `/`
  key-cap hint sits inside the search box (hidden on narrow/mobile widths —
  these are desktop-only shortcuts).

## Click-to-sort tables
- `app.js`/`app.css` — every data table (Decision, Defect, Work Center,
  Grade, Monthly/Weekly/Quarterly/Yearly Trend, Defect Register, Defect
  Intensity — 10 in total) now sorts by clicking a column header, with an
  ↑/↓ arrow indicator and keyboard support (Enter/Space on a focused
  header). The Grand Total row always stays pinned at the bottom regardless
  of sort. The chosen sort is remembered per table and re-applied
  automatically after a filter change refreshes that table's rows, instead
  of silently reverting to server order.

## Preserved
- No calculation, filter, or export logic changed — this batch only adds
  navigation/interaction affordances on top of existing data flows.

---

## V63.2

# V63.2 — Desktop Power-User Features, Batch 2

## Wide/ultra-wide layout
- `app.css` — above ~1700px width the container/header widen and the KPI
  grid adds a 5th column; above ~2100px a 6th. Below that, layout is
  unchanged (the existing 1480px cap already used normal desktop widths
  well) — this only kicks in once there's real spare width to use.

## Resizable/draggable drill-down modal
- `index.html`/`app.js`/`app.css` — the drill-down dialog can now be
  dragged by its header (like a real window) and resized from a
  bottom-right handle, with sensible min-width/min-height. Resets back to
  its default centered size the next time it's opened.

## Print support (Ctrl+P)
- `app.css` — a `@media print` stylesheet hides the header, tabs, filters,
  search box, toasts, buttons and toggles, forces light colors even in
  dark mode, and adds page-break hints so a chart/table/card isn't sliced
  across two pages — for handing someone a report straight from the
  browser's own print/Save-as-PDF.

## Admin: drag-and-drop file upload
- `admin.html` — the monthly-data and 6M-fishbone-master upload boxes now
  accept a file dragged straight from File Explorer/Finder, in addition to
  the existing click-to-browse. Drops fill the same `<input type="file">`,
  so every existing validation/preview flow needs no changes at all.

## Admin: bulk delete + Shift+click range-select
- `server.py` — added `/api/admin/bulk_delete`: one safety backup and one
  transaction for the whole batch, instead of what a naive loop over the
  single-record delete endpoint would do (one full database backup file
  per record — slow and wasteful for a multi-select).
- `admin.html` — added a "🗑 Delete Selected" button next to the existing
  "Export Selected" (which was already there), plus Shift+click a row
  checkbox to select every row between it and the last one clicked.

## Side-by-side compare mode
- `index.html`/`app.js`/`app.css` — a new "⊞ Compare Periods" button opens
  a small picker (a filter dimension — Month by default — plus a value for
  each side), then shows two independent, fully live copies of the
  dashboard side-by-side in iframes, one per value, everything else (tab,
  other filters) held the same on both. This reuses the URL-state feature
  from the previous batch (`?tab=...&month=...`) rather than duplicating
  any rendering logic — each side is the real interactive dashboard, not a
  simplified summary. Desktop-only (hidden below ~1100px — there's no
  useful way to show two dashboards side-by-side on a narrow screen).

## Preserved
- All six of the above are additive UI/interaction features; no existing
  calculation, filter, export, or admin data-mutation logic changed.

---

## V63.3

# V63.3 — Bug Fixes: Compare Periods, Chart Compare Labels, Bulk-Delete Feedback

## Compare Periods wasn't working — root cause
`server.py` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` on
every response — a real, intentional clickjacking protection. The Compare
Periods feature (added last batch) shows two copies of this same page
side-by-side in `<iframe>`s. Those two headers block a page from being
framed **at all, including by itself** — so clicking "Show Comparison"
opened the panes, but the browser refused to render anything inside them:
both sides came up silently blank.

### Fixed
- `server.py` — relaxed `X-Frame-Options` from `DENY` to `SAMEORIGIN`, and
  `frame-ancestors` from `'none'` to `'self'`. This still blocks the actual
  threat these headers exist for — another site embedding this app to trick
  someone into clicking something — while allowing the app to embed itself,
  which is exactly what Compare Periods needs. Nothing else about the CSP
  changed.
- `app.css` — also lowered the width at which Compare Periods hides itself
  from 1100px to 900px, since 1100px could hide the button on a perfectly
  usable laptop-width browser window.

## Chart "compare to previous period" — missing data labels
`app.js`'s `makeLineChart()` deliberately left the dashed comparison line
with no value labels or dots at all, to reduce clutter — but that made the
comparison line hard to actually read exact values from. Restored labels
and dots for the dashed series too, sized down and set half-opacity and
positioned *below* each point (the primary series' labels sit above), so
both lines are fully labeled without their labels colliding or the dashed
line visually competing with the primary one.

## Admin: bulk-delete confirmation went to the wrong place
`admin.html` — "Delete Selected" was writing its "Deleted N records."
confirmation into `#loginMsg` (the login form's message box) by a
copy-paste slip — invisible unless you happened to be looking at the login
panel, which isn't even shown once you're logged in. Now shown as a plain
confirmation dialog, matching how its own error path already worked.

## Preserved
- Both fixes are narrowly scoped: the CSP/frame-header change only affects
  same-origin framing permissions, and the chart change only affects the
  dashed/comparison series' rendering — no other security posture, data, or
  calculation changed.

---

## V63.4

# V63.4 — Command Palette, Skeleton Loaders, Density Toggle, Personalization

## Command palette (Ctrl+K / Cmd+K)
- `index.html`/`app.js`/`app.css` — a Spotlight/VS-Code-style palette:
  type to fuzzy-filter, ↑/↓ to move, Enter to run, Esc to close. Commands
  cover navigation (go to any tab, with its 1–5 shortcut shown), all four
  exports, Compare Periods, Reset All Filters, focus search, toggle dark
  mode / compact density / sound, open Admin, set the current tab as the
  default landing tab, and pick an accent color — so it doubles as a
  discoverable index of every shortcut/toggle in the app, not just a
  launcher. A small "⌘K" button in the header opens it too, for anyone who
  wouldn't otherwise discover the keyboard shortcut.

## Skeleton loaders
- `app.js`/`app.css` — switching tabs (or the very first load) now shows a
  shimmering placeholder shaped like the chart/table that's coming,
  instead of an empty container until data arrives. Only fills containers
  that are genuinely empty — a filter-triggered refresh of an
  already-loaded tab keeps its existing dim/fade treatment rather than
  flashing back to a skeleton.

## Density toggle (Comfortable / Compact)
- `index.html`/`app.js`/`app.css` — a "☰" header button tightens every
  table's row padding/font-size so more rows fit without scrolling.
  Remembered per-browser like the theme.

## Personalization
- **Default landing tab** — "Set … as my Default Landing Tab" in the
  command palette. A fresh visit (no tab in a shared/bookmarked URL) now
  opens on that tab instead of always "Dashboard".
- **Accent color** — six presets in the command palette re-tint buttons/
  badges/highlights app-wide via the existing `--accent` CSS variable;
  remembered per-browser.

## Preserved
- All of the above are additive UI/preference features — no calculation,
  filter, or export logic changed.

---
