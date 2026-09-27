#!/usr/bin/env python3
"""Portable PostgreSQL logical backup/restore helper for Quality Dashboard DR.

This tool is intended for an independent backup runner (local machine, VPS,
CI/CD runner, or another scheduler), not for the web request path.

Commands:
  dump     Create a PostgreSQL custom-format backup + manifest.
  verify   Verify the dump is readable and the manifest hash matches.
  restore  Restore a verified dump into a target PostgreSQL database.
  decrypt  Decrypt a dump previously encrypted for off-site upload.

Security:
  * DATABASE_URL is never printed.
  * Connection credentials are passed to PostgreSQL through PG* environment
    variables rather than the process command line.
  * Runtime session/login-throttle tables are excluded from DATA but kept in
    the schema so the application can recreate them.
  * Restores are destructive; require --yes and run with the app write path
    frozen/offline.
  * Off-site encryption (optional): if DR_ENCRYPTION_KEY is set, the dump is
    encrypted (Fernet/AES128-CBC+HMAC via the `cryptography` package) before
    it leaves this machine, so the off-site bucket only ever holds ciphertext
    even if that bucket/provider is later compromised. The uploaded object
    key gets a ".enc" suffix. Manifests are left in plaintext (metadata only,
    no row data) so a restore operator can inspect them without the key.
    This is opt-in and backward compatible: with no DR_ENCRYPTION_KEY set,
    dumps upload exactly as before.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse

RUNTIME_TABLES = ("public.sessions", "public.login_attempts")

def _get_fernet():
    """Build a Fernet cipher from DR_ENCRYPTION_KEY, or return None if unset.

    DR_ENCRYPTION_KEY must be a 32-byte urlsafe-base64 key, e.g. generated
    with: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """
    key = os.environ.get("DR_ENCRYPTION_KEY")
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise SystemExit(
            "DR_ENCRYPTION_KEY is set but the 'cryptography' package is not "
            "installed in this environment (pip install cryptography)"
        ) from exc
    try:
        return Fernet(key.encode("ascii"))
    except Exception as exc:  # invalid key format/length
        raise SystemExit(f"DR_ENCRYPTION_KEY is not a valid Fernet key: {exc}") from exc


def _encrypt_file(path: Path) -> Path:
    """Encrypt path in place-adjacent, returning the new .enc file path."""
    fernet = _get_fernet()
    assert fernet is not None
    enc_path = path.with_suffix(path.suffix + ".enc")
    with open(path, "rb") as f:
        plaintext = f.read()
    ciphertext = fernet.encrypt(plaintext)
    enc_path.write_bytes(ciphertext)
    return enc_path


def _decrypt_bytes(ciphertext: bytes) -> bytes:
    fernet = _get_fernet()
    if fernet is None:
        raise SystemExit("Set DR_ENCRYPTION_KEY to decrypt this file")
    from cryptography.fernet import InvalidToken
    try:
        return fernet.decrypt(ciphertext)
    except InvalidToken as exc:
        raise SystemExit("Decryption failed: wrong DR_ENCRYPTION_KEY or corrupted file") from exc


APP_FILES = (
    # Application/server code
    "server.py", "reports.py", "session_store.py", "logging_setup.py",
    "dr_storage.py", "dr_recovery.py", "dr_pg_backup.py",
    # Frontend runtime (must match server.py exactly for "same webapp" restores)
    "app.js", "app.css", "sfx.js", "admin.html", "index.html",
    "site.webmanifest",
    # Deployment/runtime configuration
    "requirements.txt", "runtime.txt", "Procfile", "render.yaml",
    "Dockerfile", "VERSION.txt", "supabase_schema.sql",
)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"Required PostgreSQL tool not found on PATH: {name}")
    return path


def _db_env(database_url: str) -> dict[str, str]:
    """Convert a PostgreSQL URL to PG* env vars without leaking the URL."""
    parsed = urlparse(database_url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("postgres", "postgresql"):
        raise SystemExit("DATABASE_URL must use postgres:// or postgresql://")
    if not parsed.hostname:
        raise SystemExit("DATABASE_URL has no host")
    env = os.environ.copy()
    env.update({
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGUSER": unquote(parsed.username or ""),
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGDATABASE": (parsed.path or "/postgres").lstrip("/") or "postgres",
        "PGSSLMODE": (dict(parse_qsl(parsed.query, keep_blank_values=True)).get("sslmode") or os.environ.get("PGSSLMODE") or "require"),
    })
    return env


def _app_manifest(root: Path) -> dict:
    files = {}
    for name in APP_FILES:
        path = root / name
        if path.is_file():
            files[name] = _sha256(path)
    commit = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or os.environ.get("COMMIT_SHA") or ""
    if not commit:
        try:
            commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True,
                stderr=subprocess.DEVNULL, timeout=2,
            ).strip()
        except Exception:
            commit = ""
    version = os.environ.get("APP_VERSION", "")
    vf = root / "VERSION.txt"
    if not version and vf.is_file():
        for line in vf.read_text(encoding="utf-8").splitlines():
            if line.startswith("APP_VERSION="):
                version = line.split("=", 1)[1].strip()
                break
    return {
        "app_version": version,
        "git_commit": commit,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "files_sha256": files,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def dump(database_url: str, output: Path, root: Path) -> int:
    pg_dump = _require_tool("pg_dump")
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise SystemExit(f"Refusing to overwrite existing backup: {output}")
    env = _db_env(database_url)
    cmd = [
        pg_dump,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--verbose",
        "--file", str(output),
    ]
    for table in RUNTIME_TABLES:
        cmd.extend(["--exclude-table-data", table])
    try:
        subprocess.run(cmd, env=env, check=True)
    except subprocess.CalledProcessError as exc:
        try:
            output.unlink(missing_ok=True)
        except Exception:
            pass
        raise SystemExit(f"pg_dump failed with exit code {exc.returncode}") from exc
    digest = _sha256(output)
    manifest = {
        "format": "postgresql_custom",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dump_file": output.name,
        "dump_sha256": digest,
        "dump_size_bytes": output.stat().st_size,
        "excluded_runtime_data": list(RUNTIME_TABLES),
        "app_manifest": _app_manifest(root),
        "source_database_url_present": bool(database_url),
        "encrypted": bool(os.environ.get("DR_ENCRYPTION_KEY")),
    }
    manifest_path = output.with_suffix(output.suffix + ".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"BACKUP OK: {output}")
    print(f"SHA256: {digest}")
    print(f"MANIFEST: {manifest_path}")
    return 0


def _remote_upload(path: Path, object_key: str, app_version: str) -> None:
    # Reuse the app's small S3-compatible client without importing server.py.
    try:
        from dr_storage import upload_file, verify_uploaded_file
    except ImportError as exc:
        raise SystemExit("Off-site upload requires dr_storage.py and boto3 in the runner environment") from exc
    digest = _sha256(path)
    upload_file(str(path), object_key, sha256=digest, app_version=app_version, content_type="application/octet-stream")
    if not verify_uploaded_file(str(path), object_key, expected_sha256=digest):
        raise SystemExit(f"Remote backup verification failed: {object_key}")


def _remote_upload_dump(dump_path: Path, object_key: str, app_version: str) -> str:
    """Upload the dump off-site, encrypting first if DR_ENCRYPTION_KEY is set.

    Returns the object key actually used remotely (unchanged, or with a
    ".enc" suffix when encryption was applied) so the caller can report it.
    """
    if os.environ.get("DR_ENCRYPTION_KEY"):
        enc_path = _encrypt_file(dump_path)
        try:
            remote_key = object_key + ".enc"
            _remote_upload(enc_path, remote_key, app_version)
            return remote_key
        finally:
            enc_path.unlink(missing_ok=True)  # never leave ciphertext copy on the runner disk
    _remote_upload(dump_path, object_key, app_version)
    return object_key


def verify(dump_path: Path, manifest_path: Path | None) -> int:
    pg_restore = _require_tool("pg_restore")
    if not dump_path.is_file():
        raise SystemExit(f"Dump not found: {dump_path}")
    actual = _sha256(dump_path)
    if manifest_path is None:
        candidate = dump_path.with_suffix(dump_path.suffix + ".manifest.json")
        manifest_path = candidate if candidate.is_file() else None
    if manifest_path:
        obj = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected = str(obj.get("dump_sha256") or "")
        if expected != actual:
            raise SystemExit(f"SHA256 mismatch: manifest={expected} actual={actual}")
    with tempfile.NamedTemporaryFile(prefix="qdash_pg_restore_list_", suffix=".txt", delete=False) as tf:
        listing = Path(tf.name)
    try:
        with listing.open("w", encoding="utf-8") as out:
            subprocess.run(
                [pg_restore, "--list", str(dump_path)],
                check=True,
                stdout=out,
                stderr=subprocess.PIPE,
                text=True,
            )
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"pg_restore --list failed: {exc.stderr.strip()}") from exc
    finally:
        listing.unlink(missing_ok=True)
    print(f"VERIFY OK: {dump_path}")
    print(f"SHA256: {actual}")
    return 0


def restore(database_url: str, dump_path: Path, yes: bool) -> int:
    if not yes:
        raise SystemExit("Refusing destructive restore without --yes")
    pg_restore = _require_tool("pg_restore")
    if not dump_path.is_file():
        raise SystemExit(f"Dump not found: {dump_path}")
    verify(dump_path, None)
    env = _db_env(database_url)
    cmd = [
        pg_restore,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--single-transaction",
        "--dbname", "postgresql://placeholder",  # overridden below via PG* env only
    ]
    # pg_restore requires a dbname argument for some versions. Supplying it as
    # a socket-level keyword would still expose the secret if we used the full
    # DATABASE_URL. Use the database name from PGDATABASE and let libpq take the
    # remaining connection details from PG*.
    cmd[-1] = env["PGDATABASE"]
    try:
        subprocess.run(cmd + [str(dump_path)], env=env, check=True)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"pg_restore failed with exit code {exc.returncode}") from exc
    print("RESTORE OK")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Quality Dashboard PostgreSQL DR backup utility")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_dump = sub.add_parser("dump")
    p_dump.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="PostgreSQL URL; prefer env DATABASE_URL")
    p_dump.add_argument("--output", required=True, help="Output .dump path")
    p_dump.add_argument("--app-root", default=str(Path(__file__).resolve().parent))
    p_dump.add_argument("--remote-key", help="Optional S3 key to upload the verified dump after creation")
    p_dump.add_argument("--remote-manifest-key", help="Optional S3 key for the manifest; defaults to <remote-key>.manifest.json")
    p_verify = sub.add_parser("verify")
    p_verify.add_argument("dump")
    p_verify.add_argument("--manifest")
    p_restore = sub.add_parser("restore")
    p_restore.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="Target PostgreSQL URL; prefer env DATABASE_URL")
    p_restore.add_argument("dump")
    p_restore.add_argument("--yes", action="store_true")
    p_decrypt = sub.add_parser("decrypt", help="Decrypt a .enc dump downloaded from off-site storage")
    p_decrypt.add_argument("encrypted", help="Path to the downloaded .enc file")
    p_decrypt.add_argument("--output", required=True, help="Path to write the decrypted dump to")
    args = ap.parse_args()

    if args.cmd == "dump":
        if not args.database_url:
            raise SystemExit("Set DATABASE_URL or pass --database-url")
        output = Path(args.output).resolve()
        result = dump(args.database_url, output, Path(args.app_root).resolve())
        if args.remote_key:
            manifest_path = output.with_suffix(output.suffix + ".manifest.json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            app_version = str((manifest.get("app_manifest") or {}).get("app_version") or "")
            used_key = _remote_upload_dump(output, args.remote_key, app_version)
            remote_manifest_key = args.remote_manifest_key or (args.remote_key + ".manifest.json")
            _remote_upload(manifest_path, remote_manifest_key, app_version)
            print(f"REMOTE VERIFY OK: {used_key}")
            print(f"REMOTE MANIFEST VERIFY OK: {remote_manifest_key}")
        return result
    if args.cmd == "verify":
        return verify(Path(args.dump).resolve(), Path(args.manifest).resolve() if args.manifest else None)
    if args.cmd == "restore":
        if not args.database_url:
            raise SystemExit("Set DATABASE_URL or pass --database-url")
        return restore(args.database_url, Path(args.dump).resolve(), args.yes)
    if args.cmd == "decrypt":
        enc_path = Path(args.encrypted).resolve()
        if not enc_path.is_file():
            raise SystemExit(f"Encrypted file not found: {enc_path}")
        plaintext = _decrypt_bytes(enc_path.read_bytes())
        out_path = Path(args.output).resolve()
        out_path.write_bytes(plaintext)
        print(f"DECRYPT OK: {out_path}")
        print(f"SHA256: {_sha256(out_path)}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
