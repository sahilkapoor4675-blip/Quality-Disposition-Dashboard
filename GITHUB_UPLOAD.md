# GitHub Upload

Upload the **contents of this folder** (not the ZIP file) into the repository root.

1. Create/open the repository.
2. Upload the files and folders from this package. When you only changed a few files, upload just those
   files (GitHub replaces files with the same name).
3. Do not upload `__pycache__`, `.env`, or local virtual-environment folders.
4. Commit with a message such as `release: <version from VERSION.txt>`.
5. In Render, connect the repository/branch and deploy from the repository root.

The bundled `quality.db` is only the first-run seed for local/SQLite use. Production data lives in the
external PostgreSQL database (`DATABASE_URL`) and is never overwritten by a code upload.
