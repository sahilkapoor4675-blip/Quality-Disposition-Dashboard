# Quality Disposition Dashboard — Disaster Recovery Architecture

**Document version:** V66.1 DR-1  
**Application:** Quality-Disposition-Dashboard  
**Primary database:** PostgreSQL in production  
**Bundled `quality.db`:** bootstrap/seed only; not the production source of truth

> **Security notice:** This document describes the recovery architecture for sensitive application data. Never paste production passwords, database URLs, access keys, session tokens, or backup contents into Git, issue trackers, chat, screenshots, or public repositories.

---

## 1. Objective

The dashboard must remain recoverable if any one of these fails or becomes unavailable:

- application hosting provider (for example Render)
- primary PostgreSQL provider
- Git hosting provider
- application process / deployment
- accidental delete, bad import, bad configuration update, or corrupted local backup
- loss of a hosting filesystem
- compromised or deleted recovery copy

The target is **provider portability + recoverable data + reproducible application state**, not dependence on a single host.

No architecture can honestly guarantee zero risk. The controls below are designed to make the remaining failure modes explicit, testable, and recoverable.

---

## 2. Source-of-truth model

### Live production

```text
Independent Domain / DNS
        |
        v
Replaceable App Host (Render today)
        |
        v
server.py / web application
        |
        v
PRIMARY PostgreSQL  <--- authoritative live business/application state
        |
        +----> Off-site recovery-point snapshots
        |
        +----> PostgreSQL logical dumps
        |
        +----> Provider PITR/WAL where available
```

### Repository roles

```text
Git provider A  ---- source code / deployment config
Git provider B  ---- mirror / second copy
Offline archive ---- release bundle + recovery documentation

PostgreSQL       ---- live data
Backup storage   ---- recovery data
Object storage   ---- uploaded files, if the app uses them
Secret manager   ---- credentials/secrets (NOT in Git)
DNS/registrar    ---- domain control (independent from hosting)
```

`quality.db` is never allowed to replace an existing production PostgreSQL database. It is only the first-run seed for an empty local/initial database.

---

## 3. What must be recoverable

### Data and state

1. `disposition` — live quality/disposition records.
2. `users` — accounts, roles, password hashes and account state.
3. `audit_trail` — security-sensitive audit history.
4. `activity_log` — operational/activity history.
5. `kpi_targets` and `kpi_target_history`.
6. `fishbone_master`, `fishbone_alias`, `fishbone_import_history`.
7. `rca_master`.
8. `fishbone_style`.
9. `import_history`.
10. `app_state` business state and durable revision metadata.
11. Any future persistent application table discovered from the live schema.

### Intentionally NOT restored

- active session tokens
- login-throttle counters
- transient import previews
- in-memory response caches

These are runtime state, not business truth. Sessions are intentionally invalidated after restore so a recovered system does not resurrect pre-disaster browser credentials.

---

## 4. Recovery-point model

The application maintains a monotonic durable `data_revision` in `app_state`.

```text
Revision 0
  |
  +-- import / edit / config change
  v
Revision 1 ---- recovery point RP-1
  |
  +-- new import
  v
Revision 2 ---- recovery point RP-2
  |
  +-- KPI update
  v
Revision 3 ---- recovery point RP-3
```

A recovery point is generated from the **current live database**, not from `quality.db`.

Therefore, if the live dataset evolves:

```text
4,936 records -> 5,400 -> 7,900 -> 10,250
       |            |        |         |
      RP            RP       RP        RP
```

later recovery points contain the later current state as well as all retained historical records present at that point.

### Mutation coverage

Every persistent application mutation should follow this lifecycle:

```text
validate
  |
  v
pre-change safety point
  |
  v
DB transaction
  |
  v
commit
  |
  v
post-change current-state recovery point
  |
  v
remote replication / verification
```

The code already protects the major write paths (imports, record changes, KPI targets, users, Fishbone/RCA configuration, aliases, restore). The post-change point is the current state; the pre-change point is the rollback safety net.

---

## 5. Two-layer database backup strategy

### Layer A — application recovery point

The web application creates compact JSON-GZIP snapshots containing the complete persistent application state and a SHA-256 integrity checksum.

Advantages:

- easy to inspect and restore through the Admin UI
- includes application-level state/revision metadata
- can recover even if the original database provider is gone, provided the remote copy exists
- dynamic table discovery helps future persistent tables enter the snapshot automatically

