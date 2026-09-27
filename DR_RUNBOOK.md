# Quality Disposition Dashboard — DR Runbook

## Emergency: application host lost

1. Freeze writes where possible.
2. Locate the latest **verified** application recovery point and/or PostgreSQL dump.
3. Provision a new PostgreSQL instance.
4. Restore the PostgreSQL dump when available.
5. Deploy the exact application version/commit recorded by the recovery manifest.
6. Restore file/object storage data.
7. Configure secrets from the secure secret record.
8. Start the application.
9. Run `GET /healthz` and `GET /readyz`.
10. Run functional checks: login, dashboard, import, export, admin, backup verify.
11. Verify live record counts, revision, KPI/Fishbone/RCA counts and latest data date.
12. Only after validation, point the independent DNS record to the new host.
13. Resume writes.

## Emergency: database lost

```bash
python3 dr_pg_backup.py verify /secure/recovery/postgres-YYYYMMDD-HHMMSS.dump
DATABASE_URL='NEW_DATABASE_URL' python3 dr_pg_backup.py restore /secure/recovery/postgres-YYYYMMDD-HHMMSS.dump --yes
```

For an application snapshot instead:

```bash
python3 dr_recovery.py verify /secure/recovery/backup_YYYYMMDD_HHMMSS_reason_UUID.json.gz
DATABASE_URL='NEW_DATABASE_URL' python3 dr_recovery.py restore --yes /secure/recovery/backup_YYYYMMDD_HHMMSS_reason_UUID.json.gz
```

Run restores against a maintenance/frozen application. Never perform a destructive production restore without a pre-restore safety copy.

## Emergency: bad import / accidental delete

Choose the recovery point **immediately before the unwanted mutation**. Verify it first. Restore to a temporary environment when possible, compare counts and inspect the affected records, then promote the recovered database.

## DR drill

Perform at least quarterly in a disposable environment:

```text
latest backup
  -> new PostgreSQL
  -> restore
  -> application deploy
  -> login
  -> dashboard
  -> filters
  -> import test
  -> export test
  -> new record
  -> backup verify
```

Success criteria:

- no checksum failure
- expected record counts
- expected `data_revision`
- new record receives a non-colliding ID
- users/roles present
- KPI/Fishbone/RCA configuration present
- no pre-restore sessions survive

## Secrets

Never store `DATABASE_URL`, access keys, encryption keys or administrator passwords in this runbook. Store them in the organization's approved secret manager and keep a separately protected break-glass recovery record.
