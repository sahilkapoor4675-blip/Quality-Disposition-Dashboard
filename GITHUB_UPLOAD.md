# GitHub Upload — V27.3.1

Upload the **contents of this folder**, not the ZIP file, into the repository root.

Recommended order:
1. Create/open the repository.
2. Upload all files and folders from this package.
3. Do not upload `__pycache__`, `.env`, or local virtual-environment folders.
4. Commit the files in one commit with a message such as `release: QCR V27.3.1`.
5. In Render, connect the repository/branch and deploy from the repository root.

The bundled `quality.db` is retained so the existing local dataset remains available. Existing application data/filter/query logic has not been intentionally changed in this stabilization package.
