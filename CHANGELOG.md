# Changelog

Consolidated fix/version history (previously split across CHANGELOG_V46.md,
P0_FIXES.md, P0_REPAIR_V55.md, P1_FIXES.md, P1_FIXES_V53.md, P1_FIXES_V56.md,
P2_FIXES.md, P2_FIXES_V54.md, P2_FIXES_V57.md, V58_STABILITY.md, V59_FINAL.md,
V60_FINAL_STABILITY_HARDENED.md). Newest first.

---

## V60.0 — Final Stability Hardened

V60 is the post-V59 deep-audit release. It keeps the V59 regression and HTTP release gates and closes the remaining production-safety findings.

**Deep-audit fixes**
- Render `ADMIN_USERNAME` / `ADMIN_PASSWORD` are provisioning-only. Once a matching database user exists, authentication uses the stored database password only.
- Import confirmation now takes a pre-change safety backup, matching direct import behavior.
- Record deletion now takes a pre-change safety backup.
- Fishbone alias create/update/delete now take pre-change safety backups.
- Backups now snapshot the full persistent application state: users, activity log, audit trail, fishbone import history, and existing quality/configuration tables.
- Backup validation checks section types/counts and validates the V4 full-state scope.
- Session dictionary reads/writes used by authentication/admin flows are synchronized with `SESSION_LOCK`.
- Proxy forwarding headers are untrusted by default; Render explicitly enables trusted proxy headers through `TRUST_PROXY_HEADERS=true`.
- Report filenames strip control characters, quotes, separators, and unsafe characters before entering `Content-Disposition`.

**Verification:** deep regression suite, 45-route HTTP smoke suite, admin inline JS syntax, app JS syntax, Python AST checks, backup integrity/tamper detection/full-state restore, concurrent import, environment-password auth transition, report filename header-safety — all PASS. Production PostgreSQL was not modified during this audit.

---

## V59.0 — Final Stability Hardening

- Fixed admin inline JavaScript argument handling for usernames and defect names.
- Fixed quality-drill record button handler generation.
- Added HTML-attribute-safe JavaScript escaping helper.
- Preserved V58 P0/P1/P2 data-safety, backup, import-concurrency, and release-gate behavior.

---

## V58 — Stability Baseline

V58 does not introduce a new business-data model. It establishes a stable release baseline around the V57 P0/P1/P2 repairs and packages the regression checks used to prevent those fixes from regressing again.

Validated in isolated test databases: disposition insert/update/idempotency and concurrent import serialization; KPI and analysis calculation smoke tests; response-cache entry/byte ceilings; activity-log retention ceiling; backup creation, checksum verification, tamper detection, and restore; input validation and CSV formula-injection protection; health/readiness and 45 registered HTTP/admin read routes; release/version consistency and shipped-artifact hygiene.

The tests are intentionally isolated from production PostgreSQL.

---

## V57.0 — P2 hardening

- Bounded the in-process response cache by both entry count and serialized payload bytes.
- Added an embedded SHA-256 integrity checksum to every new backup; V57 verifies it during listing, explicit verification, and restore. Pre-V57 backups remain structurally restoreable without a checksum.
- Serialized backup writers and retained atomic temp-file + fsync + replace behavior.
- Tightened activity-rate map cleanup to remove the oldest keys first.
- Added a large configurable audit-trail retention ceiling (`AUDIT_RETENTION_MAX`, default 100,000) so long-lived deployments do not grow audit storage without bound.
- Reject unsupported HTTP `Transfer-Encoding` bodies before body parsing; the app expects a bounded `Content-Length`.
- Kept existing P0 backup/restore rollback and P1 import-concurrency protections intact.
- Release/versioned static asset identity moved to V57.0.

Data-preserving; tested only against isolated local copies.

---

## V56.0 — P1 fixes

