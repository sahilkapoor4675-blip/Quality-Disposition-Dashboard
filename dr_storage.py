"""Optional S3-compatible off-site storage for disaster-recovery snapshots.

The module is deliberately small and lazy: the app remains fully functional
with only local recovery points until DR_REMOTE_ENABLED/DR_S3_BUCKET is set.
Credentials are read only from environment variables and never logged.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional


def _truthy(value: str) -> bool:
    return str(value or "").lower() in ("1", "true", "yes", "on")


def is_remote_configured() -> bool:
    return _truthy(os.environ.get("DR_REMOTE_ENABLED", "false")) and bool(os.environ.get("DR_S3_BUCKET", "").strip())


def _client():
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError("Off-site backup requires boto3; install requirements.txt") from exc
    bucket = os.environ.get("DR_S3_BUCKET", "").strip()
    access_key = os.environ.get("DR_S3_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("DR_S3_SECRET_ACCESS_KEY", "").strip()
    region = os.environ.get("DR_S3_REGION", "us-east-1").strip() or "us-east-1"
    endpoint = os.environ.get("DR_S3_ENDPOINT_URL", "").strip() or None
    if not bucket or not access_key or not secret_key:
        raise RuntimeError("Off-site backup requires DR_S3_BUCKET, DR_S3_ACCESS_KEY_ID and DR_S3_SECRET_ACCESS_KEY")
    client = boto3.client(
        "s3",
        region_name=region,
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    return client, bucket


def upload_file(
    local_path: str,
    object_key: str,
    sha256: Optional[str] = None,
    app_version: str = "",
    content_type: str = "application/gzip",
) -> None:
    client, bucket = _client()
    metadata = {"app-version": str(app_version or ""), "backup-sha256": str(sha256 or "")}
    extra = {"Metadata": metadata, "ContentType": content_type, "CacheControl": "no-store"}
    sse = os.environ.get("DR_S3_SSE", "").strip()
    if sse:
        extra["ServerSideEncryption"] = sse

    # Optional WORM retention. This is intentionally opt-in because the
    # destination bucket must have Object Lock enabled and not every
    # S3-compatible provider implements it. When configured, failure to
    # apply the requested retention causes the upload to fail closed.
    try:
        lock_days = int(os.environ.get("DR_S3_OBJECT_LOCK_DAYS", "0") or "0")
    except ValueError as exc:
        raise RuntimeError("DR_S3_OBJECT_LOCK_DAYS must be an integer >= 0") from exc
    if lock_days < 0:
        raise RuntimeError("DR_S3_OBJECT_LOCK_DAYS must be >= 0")
    if lock_days:
        mode = str(os.environ.get("DR_S3_OBJECT_LOCK_MODE", "COMPLIANCE")).upper().strip()
        if mode not in {"GOVERNANCE", "COMPLIANCE"}:
            raise RuntimeError("DR_S3_OBJECT_LOCK_MODE must be GOVERNANCE or COMPLIANCE")
        extra["ObjectLockMode"] = mode
        extra["ObjectLockRetainUntilDate"] = datetime.now(timezone.utc) + timedelta(days=lock_days)

    client.upload_file(local_path, bucket, object_key, ExtraArgs=extra)


def verify_uploaded_file(local_path: str, object_key: str, expected_sha256: Optional[str] = None) -> bool:
    client, bucket = _client()
    head = client.head_object(Bucket=bucket, Key=object_key)
    local_size = os.path.getsize(local_path)
    if int(head.get("ContentLength", -1)) != int(local_size):
        return False
    if expected_sha256:
        remote_sha = str((head.get("Metadata") or {}).get("backup-sha256") or "")
        if not remote_sha or remote_sha.lower() != str(expected_sha256).lower():
            return False
    return True
