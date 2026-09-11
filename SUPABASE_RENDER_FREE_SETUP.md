# Quality Dashboard — FREE Supabase + FREE Render setup

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
