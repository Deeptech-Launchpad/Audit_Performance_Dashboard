# Audit Performance & Team Error Monitoring Platform

A web application for the Product Team and Audit Team: upload the daily audit files, check them, and see who is performing well,
what the common errors are, what is still pending and whether the team improved this week. Weekly Excel/PDF reports are created automatically.

* **Frontend:** React + Recharts (Vite) · **Backend:** Node.js + Express · **Database:** SQL (SQLite now, PostgreSQL schema included)
* **Files:** `.ods`, `.xlsx`, `.xls` (SheetJS) · **PDF:** PDFKit · **Login:** built-in accounts with 4 roles
* The earlier offline single-file dashboard in the parent folder is untouched.

## Quick start (Windows)

```powershell
cd audit-platform
.\start.ps1            # first run installs packages and builds the pages, then starts the server
```
Open <http://localhost:3000>. On first use you create the **Admin** account. Then: Upload Audit Files → check the preview → Import.

Requirements: Node.js **22.5 or newer** (the portable Node 22 in `%USERPROFILE%\node-portable` is used automatically if present).
No database server is needed: data is stored in `data/audit.db`. **Back this file up** (copy it while the server is stopped).

Manual commands: `npm install` · `npm run build` · `npm start` · `npm test` · dev: `npm run dev:server` and `npm run dev:client` (port 5173, proxies to 3000).

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | web port |
| `DB_PATH` | `data/audit.db` | SQLite file |
| `DB_CLIENT` / `DATABASE_URL` | `sqlite` | set `postgres` + a connection string to use PostgreSQL (see below) |
| `COOKIE_SECURE` | off | set `1` when served over HTTPS |
| `SCHEDULER` | on | `0` disables automatic weekly reports |

Business rules (error target, minimum samples, PT status meanings, weekly-report hour …) are **Settings in the app**, not code. A week is **Monday to Saturday**. (The time zone, Asia/Kolkata by default, and the per-category minimum are kept as saved values and are not shown on the Settings page.)

## Pages

Overview · Product Team · Category Performance · Audit Team · Error Analysis · PT & Re-Audit · Upload Audit Files · Weekly Reports · Settings. A search box at the top of every page finds people, projects, files and SKU IDs; filters (period, project, member, auditor, file, error type, PT status) sit under it.
Filters (period, project, member, auditor, file, error type, PT status) sit at the top of each page, are kept in the address bar and update every number and chart.

## Roles

| Role | Can do |
|---|---|
| Admin | everything, including users and settings |
| Audit Manager | view all, upload, undo an import, create reports |
| Audit Team Leader | view all, upload, create reports |
| Viewer | read-only |

Passwords are stored as salted scrypt hashes; sessions are random tokens (only their hash is stored) in HttpOnly SameSite cookies; uploads are
size-limited, type-checked by content and parsed in memory only.

## Deployment on a shared server

1. Install Node 22.5+, copy this folder, run `npm install` and `npm run build`.
2. Run `npm start` as a service (NSSM / Windows Task Scheduler "at startup", or `pm2`). Put it behind HTTPS (IIS/nginx reverse proxy) and set `COOKIE_SECURE=1`.
3. Back up `data/audit.db` regularly.

### Using PostgreSQL instead (not yet tested)
The PostgreSQL schema is `db/schema.postgres.sql` and an adapter exists (`server/src/db/postgres.js`), but **PostgreSQL was not available on the
development PC, so it has not been run.** To try it: `npm install pg`, create an empty database, set `DB_CLIENT=postgres` and `DATABASE_URL=postgres://user:pass@host/db`,
start the server (tables are created on start) and run `npm test`-style checks against it before relying on it.

## Documents
* [docs/CALCULATIONS.md](docs/CALCULATIONS.md) – sample workbook structure, every formula, the 33 / 31 / 34 reconciliation, duplicate rules
* [docs/API.md](docs/API.md) – API reference · [db/](db/) – schemas
* Tests: `npm test` runs 21 end-to-end tests (real HTTP server, in-memory database, the real sample workbook plus hand-built workbooks with decoy summary sheets and columns).
* **Data rule:** only columns A:N of the audit table are ever read; summary tables, other sheets and anything right of column N are ignored.

## Known limitations and open questions
See the end of [docs/CALCULATIONS.md](docs/CALCULATIONS.md) and the final report; main ones: PT/re-audit status meanings and error-code meanings are
inferred and must be confirmed; the audit date is not in the files; "undo import" does not revert records that import only *updated*; PostgreSQL untested.
