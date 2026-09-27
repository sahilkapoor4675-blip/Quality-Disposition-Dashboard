# Platform Continuity Setup — for THIS deployment (Render + Supabase + GitHub)

This file is written for the exact stack described in `SUPABASE_RENDER_FREE_SETUP.md`:
**Render (free web host) + Supabase (free PostgreSQL) + GitHub (source code)**.
It tells you exactly what is now automated, and exactly which few steps only
you can do (they require logging into your own accounts — nothing outside
this chat can do that for you).

Read `DISASTER_RECOVERY_ARCHITECTURE.md` for the full design and
`DR_RUNBOOK.md` for step-by-step recovery commands. This file is the short,
stack-specific "make it real" checklist.

---

## What is already automated for you (no action needed)

1. **Inside the app**: every important write (import, record edit, KPI/Fishbone/
   RCA change, user change, restore) already creates a recovery-point snapshot
   automatically, stored in `recovery/` next to the app.
2. **`.github/workflows/dr-backup.yml`** (added in this update): a scheduled
   job that runs every 12 hours on GitHub's own servers — completely
   independent of Render and Supabase — and creates a verified PostgreSQL
   dump of your live database, uploaded to an off-site bucket. This is the
   piece that used to be missing: a backup runner that does **not** depend on
   Render being awake.

Neither of these needs a paid plan.

---

## The 4 things only you can set up (10–15 minutes total)

I can't create accounts or click buttons in your Render/Supabase/Backblaze/
GitHub dashboards — only you can, since they're tied to your login. Everything
else (code, workflow, docs) is already done and tested. Here is exactly what
to do:

### Step 1 — Create a free off-site bucket (Backblaze B2 recommended)

Backblaze B2 has a free tier (10 GB storage) and — unlike Cloudflare R2 —
does **not** ask for a card/bank account, as long as the bucket stays
**private** (a public bucket needs payment history on file; a private one,
which is what backups should be anyway, only needs email verification).

1. Sign up at https://www.backblaze.com/cloud-storage → verify your email.
2. **B2 Cloud Storage → Buckets → Create a Bucket**, e.g.
   `quality-disposition-recovery`. Set it to **Private**.
3. **Account → App Keys → Add a New Application Key** → scope it to that
   bucket only, with Read & Write permission.
4. Note down: `keyID` (→ Access Key ID), `applicationKey` (→ Secret Access
   Key), and the bucket's **Endpoint** shown on the bucket page, e.g.
   `s3.us-west-002.backblazeb2.com`. The region is the part in the middle,
   e.g. `us-west-002`.

(Cloudflare R2 and AWS S3 also work with the same code — R2 additionally
requires billing info even on the free tier, and S3 supports Object Lock/WORM
retention but costs egress fees; see `DISASTER_RECOVERY_ARCHITECTURE.md` §6.
Backblaze B2 is the no-card free choice.)

### Step 2 — Add the same secrets in **two** places

**A. GitHub (for the scheduled off-site Postgres dump)**
Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add:
```
DATABASE_URL             (your Supabase pooler connection string)
DR_S3_BUCKET              quality-disposition-recovery
DR_S3_ACCESS_KEY_ID       (Backblaze keyID)
DR_S3_SECRET_ACCESS_KEY   (Backblaze applicationKey)
DR_S3_REGION              us-west-002   (the region part of your endpoint)
DR_S3_ENDPOINT_URL        https://s3.us-west-002.backblazeb2.com
```
Then go to the **Actions** tab → "DR - PostgreSQL off-site backup" → **Run
workflow** once, and confirm it finishes green before trusting the schedule.

**B. Render (so the live app's own snapshots also go off-site)**
Render service → **Environment**, add:
```
DR_REMOTE_ENABLED             true
DR_REMOTE_REQUIRED_FOR_MUTATIONS   true   (start with false if you want to test first)
DR_S3_BUCKET                  quality-disposition-recovery
DR_S3_ACCESS_KEY_ID           (Backblaze keyID)
DR_S3_SECRET_ACCESS_KEY       (Backblaze applicationKey)
DR_S3_REGION                  us-west-002   (the region part of your endpoint)
DR_S3_ENDPOINT_URL            https://s3.us-west-002.backblazeb2.com
```
Save and let Render redeploy. Then open `/admin` → check that a new backup
shows **remote: verified**, not `disabled`/`failed`.

### Step 3 — Add a second copy of your source code

GitHub can also go down or your account could get blocked/deleted — never let
GitHub be the only copy. Cheapest options, pick one:
- Push the same repo to GitLab or Bitbucket too (`git remote add mirror <url>`,
  `git push mirror main`), or
- Periodically download the repo as a ZIP (GitHub → Code → Download ZIP) and
  store it somewhere else (your computer, a company drive).

### Step 4 — Write down (outside GitHub) how to get back in

In a password manager or a printed sealed note — **never in the repo**:
- Supabase login + project ref
- Render login
- Backblaze login + the B2 application keys
- Domain/DNS registrar login (if you have a custom domain)

This is the "break-glass" record `DISASTER_RECOVERY_ARCHITECTURE.md` §7 calls for.

---

## What actually happens if something is blocked/shut down

### Render blocks/deletes your account
Your data is untouched (it lives in Supabase, plus off-site dumps in Backblaze B2).
Deploy this exact code (Dockerfile included, so it runs on Railway, Fly.io,
a plain VPS, or any Docker host) with the same `DATABASE_URL`. Point DNS at
the new host. Nothing about the app needs to change — it only needs a
working `DATABASE_URL`.

### Supabase blocks/deletes your project
Create a new PostgreSQL database anywhere (Supabase again, Neon, Render
Postgres, RDS, a VPS). Restore the latest **verified** off-site dump:
```bash
DATABASE_URL='NEW_DATABASE_URL' python3 dr_pg_backup.py restore /path/to/postgres-*.dump --yes
```
Point the app's `DATABASE_URL` at the new database. The app auto-creates any
missing schema pieces on startup; the restore brings back your rows exactly.

### GitHub blocks/deletes your account/repo
Use the mirror copy from Step 3, or the downloaded ZIP, as your new source.
Nothing in the app depends on GitHub at runtime — it's only where the code
lives between deploys.

### Everything above happens at once
Rebuild in this order: new PostgreSQL → restore dump → deploy code (from
mirror/ZIP) with `DATABASE_URL` set → new off-site bucket for the next backup
→ DNS to new host. Follow the numbered steps in `DR_RUNBOOK.md`.

---

## Quarterly check (5 minutes)

- Confirm the GitHub Action still runs green.
- Confirm `/admin` still shows `remote: verified` after a backup.
- Once a quarter, actually restore the latest dump into a throwaway database
  and count rows — a backup you have never restored is not a tested backup.