### Layer B — PostgreSQL-native dump

Use `dr_pg_backup.py` from an **independent runner** (local machine, VPS, CI runner, or another scheduler) to create PostgreSQL custom-format dumps:

```bash
DATABASE_URL='...' python3 dr_pg_backup.py dump --output ./recovery/postgres-YYYYMMDD-HHMMSS.dump
python3 dr_pg_backup.py verify ./recovery/postgres-YYYYMMDD-HHMMSS.dump
```

This is the authoritative database-level migration artifact. It is preferable for large databases because it preserves PostgreSQL objects more naturally than a JSON row-by-row application snapshot.

Runtime session data is excluded from the dump contents. The application recreates the runtime tables on startup.

### Layer C — PITR / WAL (hardened tier)

For the strongest RPO, use PostgreSQL continuous archiving / PITR or a managed provider that exposes equivalent recovery. PostgreSQL documents SQL dumps, filesystem backup and continuous archiving as distinct recovery strategies; continuous archiving is the mechanism for point-in-time recovery. ([PostgreSQL Backup and Restore](https://www.postgresql.org/docs/current/backup.html))

The application-level snapshots and logical dumps remain necessary even when PITR exists because they are useful for provider migration, long-term retention, and independent verification.

---

## 6. Off-site storage requirements

The remote bucket must be:

- private (no public listing or object access)
- separate from the application host
- protected by least-privilege credentials
- encrypted at rest
- versioned where supported
- immutable/WORM for long-retention recovery points where supported
- governed by a retention/lifecycle policy that is **not controlled by the application**

For AWS S3, Object Lock provides WORM-style protection and works only with versioned buckets. ([AWS S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html))

Cloudflare R2 exposes an S3-compatible API, but its current S3 compatibility documentation lists Object Lock operations as unsupported. Do not assume S3 Object Lock semantics simply because an object store accepts the S3 API. ([Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/))

### Application remote-copy rule

When remote DR is configured:

1. write local recovery point atomically
2. compute SHA-256
3. upload to the private bucket
4. HEAD-verify size and stored checksum metadata
5. mark the recovery point remote-verified
6. retry failed remote copies from the scheduler

If the pre-change safety backup cannot be verified remotely and `DR_REMOTE_REQUIRED_FOR_MUTATIONS=true`, the application blocks the protected mutation.

---

## 7. Encryption and secret handling

### In transit

- PostgreSQL connections use TLS (`PGSSLMODE=require` by default in the app).
- HTTPS is required in production; HSTS is sent when HTTPS is detected.

### At rest

Use provider-native encryption for database and object storage. For high-sensitivity environments, add application/client-side encryption for recovery archives so the backup remains protected even if the storage account is exposed.

### Secrets

Never put these in Git:

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- PostgreSQL passwords
- S3/R2 access keys
- encryption keys
- OAuth/API credentials
- session secrets

The recovery manifest intentionally records only non-secret configuration and file hashes.

Keep a **break-glass encrypted secret record** outside the main Git repository and outside the production host.

---

## 8. Local backup filesystem hardening

Local recovery files contain sensitive records and password hashes. They are therefore:

- stored outside the application bundle where possible
- written atomically via temporary file + rename
- checksum protected
- permission-restricted (`0700` directory / `0600` file where the host permits it)
- never served as static web assets

A local backup is **not** a disaster-recovery copy. It is only a first recovery layer.

---

## 9. Retention model

Recommended recovery horizon:

```text
Recent:      24 hourly recovery points
Daily:       30 daily points
Weekly:      12 weekly archives
Monthly:     12+ immutable archives
PITR/WAL:    provider-dependent, hardened tier
```

The web application may prune its local copies. Remote retention must be enforced at the storage layer so a compromised application account cannot erase the entire historical recovery set.

---

## 10. Recovery objectives

### Free / low-cost tier

Because free hosting/database tiers can sleep, expire, have no PITR, or impose resource limits, the realistic target is **snapshot-based recovery** rather than a zero-loss guarantee.

Expected RPO:

- application recovery point: normally near the latest successful mutation/scheduled snapshot while the app/database are reachable
- catastrophic database loss: at worst the lag since the latest independently verified off-site full snapshot

### Hardened tier

Use managed PITR/WAL or self-managed PostgreSQL WAL archiving to an independent immutable store for a materially lower RPO, potentially seconds depending on the provider and network path.

Render currently documents that PITR/recovery is not available for Free Postgres and that logical backups for a Free Postgres instance must be created externally with `pg_dump`. ([Render Postgres backups](https://render.com/docs/postgresql-backups))

Supabase currently offers PITR as a separate recovery-retention feature with pricing based on retention period; its restore process replays WAL to a selected point in time. ([Supabase database backups](https://supabase.com/docs/guides/platform/backups))

---

## 11. Exact provider-switch procedure

### Render unavailable

```text
1. Freeze new writes if possible.
2. Pick the latest VERIFIED recovery point.
3. Create a new PostgreSQL database.
4. Restore PostgreSQL dump if available; otherwise restore the verified application snapshot.
5. Deploy the exact application commit/version from the recovery manifest.
6. Install the recorded dependency versions.
7. Restore object/file storage data from the independent store.
8. Recreate secrets from the secret manager / break-glass record.
9. Run schema/count/integrity checks.
10. Run application smoke tests.
11. Point independent DNS to the new host.
12. Resume writes.
```

### PostgreSQL provider unavailable

```text
primary DB -> new PostgreSQL -> pg_restore -> application
```

The application code does not need to change when it only depends on a normal PostgreSQL `DATABASE_URL`.

### Git provider unavailable

Use the secondary Git mirror or the offline release archive. Never make GitHub the only copy of source code.

---

## 12. Restore validation gates

A restore is not complete because `pg_restore` returned exit code 0. Validate:

### Structural

- expected tables exist
- expected columns exist
- schema fingerprint matches
- indexes are present
- database migrations are at the expected application version

### Data

- record counts match recovery manifest
- primary-key/unique constraints are intact
- latest `data_revision` is the expected value
- latest record dates and import history match
- KPI targets and histories match
- Fishbone/RCA/style/alias counts match
- user count/roles match

### Functional

- login works
- viewer access works
- admin access works
- filters/KPIs work
- drilldown works
- import preview/confirm works
- export generation works
- backup create/verify works
- a new test record can be inserted without primary-key sequence collision

### Security

- all users are forced to re-authenticate
- no old active session token works
- secrets are not in logs or source
- domain serves HTTPS
- backup bucket remains private

---

## 13. Important PostgreSQL restore detail: sequences

A PostgreSQL `BIGSERIAL`/identity sequence does **not automatically advance** simply because a recovery operation inserts explicit historical IDs.

Therefore V66.1 explicitly resynchronises PostgreSQL ID sequences after an application-level snapshot restore. Without this control, a later `INSERT` could try to reuse an already restored primary-key value.

This is one reason PostgreSQL-native dumps remain an important second recovery layer.

---

## 14. Backup integrity model

Every application recovery point carries:

```text
backup_version
created_at
reason
data_revision
data_changed_at
disposition_revision
persistent_tables
table_schema
schema_fingerprint
counts
tables
application_manifest
integrity_sha256
```

The checksum is calculated over the complete payload excluding the checksum field itself.

Remote verification additionally checks:

```text
local byte length == remote byte length
AND
local SHA-256 == remote stored SHA-256 metadata
```

This detects accidental corruption/transmission issues. It is **not a substitute for access control or WORM storage**.

---

## 15. Backup failure behaviour

### Before a protected mutation

The application creates a pre-change safety point first.

If remote DR is configured and marked required, the mutation is blocked when that safety point cannot be verified remotely.

### After a committed mutation

The application attempts a post-change current-state snapshot. If that step fails, the mutation is already committed and therefore cannot honestly be rolled back by the backup subsystem. The system marks DR as degraded and the scheduler retries the current live revision.

This distinction is deliberate: never tell an operator that a database mutation was rolled back when it was already committed.

---

## 16. Database-level backup runner

`dr_pg_backup.py` is deliberately external to the web request path.

Recommended job:

```text
Every 6–24 hours:
    pg_dump custom format
    -> checksum
    -> manifest
    -> private off-site store
```

Use an independent scheduler so a sleeping web service does not stop the database backup process.

For sensitive environments, use two independent runners on different providers or at least one runner outside the primary hosting provider.

---

## 17. 3-2-1-1-0 target

The practical target is:

- **3** copies of important data
- **2** different storage/provider locations
- **1** off-site copy
- **1** immutable/offline copy for long-term protection
- **0** unresolved backup-integrity errors before the recovery point is accepted

For the dashboard this maps to:

```text
LIVE PostgreSQL
      |
      +--> application recovery point
      |
      +--> PostgreSQL logical dump
      |
      +--> immutable/off-site archive
```

---

## 18. Failure scenarios

### Scenario A — Render disappears

Result: source code + PostgreSQL + off-site recovery point remain available. Deploy to another host and point DNS to it.

### Scenario B — PostgreSQL provider deletes the database

Result: create a new PostgreSQL instance and restore the latest verified dump/recovery point.

### Scenario C — Bad Excel import

Result: choose the recovery point immediately before the bad import, restore it after freezing writes, then re-open the application.

### Scenario D — Accidental record deletion

Result: restore a recovery point before the delete, or use the newer point if the deletion itself was not desired.

### Scenario E — Git repository removed

Result: deploy the secondary mirror/offline release bundle.

### Scenario F — Backup bucket compromised

Result: immutable/versioned historical copies should remain undeletable by the normal application credential; rotate the compromised storage credentials and investigate.

### Scenario G — Credentials compromised

Result: disable/rotate credentials, invalidate sessions, rotate database/storage credentials, verify audit logs, then restore from a known-good recovery point only if data integrity is in doubt.

---

## 19. Operational rules

1. Never run production on SQLite when PostgreSQL is required by the deployment architecture.
2. Never treat `quality.db` as the live production database after PostgreSQL is configured.
3. Never commit production recovery files to Git.
4. Never put database/storage secrets into source code.
5. Never delete the last verified off-site recovery point during a migration.
6. Never restore into production without a pre-restore safety point.
7. Never declare DR healthy based only on “backup file exists”; verify checksum and remote status.
8. Test restores periodically, not only backups.
9. Keep the domain registrar/DNS independent from the hosting provider.
10. Keep at least one code copy outside the primary Git provider.

---

## 20. Minimum deployment checklist

### Before production

- [ ] External PostgreSQL configured.
- [ ] PostgreSQL TLS required.
- [ ] `quality.db` confirmed seed-only.
- [ ] Independent private backup bucket configured.
- [ ] Storage versioning enabled.
- [ ] Immutable retention enabled where supported.
- [ ] `DR_REMOTE_REQUIRED_FOR_MUTATIONS=true`.
- [ ] Backup upload + verification tested.
- [ ] PostgreSQL dump + restore tested.
- [ ] New-record-after-restore sequence test passed.
- [ ] Secondary Git copy created.
- [ ] Domain/DNS access documented.
- [ ] Secret recovery documented securely.

### After every release

- [ ] Code/dependency version recorded.
- [ ] Regression suite passes.
- [ ] Backup creation/verification passes.
- [ ] Restore test plan remains valid.

### Periodically

- [ ] Restore the latest backup into an isolated database.
- [ ] Compare counts and revision.
- [ ] Run application smoke tests.
- [ ] Rotate storage credentials when required.
- [ ] Verify the independent DNS/domain account is still accessible.

---

## 21. Current application-specific assessment

The current V66 architecture has a strong base:

- PostgreSQL is treated as production source of truth.
- `quality.db` remains bootstrap seed data.
- persistent-table discovery reduces the risk of forgetting new tables.
- application snapshots have checksums.
- major mutations create safety/current-state recovery points.
- remote replication is supported.
- restores are transactional.
- sessions are intentionally invalidated after restore.
- V66.1 additionally fixes PostgreSQL sequence resynchronisation after row-level snapshot restore.

The remaining architectural dependency that cannot be solved by application code alone is **provider-level PostgreSQL durability/PITR**. For a truly low-RPO sensitive-data deployment, enable a managed PITR/WAL capability or operate PostgreSQL with continuous WAL archiving to an independent immutable store.

---

## 22. Authoritative references

- PostgreSQL 18 Backup and Restore: https://www.postgresql.org/docs/18/backup.html
- PostgreSQL WAL configuration: https://www.postgresql.org/docs/18/runtime-config-wal.html
- Render Postgres recovery/backups: https://render.com/docs/postgresql-backups
- Supabase database backups/PITR: https://supabase.com/docs/guides/platform/backups
- AWS S3 Object Lock: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- AWS S3 Object Lock configuration: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html
- Cloudflare R2 S3 API compatibility: https://developers.cloudflare.com/r2/api/s3/api/
- GitHub Terms of Service — cancellation/termination: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
