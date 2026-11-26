# Putting the dashboard on a Linux server (safely, next to other projects)

The app touches nothing outside its own folder:
- **Node.js**: a private copy of Node 22 inside the app folder (`.node/`). The server's own `node`, and every other project, stay as they are.
- **Database**: one SQLite file in `data/` of this folder. No MySQL / PostgreSQL / MongoDB server is used or changed.
- **Port**: one free port chosen after checking what is in use. The app listens on `127.0.0.1` only (`HOST=127.0.0.1`), so it is reachable only through the web server.
- **Web server**: a NEW nginx site file for this app only. `nginx -t` is run before the reload, and a reload keeps the other sites running.
- **Process**: its own PM2 name (`audit-dashboard`) or its own systemd service. Other apps are never restarted.

## Settings (environment variables)
| Variable | Value on the server | Why |
|---|---|---|
| `PORT` | a free port, e.g. 3100 | the port the app listens on |
| `HOST` | `127.0.0.1` | only nginx can reach it |
| `TRUST_PROXY` | `1` | real visitor address from nginx (login lock-out per visitor) |
| `COOKIE_SECURE` | `1` once HTTPS works | sign-in cookie only over HTTPS |
| `SMTP_*` (optional) | see `server/src/services/mailer.js` | email settings without the Settings page |

## Steps (summary)
1. Check what is already used (ports, nginx sites, PM2 / systemd / Docker apps, databases) – read-only.
2. `git clone` this repository into its own folder.
3. Download Node 22 into `.node/` inside that folder; `npm ci`; `npm run build`.
4. Copy the `data/` folder (database + uploaded originals) from the old PC, or start empty (the first visit creates the Admin).
5. Start it with PM2 (or systemd) under its own name with the variables above.
6. Add an nginx site file for the domain, `nginx -t`, reload; then `certbot --nginx -d <domain>` for HTTPS and set `COOKIE_SECURE=1`.

## Database: PostgreSQL (since 26 Nov 2026)
The app works with SQLite (default) or PostgreSQL. The choice is read from a `.env` file in the project folder (never in git):
- **Server** (`.env`, chmod 600): `DB_CLIENT=postgres` and `DATABASE_URL=postgres://audit_dashboard:<password>@127.0.0.1:5433/audit_dashboard`
  - its own role and database `audit_dashboard` on the server's PostgreSQL 16 (port 5433); no other database is touched.
- **This PC** (no PostgreSQL server can be installed): `DB_CLIENT=postgres` and `PGLITE_DIR=data/pg` - real PostgreSQL running inside the app (PGlite), saved in `data/pg`.
- Copy existing data once: `node server/tools/sqlite-to-postgres.mjs data/audit.db` (trial run) then `... --yes` (only into an empty database; the SQLite file is only read).
- Back to SQLite: rename `.env` and restart the app (data entered in PostgreSQL stays there).
- Backup (server): `pg_dump` of the `audit_dashboard` database.

## Updating later
`git pull`, `npm ci`, `npm run build`, then restart only this app (`pm2 restart audit-dashboard`). The `data/` folder is never in git.
Back up `data/` before every update: `sqlite3` is not needed – copy the folder while the app is stopped, or use the backup command in this file's history.
