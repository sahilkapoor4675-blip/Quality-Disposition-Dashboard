"""Failure alerts (webhook and/or email) for backups and other background jobs.

Why this exists: a failed backup used to be visible only to someone who happened
to open /admin. This module pushes the failure out to where people already look.

Design rules
------------
* Stdlib only (urllib + smtplib) - no new dependency.
* Never raises into the caller and never blocks it: every send runs on a daemon
  thread with a hard timeout. A broken webhook must not break a backup or an
  admin request.
* Deduplicated. The first failure alerts immediately; while the same problem
  persists it only re-alerts after ALERT_COOLDOWN_MINUTES. When the problem
  clears, ONE "recovered" message is sent. The "open" marker is persisted via
  the state callbacks, so a restart (routine on free hosts) neither re-spams
  nor loses the recovery notice.
* Secrets are redacted from message text before it leaves the process.

Configuration (all optional - with none set, alerts are simply logged)
----------------------------------------------------------------------
  ALERT_WEBHOOK_URL         Slack / Teams / Discord / generic JSON endpoint
  ALERT_EMAIL_TO            comma-separated recipients
  SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM
  SMTP_STARTTLS             "true" (default) | "false"; port 465 uses implicit SSL
  ALERT_COOLDOWN_MINUTES    re-alert interval while still failing (default 360)
  ALERT_APP_LABEL           name shown in the message (default: app name)

Send a test message with:  python3 alerts.py --test
"""
import json
import logging
import os
import smtplib
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage

log = logging.getLogger("qdash.alerts")

_SECRET_ENV_NAMES = (
    "DATABASE_URL", "ADMIN_PASSWORD", "SMTP_PASSWORD", "ALERT_WEBHOOK_URL",
    "DR_S3_SECRET_ACCESS_KEY", "DR_S3_ACCESS_KEY_ID", "DR_ENCRYPTION_KEY",
)

_lock = threading.Lock()
_mem_state = {}
_state_get = None   # callable(key, default) -> str
_state_set = None   # callable(key, value)   -> None


def configure(state_get=None, state_set=None):
    """Optionally persist alert state (e.g. in the app_state table).

    Without this, state lives in memory and is lost on restart.
    """
    global _state_get, _state_set
    _state_get, _state_set = state_get, state_set


# --------------------------------------------------------------------------
# config helpers (read env on every call so tests/ops changes take effect)
# --------------------------------------------------------------------------
def _env(name, default=""):
    return (os.environ.get(name) or default).strip()


def _cooldown_seconds():
    try:
        return max(60.0, float(_env("ALERT_COOLDOWN_MINUTES", "360")) * 60.0)
    except ValueError:
        return 360 * 60.0


def _recipients():
    return [a.strip() for a in _env("ALERT_EMAIL_TO").split(",") if a.strip()]


def webhook_configured():
    url = _env("ALERT_WEBHOOK_URL")
    return url.lower().startswith(("http://", "https://"))


def email_configured():
    return bool(_recipients() and _env("SMTP_HOST"))


def describe():
    """Booleans only - safe to expose in an admin status payload."""
    return {"webhook": webhook_configured(), "email": email_configured(),
            "cooldown_minutes": int(_cooldown_seconds() // 60)}


def _redact(text):
    text = str(text or "")
    for name in _SECRET_ENV_NAMES:
        val = _env(name)
        if len(val) >= 6:
            text = text.replace(val, "***")
    return text


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------
def _get(key):
    if _state_get:
        try:
            return _state_get(key, "")
        except Exception as exc:  # state must never break alerting
            log.warning("alert state read failed: %s", exc)
    return _mem_state.get(key, "")


def _set(key, value):
    _mem_state[key] = value
    if _state_set:
        try:
            _state_set(key, value)
        except Exception as exc:
            log.warning("alert state write failed: %s", exc)


# --------------------------------------------------------------------------
# transports (blocking; always called from a worker thread)
# --------------------------------------------------------------------------
def _send_webhook(subject, body, event, fields):
    url = _env("ALERT_WEBHOOK_URL")
    # "text" is what Slack/Teams read, "content" is what Discord reads; extra
    # keys are ignored by all of them, and generic receivers get the raw fields.
    text = f"{subject}\n{body}"
    payload = {"text": text, "content": text[:1900], "event": event,
               "subject": subject, "message": body, "fields": fields}
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "qdash-alerts/1"},
        method="POST")
    with urllib.request.urlopen(req, timeout=8) as resp:
        resp.read(256)
    return True