1. Admin CSV export now uses the same spreadsheet-formula safety function as public CSV exports.
2. Activity-log retention is now actually invoked, with a five-minute cleanup interval and a 10,000-row bound.
3. The activity rate limiter was moved off the global POST path and is now scoped to `/api/activity/event` and `/api/activity/heartbeat`. Admin imports, KPI updates, backups and password actions are no longer accidentally throttled by activity traffic.
4. Disposition imports are serialized with a process lock; PostgreSQL also uses a transaction-scoped advisory lock and SQLite uses `BEGIN IMMEDIATE`, preventing concurrent imports from racing on new BATCH NO values.
5. Existing legacy duplicate BATCH NO groups are preserved; V56 does not delete or merge them.
6. `supabase_schema.sql` now reflects runtime columns/tables including `batch_no`, `ud_date`, `must_reset_password`, activity IP/visitor fields, audit trail, KPI history and Fishbone/RCA/style tables.
7. Release identity is unified at V56.0 (`APP_VERSION`, `VERSION.txt`, frontend asset query strings).
8. README now documents Render + external PostgreSQL as the canonical production path and removes stale `build_db.py` / bundled `quality.db` deployment instructions.

No live/production PostgreSQL connection is used during build or tests. No existing application rows are deleted as part of these fixes.

---

## V55 — P0 Repair (Backup Regression Fix)

Repair applied to the V54 P2 hardened build.

- Repaired the backup snapshot envelope mismatch that caused backup creation to fail with `KeyError: counts`.
- Backup snapshots now consistently include `backup_version`, `created_at`, `reason`, `database_backend`, `counts`, and all restore-required data sections.
- Timestamp/date values are converted to JSON-safe ISO strings during snapshot serialization.
- Backup list validation and restore compatibility were re-tested.

**Validation:** server.py/reports.py Python syntax PASS, app.js Node syntax PASS, empty-schema SQLite backup creation PASS, populated SQLite backup + restore smoke test PASS. No production PostgreSQL connection or live data was touched.

---

## V54.0 — P2 hardening

- Consistent backup snapshot helper using a single read transaction.
- Backup filename collision hardening.
- Activity-log retention cap and public activity endpoint rate limiting.
- Persistent server-error event recording for the admin error monitor.
- Render deployment now fails closed if `DATABASE_URL` is absent instead of silently using SQLite.
- Restore paths clear response cache.
- Added normalized BATCH NO lookup index for import performance.
- Fishbone full refresh clears obsolete style rows.

Existing production data is preserved; no live database was accessed.

---

## V53.0 — P1 fixes

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

No production database was accessed or modified.

---

## P2 Hardening — V52.0

Data-preserving maintenance release.

- Unified application release version to V52.0.
- Added thread-safe response/session/login state handling and bounded in-memory maps.
- Added cache invalidation on all known state-changing dashboard/admin paths.
- Made local backup writes atomic (temp file + fsync + os.replace).
- Added backup manifest metadata and backup-file integrity visibility.
- Added app-version response headers.
- Aligned static asset cache-busting with the release version.
- Bounded import preview memory and expired previews proactively.

No production database was modified by this release build.

---

## P1 Bug-Fix Release

Built on the P0-fixed package; keeps existing production data untouched.

**Data/KPI correctness**
- Canonical validation now treats `INSP LOT DATE` as the source of truth for Month/Week/Quarter/Financial Year.
- Defect Intensity `NONE` is normalized for new records; filters treat blank and legacy literal `NONE` consistently.
- Trend period discovery respects active filters, preventing no-data periods from becoming false 0% observations.
- Quarter period-over-period comparison is disabled when FY is `All`, avoiding ambiguous cross-year comparisons.
- Historical KPI targets are resolved by effective date rather than always using the current target; report exports use the same historical targets.
- QCR forecast risk uses the configurable KPI target/warning/direction settings.
- Data-integrity checks now detect finite/non-positive weights, missing batch numbers, and legacy `NONE` intensity consistently.
- A normalized unique index protects non-empty BATCH NO values where no legacy duplicates exist; legacy duplicates are never deleted automatically.

**Backup/recovery**
- Backup snapshots include KPI target history and import history.
- DB-native date/time values are serialized safely as ISO strings in backups.
- Restore remains atomic and fail-closed, and includes imported history sections and true snapshot replacement for KPI targets.
- Mutating admin workflows require a pre-change safety backup before writing live data.

**Security/export safety**
- Main dashboard/QCR database-derived HTML/SVG values are escaped before insertion.
- CSV exports escape spreadsheet formula prefixes for text values; XLSX report text values are protected from formula injection.
- Viewer login uses the shared login-failure rate limiter.
- Client IP forwarding headers are only trusted when `TRUST_PROXY_HEADERS` is enabled.

