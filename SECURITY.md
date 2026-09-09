# Security Baseline — V27.2

- Production administrator credentials must be supplied through `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables.
- No known/default administrator password is embedded in application source.
- Existing database users are preserved; startup does not reset or overwrite the user table.
- The dashboard remains public by design in this release. Admin operations remain authenticated.
- PostgreSQL is recommended for persistent production deployment; bundled SQLite is for local/development use.
- Do not commit `.env`, database credentials, exported production data, or generated backups to Git.