def _send_email(subject, body):
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT", "587") or 587)
    user, pw = _env("SMTP_USER"), _env("SMTP_PASSWORD")
    sender = _env("SMTP_FROM") or user or "alerts@localhost"
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, sender, ", ".join(_recipients())
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=15, context=ctx)
    else:
        smtp = smtplib.SMTP(host, port, timeout=15)
    with smtp:
        if port != 465 and _env("SMTP_STARTTLS", "true").lower() not in ("0", "false", "no", "off"):
            smtp.starttls(context=ctx)
        if user:
            smtp.login(user, pw)
        smtp.send_message(msg)
    return True


def _deliver(subject, body, event, fields):
    """Try every configured channel; one failing must not stop the other."""
    results = {}
    if webhook_configured():
        try:
            results["webhook"] = _send_webhook(subject, body, event, fields)
        except Exception as exc:
            results["webhook"] = False
            log.warning("alert webhook failed: %s", _redact(exc))
    if email_configured():
        try:
            results["email"] = _send_email(subject, body)
        except Exception as exc:
            results["email"] = False
            log.warning("alert email failed: %s", _redact(exc))
    if not results:
        log.warning("ALERT (no channel configured): %s | %s", subject, _redact(body))
    return results


def _dispatch(subject, body, event, fields, wait):
    if wait:
        return _deliver(subject, body, event, fields)
    threading.Thread(target=_deliver, args=(subject, body, event, fields),
                     name="qdash-alert", daemon=True).start()
    return {}


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------
def _compose(label, headline, detail, extra):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [_redact(detail)] if detail else []
    for k, v in (extra or {}).items():
        if v not in (None, ""):
            lines.append(f"{k}: {_redact(v)}")
    lines.append(f"time: {now}")
    return f"[{label}] {headline}", "\n".join(lines)


def raise_alert(key, headline, detail="", extra=None, wait=False):
    """Report a failure. Sends now if new, or again after the cooldown.

    Returns True if a message was dispatched, False if suppressed.
    """
    label = _env("ALERT_APP_LABEL", "Quality Disposition Dashboard")
    now = time.time()
    with _lock:
        try:
            last = float(_get(f"alert_open:{key}") or 0)
        except ValueError:
            last = 0.0
        if last and (now - last) < _cooldown_seconds():
            return False
        _set(f"alert_open:{key}", repr(now))
    subject, body = _compose(label, f"ALERT: {headline}", detail, extra)
    _dispatch(subject, body, f"alert.{key}", dict(extra or {}, key=key), wait)
    return True


def resolve_alert(key, headline, detail="", extra=None, wait=False):
    """Report recovery - only if an alert for this key was actually open."""
    label = _env("ALERT_APP_LABEL", "Quality Disposition Dashboard")
    with _lock:
        if not _get(f"alert_open:{key}"):
            return False
        _set(f"alert_open:{key}", "")
    subject, body = _compose(label, f"RECOVERED: {headline}", detail, extra)
    _dispatch(subject, body, f"recovered.{key}", dict(extra or {}, key=key), wait)
    return True


def send_test():
    """Synchronous test through every configured channel (for --test)."""
    subject, body = _compose(_env("ALERT_APP_LABEL", "Quality Disposition Dashboard"),
                             "TEST alert", "If you can read this, alert delivery works.", {})
    return _deliver(subject, body, "test", {})


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if "--test" in sys.argv:
        print("configured:", describe())
        res = send_test()
        print("result:", res or "no channel configured (set ALERT_WEBHOOK_URL and/or ALERT_EMAIL_TO + SMTP_HOST)")
        sys.exit(0 if res and all(res.values()) else 1)
    print(__doc__)
