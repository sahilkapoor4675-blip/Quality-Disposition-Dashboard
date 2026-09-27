# Quality Disposition Dashboard — V66.1 DR / Security Audit Report

**Audit date:** 2026-09-27  
**Scope:** full V66.1 merged application tree, deployment configuration, DR code, tests, export paths, administrative UX, and local static checks.  
**Sensitivity:** application contains business records, audit/activity history, user accounts and password hashes; recovery artifacts must be treated as sensitive data.

## Executive outcome

The application passed the functional/regression test suites and the new disaster-recovery unit tests. The V66.1 hardening work closes two material recovery-consistency issues found during the audit: PostgreSQL sequence resynchronisation after row-level snapshot restore, and the split `disposition`/`import_history` transaction path.

The architecture now separates live PostgreSQL state from the bundled `quality.db` seed and provides both an application-level recovery snapshot and a PostgreSQL-native backup path. An independent off-site copy is supported and can be configured as a required, verified pre-mutation safety gate.

**No backup architecture can honestly guarantee zero data loss under every provider outage.** For the strongest RPO, the database provider must expose continuous archiving/PITR/WAL or an equivalent service, and that recovery stream should be retained independently. PostgreSQL documents SQL dumps, filesystem backups and continuous archiving as distinct strategies; continuous archiving supports point-in-time recovery. ([PostgreSQL 18 Backup and Restore](https://www.postgresql.org/docs/18/backup.html))

## Data-truth verification

- Bundled `quality.db`: bootstrap/seed dataset only.
- Production: PostgreSQL via `DATABASE_URL` is authoritative.
- The V5 application snapshot is generated from the live database and dynamically discovers persistent tables.
- The snapshot carries data revision, schema fingerprint, table counts and SHA-256 integrity data.
- Runtime state such as active session tokens and login-throttle counters is intentionally not restored; users and password hashes remain persistent.

This means a future state such as `4,936 -> 5,400 -> 7,900` is represented by successive recovery points from the live database rather than repeatedly backing up only the original 4,936-row seed.

## Material issues fixed

### 1. PostgreSQL sequence collision after application-level restore — FIXED

Explicitly restoring historical IDs can leave `BIGSERIAL`/identity sequences behind the restored maximum ID. V66.1 resynchronises PostgreSQL sequences after application-level snapshot restore and adds a regression guard for this path.

### 2. Split import transaction — FIXED

The import path could commit `disposition` rows and then separately write `import_history`, creating a state in which the data import existed without its history record if the second step failed. V66.1 allows `import_history` to be included in the same database transaction as the imported records.

### 3. Silent audit-trail write failure — HARDENED

Audit persistence remains non-blocking for the main request path, but failures are now logged as explicit warnings instead of being silently swallowed. This makes a degraded audit subsystem observable without falsely claiming the operation was denied.

## Backup architecture controls

1. **Immediate application recovery point after persistent mutation.**
2. **Scheduled recovery point** to catch any missed path or delayed replication.
3. **PostgreSQL custom-format dump** from an independent runner.
4. **SHA-256 verification** for local and off-site artifacts.
5. **Private off-site storage** separated from the web host.
6. **Optional S3 Object Lock retention** when the destination supports it.
7. **Versioning/immutability recommended at the storage layer.**
8. **Exact application commit/version captured** in the recovery manifest when available.
9. **Dependency/runtime metadata** captured for reproducibility.
10. **Pre-restore safety copy** and transactional restore behaviour.
11. **Post-restore validation** including counts, revision, configuration and new-ID creation.
12. **Provider-switch documentation** in `DISASTER_RECOVERY_ARCHITECTURE.md` and `DR_RUNBOOK.md`.

For S3, Object Lock uses a WORM model and requires versioning. It can prevent protected object versions from being deleted or overwritten during retention. ([AWS S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html))

CISA recommends offline, encrypted backups and regular testing of backup availability/integrity; its ransomware guidance also recommends maintaining golden images and using infrastructure as code for rapid rebuilds. ([CISA StopRansomware Guide](https://www.cisa.gov/stopransomware/ransomware-guide))

NIST SP 800-34 treats contingency planning as an ongoing lifecycle that includes recovery strategies, testing/exercises and maintenance rather than a one-time backup task. ([NIST SP 800-34](https://csrc.nist.gov/pubs/sp/800/34/final))

## Provider-dependency findings

### Render

Render can host the application, but its Free Postgres tier does not provide the recovery capabilities available on paid tiers; Render's current documentation says Free Postgres requires users to create logical backups externally with `pg_dump`. Therefore production recovery should not depend on Render Free Postgres retention. ([Render Postgres backups](https://render.com/docs/postgresql-backups))

### PostgreSQL

PostgreSQL itself is portable. A custom-format `pg_dump` can be restored with `pg_restore`; continuous archiving/PITR is the stronger low-RPO layer when supported. ([PostgreSQL Backup and Restore](https://www.postgresql.org/docs/current/backup.html))

### Git hosting

Source code is a separate recovery object. Maintain an independent Git mirror and an offline/release archive. Do not store live production database dumps or secrets in Git. GitHub's current Terms include account/content cancellation and termination provisions, so a single GitHub copy should not be treated as the only source of recovery. ([GitHub Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service))

## Security-sensitive handling

- Production database URLs, administrator passwords, access keys and encryption keys are not committed.
- Recovery manifests exclude secrets.
- Backup artifacts are permission-restricted locally where the host allows it.
- Remote storage should be private and least-privilege.
- For sensitive data, use server-side encryption at minimum and consider client-side encryption for recovery archives so storage compromise alone does not reveal data.
- Keep the break-glass recovery credential record separate from the production host and Git provider.
- Rotate compromised credentials and invalidate sessions after a security incident.

## Verification performed

### Application and static checks

- Python bytecode compilation: **PASS**
- `node --check app.js`: **PASS**
- `node --check sfx.js`: **PASS**
- Application smoke test: **PASS**
- Export acceptance: **PASS**
- Admin UX audit: **PASS**

### Regression

Unified regression: **PASS — all 6 suites**

Reported core pass indicators include:

```text
rows_ok=1
import_concurrency=1
kpi=1
cache=1
activity_retention=1
backup_integrity=1
restore=1
restore_rollback=1
full_state_backup=1
safety_gate=1
report_filename=1
http=1
admin_handler_hardening=1
security_hardening=1
```

### DR-specific tests

**5/5 PASS**

```text
test_import_history_can_commit_atomically_with_disposition
  PASS

test_postgres_sequence_restore_guard_uses_max_id
  PASS

test_restore_round_trip
  PASS

test_strict_bool_rejects_string_false
  PASS

test_v5_snapshot_tracks_live_revision_and_all_tables
  PASS
```

### Live-state recovery simulation

A controlled test was run with a fresh seeded baseline. It verified that a mutation advanced the live dataset from **4,936 to 4,937**, that the recovery point followed the new revision, and that restore returned the **4,937-row** state including the updated record.

## Non-blocking findings

The code-health audit reports **171 duplicate CSS selector groups** and **24 orphaned CSS classes**. These are report-only frontend hygiene findings; they were not removed automatically because changing an existing CSS cascade without visual regression evidence can introduce UI regressions. The functional/admin UX regression suite passed.

The container environment's `pip check` reports an unrelated installed-package conflict (`moviepy` requires `pillow<12`, while the environment has Pillow 12.3.0). `moviepy` is not a dependency in this application's `requirements.txt`, so this was not treated as an application dependency defect.

The runner used for this audit does not have the PostgreSQL client binaries (`pg_dump`/`pg_restore`) installed, so a real provider-backed PostgreSQL dump/restore cannot be executed inside this sandbox. The application DR logic and `dr_pg_backup.py` were syntax-tested and the local application-level backup/restore path was exercised. A real PostgreSQL restore drill remains a deployment prerequisite, not a claimed completed sandbox action.

## Production activation gates

Before declaring DR production-ready, configure and test all of the following:

- [ ] Independent PostgreSQL provider with TLS.
- [ ] Independent private off-site backup storage.
- [ ] Storage encryption enabled.
- [ ] Versioning enabled where supported.
- [ ] Object Lock/immutable retention enabled where supported and tested.
- [ ] `DR_REMOTE_ENABLED=true`.
- [ ] `DR_REMOTE_REQUIRED_FOR_MUTATIONS=true`.
- [ ] Remote upload + SHA-256 verification tested with a real bucket.
- [ ] Independent `dr_pg_backup.py dump` tested against the real database.
- [ ] `verify` and `restore` tested into a disposable PostgreSQL instance.
- [ ] Restore validation includes new-record insert to prove sequence correctness.
- [ ] Secondary source-code mirror created.
- [ ] Independent DNS/registrar access documented.
- [ ] Break-glass secrets documented in a secure non-Git location.
- [ ] Quarterly restore drill scheduled.

## Residual risk

The remaining risk is not hidden in the application: a provider outage can still create a recovery point lag if the latest mutation has not reached an independent external copy, and no free-tier arrangement guarantees zero-loss recovery. The low-RPO path is continuous PostgreSQL WAL/PITR or equivalent managed database recovery, combined with independent immutable retention. The architecture therefore separates the **free operational mode** from the **hardened sensitive-data mode** and makes the difference explicit.
