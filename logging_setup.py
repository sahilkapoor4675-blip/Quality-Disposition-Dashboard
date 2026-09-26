"""
Structured, rotating application logging.

Why this exists: the app previously only used bare `print(...)` for every
startup/warning/export-failure message. That's fine for a single dev tailing
a terminal, but on a real deployment (Render, etc.) it means: no log levels,
no timestamps, nothing persisted once the platform's own log buffer scrolls
away or the dyno restarts, and no way for an admin to see "what went wrong
last night" without already having a log aggregator wired up.

This module gives the app a normal `logging` setup instead:
  - Every line goes to stdout/stderr as before (so `render logs` / `docker
    logs` keep working exactly like before — nothing about existing
    deployment behavior changes).
  - Every line is ALSO written as one JSON object per line to a rotating
    file under the same persistent data directory the database and backups
    already use, so it survives redeploys and can be inspected later even
    without an external log service. Rotation keeps this bounded (a few MB
    x a handful of backups) so it can never fill the disk.
  - The JSON shape (timestamp, level, logger, message, plus any extra
    fields passed via `logger.info(msg, extra={...})`) is what makes it
    "structured" -- an admin (or a future log shipper) can grep/parse it
    reliably instead of scraping free-text.

Multi-instance note: file-based rotation is inherently per-process/per-disk.
On a horizontally-scaled deployment (multiple app instances), each instance
writes its own log file; there is no cross-instance log merge here. That's
an intentional, documented limitation -- wiring every instance to a shared
log sink (e.g. Papertrail/Datadog/CloudWatch) is a platform-level choice,
not something this in-app file can solve. The admin `/api/admin/system_log`
endpoint therefore always reflects "this process only", which is stated
explicitly in its response.
"""
import json
import logging
import logging.handlers
import os
import sys
import threading

_LOCK = threading.Lock()
_CONFIGURED = False
LOG_FILE_PATH = None


class _JsonFormatter(logging.Formatter):
    """Renders one JSON object per line. Kept dependency-free (no third-party
    JSON logging library) since the rest of this project deliberately avoids
    extra runtime dependencies beyond what's already pinned in requirements.txt."""

    def format(self, record):
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "pid": record.process,
            "thread": record.threadName,
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        # Anything passed via logging.info("...", extra={"request_id": ...})
        # lands as a normal record attribute; surface any non-standard ones.
        standard = logging.LogRecord(
            "", 0, "", 0, "", None, None
        ).__dict__.keys()
        for key, value in record.__dict__.items():
            if key not in standard and key not in payload and key not in ("message", "asctime"):
                try:
                    json.dumps(value)
                    payload[key] = value
                except TypeError:
                    payload[key] = str(value)
        return json.dumps(payload, default=str)


class _ConsoleFormatter(logging.Formatter):
    def __init__(self):
        super().__init__("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S")


def configure_logging(persistent_dir, level=None):
    """Idempotent: safe to call more than once (e.g. from tests). Returns the
    app's root logger ("qdash"). `persistent_dir` should be the same folder
    the database/backups already live in, so log rotation follows the same
    "survives redeploy, lives outside the bundled app folder" contract."""
    global _CONFIGURED, LOG_FILE_PATH
    logger = logging.getLogger("qdash")
    with _LOCK:
        if _CONFIGURED:
            return logger
        level_name = (level or os.environ.get("LOG_LEVEL") or "INFO").upper()
        logger.setLevel(getattr(logging, level_name, logging.INFO))
        logger.propagate = False

        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(_ConsoleFormatter())
        logger.addHandler(console)

        try:
            log_dir = os.path.join(persistent_dir, "logs")
            os.makedirs(log_dir, exist_ok=True)
            LOG_FILE_PATH = os.path.join(log_dir, "app.log")
            # 5 MB x 5 backups = 25 MB ceiling per process. Generous enough to
            # cover a busy day's worth of warnings/errors without ever being
            # able to fill a disk unattended.
            file_handler = logging.handlers.RotatingFileHandler(
                LOG_FILE_PATH, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
            )
            file_handler.setFormatter(_JsonFormatter())
            logger.addHandler(file_handler)
        except Exception as e:
            # A read-only filesystem or missing permissions should never take
            # the whole app down -- fall back to console-only logging and say
            # so once, loudly, via the console handler that's already attached.
            logger.warning(f"Rotating file log disabled (could not open log directory): {e}")
            LOG_FILE_PATH = None

        _CONFIGURED = True
    return logger


def get_logger(name=None):
    base = logging.getLogger("qdash")
    return base.getChild(name) if name else base


def tail_log_file(max_lines=200):
    """Return up to `max_lines` most recent parsed JSON log entries from the
    current process's rotating log file (oldest first). Used by the admin
    system-log panel. Returns an empty list if file logging is unavailable
    (e.g. read-only filesystem) rather than raising."""
    if not LOG_FILE_PATH or not os.path.exists(LOG_FILE_PATH):
        return []
    try:
        with open(LOG_FILE_PATH, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[-max_lines:]
    except Exception:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            out.append({"ts": "", "level": "INFO", "logger": "qdash", "message": line})
    return out
