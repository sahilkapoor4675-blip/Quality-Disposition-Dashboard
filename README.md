# Quality Disposition Control Dashboard — V60.0

**Release:** FINAL-STABILITY-HARDENED

Pure Python (`http.server`) dashboard with PostgreSQL support for production and SQLite for local/offline development. No Flask and no external frontend CDN.

## Production data model
Render + external PostgreSQL (Supabase/Neon/etc.) is the recommended production path. On Render, the app fails closed when `DATABASE_URL` is missing; it will not silently switch a production deployment to SQLite.

For local development, omit `DATABASE_URL` and the app uses a persistent SQLite file outside the application bundle. Existing local data is not reseeded on normal restarts or code replacement.

## Run locally
```bash
python3 server.py
```
Open `http://localhost:8000/`. Set `DB_PATH` when you need an explicit SQLite location.

## Required production environment
Set these in Render Environment Variables, never in Git:
```text
DATABASE_URL=<PostgreSQL connection string>
ADMIN_USERNAME=<initial admin username>
ADMIN_PASSWORD=<strong admin password>
DB_LIMIT_MB=500
```

`ADMIN_USERNAME` / `ADMIN_PASSWORD` provision the account only when that username does not already exist. Existing users, roles, passwords and imported data are preserved.

## Data imports
Use `/admin` for single-record entry or bulk `.xlsx/.xlsm/.csv/.tsv` imports. Imports are validated before write, duplicate BATCH NO values are handled as no-op/update according to the existing business rule, and each data-changing import creates a safety backup.

**Business rule:** normalized non-empty `BATCH NO` identifies one coil. Existing legacy duplicate groups are never deleted automatically. PostgreSQL imports are transaction-locked so concurrent imports cannot both create the same new batch.

## Backups and restore
Backups are JSON-GZIP snapshots stored outside the application bundle. V55 fixed the backup snapshot/writer contract regression. V56 added P1 data-safety/concurrency hardening. V57 adds P2 cache bounds, backup integrity checks, serialized backup writes, and audit-history retention limits.

The built-in backup is a recovery aid, not a substitute for provider-level durable/off-site backup. For production, periodically download/copy backups outside the Render instance.
Legacy V54/V55/V56 backups remain restoreable; V57 adds checksums to newly created backups without invalidating older backup files.

## Security
- Admin mutation APIs require authenticated role checks and CSRF validation.
- Login attempts are rate-limited.
- Public activity event/heartbeat endpoints are rate-limited independently; normal admin POST actions are not throttled by the activity limiter.
- CSV exports prefix spreadsheet-formula control strings so exported operational data is treated as text by spreadsheet programs.
- Request bodies, sessions and import previews are bounded.

## Dashboard
The dashboard provides live filters, KPI cards, defect analysis, work-center/grade views, trends, QCR intelligence, Fishbone/RCA references and Excel/PDF/PPTX/CSV exports. Viewer access remains read-only.

## Schema
`supabase_schema.sql` is the reference PostgreSQL schema. Runtime startup remains authoritative and performs idempotent migrations for older deployments.

## Release notes
**V60.0 — STABILITY RELEASE CANDIDATE**
- Fixed admin CSV formula-injection protection gap.
- Wired activity-log retention with periodic cleanup.
- Scoped activity rate limits to public activity endpoints only.
- Added transactional import serialization for SQLite and PostgreSQL.
- Updated the reference PostgreSQL schema to match runtime columns/tables.
- Removed stale documentation that referenced absent `build_db.py` / bundled `quality.db` as the production source of truth.
- Unified backend/frontend release identity and cache-busting to V60.0.

V56.0 remains the preceding P1-hardened build; V55.0 is the preceding P0-repaired build. The build process never connects to production PostgreSQL and does not delete existing application rows.

## Current release

V60.0 is the stability/release-candidate build built on the P0/P1/P2 hardening baseline. P0/P1 data-safety behavior is retained; production PostgreSQL is never modified by the build process.

## V60 Stability Release Gate
V60 includes permanent isolated regression scripts under `tests/` plus final admin inline-handler hardening. Before deploying a new build, run the commands in `RELEASE_GATE.md` and require all checks to pass.
