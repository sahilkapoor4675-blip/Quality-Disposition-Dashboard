# V58 Release Gate

V58 is a stability/release-candidate baseline. Future changes should not be promoted unless the regression gate passes on an isolated database.

## Required checks

```bash
python -m py_compile server.py reports.py
node --check app.js
python tests/regression_smoke.py
python tests/http_smoke.py
```

The regression suite covers data validation, idempotent/concurrent disposition import, KPI/analysis calculations, cache limits, activity retention, backup integrity/tamper detection, restore, and CSV safety.

The HTTP smoke suite exercises health/readiness plus the registered public API, export endpoints, login, and admin read endpoints against a temporary SQLite database. It never uses production credentials or a production database.

## Production discipline

Keep `DATABASE_URL` pointed at the production PostgreSQL service. Do not run the test scripts against production. Any schema or business-logic change must be followed by the complete gate before release.