**Audit/workflow consistency**
- Single-record add, direct import, delete, KPI-target changes, Fishbone import, and Fishbone-alias changes now write activity/audit signals consistently and invalidate response caches where required.
- Direct import now records an `import_history` row.
- Delete returns `404` when the target record does not exist instead of reporting a successful zero-row deletion.

No production database or user data was modified while building or validating this release.

---

## P0 Fixes — Data-Preserving Release

Closes the identified P0 reliability/data-safety issues without modifying any live database or bundled data.

- PostgreSQL uses a thread-safe `ThreadedConnectionPool` with locked lazy initialization.
- `/readyz` is now the deployment readiness gate; startup stays unready if schema/seed/index initialization fails. `/healthz` remains a process-liveness endpoint.
- Render health check points to `/readyz`.
- Imported period fields are checked against `INSP LOT DATE`; existing rows are not rewritten.
- Non-finite output weights (`NaN`, `Infinity`, `-Infinity`) are rejected.
- Backup restore is atomic and fail-closed: any restore component failure rolls back the complete restore instead of reporting success with partial data.
- KPI target restore is true snapshot replacement for that table (targets absent from the backup are removed inside the same transaction; failure rolls everything back).

No production database, user data, or existing backup was opened, rewritten, migrated, or deleted while producing this release.

---

## V46 — Intro fixes

**1. Intro no longer goes blank after the video**

Root cause was in the media asset, not the page code. The source clip `quality_nonferrous_intro_light.mp4` was 10.0s long and its last ~1.0s washed the whole composition out to white and then faded to black. The old script froze the player on its "last visible frame", but that frame *was* the black one — so the screen went dark the moment playback finished.

Fixes:
- The clip is re-encoded and trimmed to **8.70s**, dropping the wash-out/fade-to-black entirely (audio gets a 0.6s fade-out). The final frame is now the fully composed end state.
- New asset `quality_nonferrous_intro_endcard.png` — a pixel-exact copy of that final frame — is layered over the `<video>` and fades in the instant playback stops, and is also wired up as the `poster`.
- `.intro-stage` now creates its own stacking context (`z-index:1; isolation:isolate`) so the ambient glow, sweep lines and particles animate above the frozen end-card.
- Freeze is now driven by `timeupdate` (duration − 0.08s), with `ended`, `pause`, `error` and a duration-based timeout as fallbacks. The video never loops or restarts.

**2. "Cupronickel Division" sat on top of the divider line**

Baked into the video frames, which is why earlier CSS-side attempts had no effect. Repaired at the frame level: the region is cleaned, the division name re-rendered at its original size/colour/centre, and the orange rule moved below it as a proper underline. Composited into the video from 1.53s through to the end.

**3. Intro hint legibility**

`CLICK ENTER DASHBOARD TO CONTINUE` was near-white and only readable because the intro used to end on black. Now dark slate, shifting to brand orange with a soft pulse once the video has stopped.

**Files touched:** `quality_nonferrous_intro_light.mp4` (re-encoded, 8.70s), `quality_nonferrous_intro_endcard.png` (new), `index.html`, `server.py`.

---

## V46.1 — Deploy fix: port scan timeout

The build succeeded but the deploy was cancelled with `Port scan timeout reached, no open ports detected`. The process was alive the whole time — it just never got as far as binding a socket, because `main()` ran schema/seed/index setup before constructing the server, and that is slow against a cold external Postgres.

- `main()` now binds and starts serving first; schema/seed/index work moved into `_run_startup_tasks()` on a background thread. The port opens in about a second regardless of database speed.
- Each startup task is individually wrapped, timed and logged.
- New `/healthz` (and `/readyz`) endpoint — first route checked, touches no database, no auth, no disk. Wired up as Render's `healthCheckPath`.
- Startup logging is line-buffered and `PYTHONUNBUFFERED=1` is set in `render.yaml`.
- `render.yaml` gains an explicit `buildCommand`.

Note: the host was observed using Python 3.14 and ignoring `runtime.txt` (which asks for 3.11.9); everything installs and parses fine on 3.14 regardless.
