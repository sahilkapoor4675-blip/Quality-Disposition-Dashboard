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
