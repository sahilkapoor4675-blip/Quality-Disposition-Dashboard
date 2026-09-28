# Deployment & Platform Continuity

Merged from `SUPABASE_RENDER_FREE_SETUP.md` (Part 1) and `PLATFORM_CONTINUITY_SETUP.md` (Part 2).

- [Part 1 — Free Supabase + Render setup](#part-1--free-supabase--render-setup)
- [Part 2 — Platform continuity setup](#part-2--platform-continuity-setup-render--supabase--github)

---

# Part 1 — Free Supabase + Render setup

## Goal
Use Render Free for the web server and Supabase Free PostgreSQL for persistent live data. No Render Persistent Disk and no paid plan are required.

## 1) Create Supabase Free project
1. Create a Supabase account/project.
2. Keep the project on the Free plan.
3. Open the project's **Connect** panel.
4. Copy the **Shared Pooler / Session mode** PostgreSQL connection string. This is the preferred option for an IPv4-only backend such as many free hosting environments.
5. Replace the password placeholder with the database password. Keep the connection string private.

## 2) Connect Render
In the existing Render Web Service:
1. Open **Environment**.
2. Add `DATABASE_URL` = the Supabase pooler/session connection string.
3. Add `ADMIN_USERNAME` = your admin username.
4. Add `ADMIN_PASSWORD` = a strong private password. Do not use `ChangeMe@123`.
5. Add `DB_LIMIT_MB` = `500`.
6. Save changes and let Render redeploy.

## 3) First deployment / migration
The WebApp automatically creates the PostgreSQL `disposition` table. If the PostgreSQL database is empty, it seeds the bundled `quality.db` data once. If PostgreSQL already contains records, it does NOT overwrite them.

So the first successful startup should result in approximately the same initial record count as the bundled dashboard database.

## 4) Verify
Open `/admin` on the deployed dashboard.
- Login as Admin.
- Check Database Status: provider should say `PostgreSQL • persistent`. If it still
  says `SQLite • local`, `DATABASE_URL` is not being picked up (recheck step 2) —
  in that state, ALL admin-added data (disposition records, the 6M Fishbone
  master, KPI targets, users) resets on every Render restart/redeploy, which is
  the most common cause of "I have to re-upload the 6M Fishbone master every time".
- Check Total Records.
- Import a small test file if desired.
- Return to the dashboard and confirm the KPI data updates.

## 5) Future code updates
GitHub remains the code source. Push dashboard changes to GitHub -> Render auto-deploys -> Supabase PostgreSQL remains untouched. Admin-added records remain in Supabase.

## 6) Future data updates
Do NOT upload monthly data to GitHub. Instead:
Admin -> Bulk Import -> Excel/TSV/CSV -> Import.
The records are written directly to Supabase PostgreSQL and become available to the dashboard.

This also applies to the 6M Fishbone master (Admin -> 6M Fishbone Master Import): it
is a ONE-TIME, independent import. Once `DATABASE_URL` is set, it is written to the
same Supabase PostgreSQL database and stays there — uploading new monthly
disposition/QCR data afterwards does NOT clear it, and it does NOT need to be
re-uploaded on future code deploys.

## 7) Free-plan database safety
Supabase Free currently provides 500 MB database size per project and may pause projects after about 7 days of low activity. Monitor Database Status in Admin. Keep regular CSV backups using the **Download Backup** button because automatic backups are not included on the Free plan.

## 8) Backup recommendation
After every significant monthly import, use **Download Backup** and save the CSV outside the server (for example on your company computer/Drive). This is a manual backup and does not require a paid plan.

## 9) Important security rules
- Never commit `DATABASE_URL` to GitHub.
- Never commit the real admin password.
- Set both as Render Environment Variables.
- Only Admin endpoints can write/delete/export data.
- Viewer dashboard endpoints are read-only.


### Viewer login & activity monitoring
Viewer login is currently disabled. The main dashboard is open to all visitors without username/password. Every dashboard page visit and dashboard action is recorded with the visitor IP address, timestamp, event, tab and browser/user-agent. Admin can review **Dashboard Activity** to see unique IPs, opens, last seen time, browser/device information and recent activity. Named viewer login can be enabled in a future version if required. Admin/data-management APIs remain protected by Admin login.

For the first deployment, the environment-backed `ADMIN_USERNAME` / `ADMIN_PASSWORD` account is automatically created as the administrator. Log in to `/admin`, create viewer accounts, then share those credentials with authorized viewers.

### Current viewer access mode
The main dashboard currently does **not** require viewer username/password. Visitors can open and use the dashboard directly. For administrative monitoring, the server stores the visitor IP address, timestamp, event type, tab, and browser/user-agent in `activity_log`. The Admin Control Center can review this activity. Named viewer accounts/login can be enabled later without changing the underlying PostgreSQL architecture.


---

# Part 2 — Platform continuity setup (Render + Supabase + GitHub)

This file is written for the exact stack described in Part 1 of this file:
**Render (free web host) + Supabase (free PostgreSQL) + GitHub (source code)**.
It tells you exactly what is now automated, and exactly which few steps only
you can do (they require logging into your own accounts — nothing outside
this chat can do that for you).

Read [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) for the full design (Part 3) and
step-by-step recovery commands (Part 1). This file is the short,
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
retention but costs egress fees; see [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) Part 3 §6.
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

### Step 2B — Encrypt the off-site backup (optional, recommended)

By default the dump uploaded to Backblaze is readable as-is by anyone who
gets into that bucket. Adding one more secret makes `dr_pg_backup.py`
encrypt the dump *before* it leaves the runner, so the bucket only ever
holds ciphertext.

1. Generate a key (run this once, anywhere with Python + `pip install
   cryptography`):
   ```
   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
2. Add it as **one more GitHub secret** (and Render env var, if you also want
   Render's own snapshot path encrypted the same way):
   ```
   DR_ENCRYPTION_KEY   (the key printed above)
   ```
3. Save this key **outside GitHub/Render too** (password manager, same place
   as your break-glass note in Step 4) — if you lose it, the encrypted
   backups become unrecoverable, by design.
4. Nothing else changes. Once this secret exists, every future scheduled
   backup uploads as `<key>.enc` instead of `<key>`; without it, uploads
   continue exactly as before.

**To restore an encrypted backup later:** download the `.enc` file from
Backblaze, then run:
```
python3 dr_pg_backup.py decrypt path/to/file.dump.enc --output path/to/file.dump
```
(with `DR_ENCRYPTION_KEY` set in that shell), then `verify`/`restore` the
resulting plaintext dump exactly as documented in [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) Part 1.

### Step 2C — Get told when a backup fails (optional, recommended)

Without this, a failed backup is only visible if you open `/admin`. Add either
or both of these in Render (Environment tab):

```
ALERT_WEBHOOK_URL   https://hooks.slack.com/services/...   (Slack / Teams / Discord / any JSON endpoint)
ALERT_EMAIL_TO      you@example.com
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM  (only for email)
```
You get one message when a backup (local or off-site) starts failing, a reminder
every `ALERT_COOLDOWN_MINUTES` (default 6 h) while it keeps failing, and one
"RECOVERED" message when it works again. To also cover the GitHub Actions dump
job, add the same webhook URL as a repository secret named `ALERT_WEBHOOK_URL`.
Send a test with `python3 alerts.py --test` (run it where the env vars are set).
Some free hosts block outbound SMTP; if email never arrives, use the webhook.

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

This is the "break-glass" record [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) Part 3 §7 calls for.

---

## What actually happens if something is blocked/shut down

### Render blocks/deletes your account
Your data is untouched (it lives in Supabase, plus off-site dumps in Backblaze B2).
Deploy this exact code (`Procfile` + `requirements.txt` + `runtime.txt` are included, so it runs on
Railway, Fly.io, a plain VPS, or any Python host) with the same `DATABASE_URL`. Point DNS at
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
→ DNS to new host. Follow the numbered steps in [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) Part 1.

---

## Quarterly check (5 minutes)

- Confirm the GitHub Action still runs green.
- Confirm `/admin` still shows `remote: verified` after a backup.
- Once a quarter, actually restore the latest dump into a throwaway database
  and count rows — a backup you have never restored is not a tested backup.

