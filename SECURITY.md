# Security Baseline

_Last reviewed: 2026-09-13_

## Data persistence & backups
- The live database defaults to a folder **outside** the `qcr_app` app folder
  (a sibling `qcr_app_persistent_data/` directory next to it), so replacing or
  redeploying the app's code files never touches it. See `server.py`'s
  `_pick_persistent_dir()`.
- A full snapshot (disposition data + 6M Fishbone Master + aliases + KPI
  targets) is saved automatically after every import, and on-demand from
  Admin → Backups. Snapshots are gzip-compressed JSON, kept in
  `<persistent dir>/backups/`, auto-pruned to the last 20.
- **Platform caveat**: none of the above survives a host that wipes the
  *entire* filesystem/container on every deploy (e.g. Render's free plan with
  no persistent disk attached). In that case only an external database
  (`DATABASE_URL` — free via Supabase/Neon Postgres) is fully redeploy-proof.
  See `SUPABASE_RENDER_FREE_SETUP.md`.
- Regularly download a backup from Admin → Backups to your own machine — a
  local file on the server, however durable, is not a substitute for an
  off-server copy.

## Authentication & sessions
- Passwords are hashed with PBKDF2-HMAC-SHA256, 180,000 iterations, random
  16-byte salt per user (`_hash_password`). Verification uses
  `hmac.compare_digest` (timing-safe).
- New/changed passwords must be 12+ characters with upper, lower, digit and
  symbol (`_strong_password`), enforced server-side on user creation and
  password change.
- Session tokens and CSRF tokens are generated with `secrets.token_urlsafe(32)`
  (cryptographically random). Sessions expire after 8h (admin) / 12h (viewer).
- Session cookies are `HttpOnly`, `SameSite=Strict`/`Lax`, and `Secure` when
  the request arrives over HTTPS (`X-Forwarded-Proto`).
- Login is rate-limited: 5 failed attempts per IP per 15-minute window
  (`_login_allowed`), independent of which username was tried.
- No default/hardcoded administrator password ships in source. Production
  credentials come from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars or the
  `users` table.

## Request handling
- Every admin-mutating endpoint (`POST /api/admin/*`, except `/login`)
  requires both a valid session **and** a matching CSRF token
  (`_admin_post_allowed`).
- All SQL is parameterized (`?` placeholders) for every user-supplied value;
  the only f-string-built SQL fragments are column/table names drawn from
  fixed, hardcoded lists — never from request input.
- A global 30 MB cap on incoming request bodies (`MAX_REQUEST_BYTES`) is
  enforced at the very top of every `POST`, before any handler — including
  unauthenticated ones like `/api/login` — reads the body. Prevents a simple
  memory-exhaustion DoS via an oversized `Content-Length`.
- Uploaded `.xlsx`/`.xlsm` files are pre-screened for decompression-bomb
  patterns (`_reject_zip_bomb`): implausible compression ratio or a huge
  declared uncompressed size is rejected before the workbook is ever opened.
- Backup download/restore-by-name endpoints resolve filenames with
  `os.path.basename` and a strict `backup_*.json.gz` pattern check, preventing
  path traversal.
- A 30s socket timeout is set on every connection to limit slow-client
  (slowloris-style) resource exhaustion.

## Response headers
Every JSON/HTML response includes: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera/mic/geolocation disabled), and a
`Content-Security-Policy` restricting script/style/font/connect sources to
this app and the Google Fonts CDN it uses, blocking framing and third-party
base URIs. `Strict-Transport-Security` is added when served over HTTPS.

`Content-Security-Policy` currently allows `'unsafe-inline'` for scripts and
styles because the admin UI's logic lives in an inline `<script>` block and
the app injects inline `style="…"` attributes at runtime. This still blocks
an XSS payload from loading an external attacker script, exfiltrating data
to a third-party endpoint, or framing the app on another site — it is not a
substitute for output escaping, which is applied separately (see below).

## Output escaping
- All dynamic values rendered into HTML client-side go through an escaping
  helper (`escQcr` in `app.js`, `esc` in `admin.html`) that encodes
  `& < > " '`.

## Known residual risks (accepted for now)
- Error responses return `str(exception)`, which occasionally includes
  incidental details (e.g. a file path) rather than a fully generic message.
  Low severity; improves debuggability.
- `Content-Security-Policy` uses `'unsafe-inline'` (see above) rather than a
  nonce-based policy, which would require templating changes to both HTML
  shells.
- Sessions are held in memory (`SESSIONS` dict); restarting the process signs
  everyone out. Not a security issue, but a UX one worth knowing about.

## Do not commit
`.env`, database credentials, exported production data, or generated
backups. See `.gitignore`.
