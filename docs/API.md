# API reference

Base path `/api`. JSON in/out. Authentication is a session cookie (`audit_session`, HttpOnly, SameSite=Strict) set by login/setup.
Every **non-GET** request must carry the header `X-Requested-With: audit-app` (blocks cross-site form posts).
Errors are `{ "error": "plain-language message" }` with status 400 (invalid input), 401 (not signed in), 403 (role not allowed), 404, 409, 413, 429, 500.

Roles → permissions: **view** (all roles), **upload** (admin, manager, leader), **undoUpload** (admin, manager), **report** (admin, manager, leader), **settings** and **users** (admin).

## Shared filters (query string)
`from`, `to` (YYYY-MM-DD) · `project` (the first word of the project name, e.g. `Grainger` = every file whose project starts with Grainger; a full project name still matches itself) · `uploadId` · `week` (any date → its Monday–Saturday week; Sunday is not part of a week) · `month` (YYYY-MM) · `builderId` · `auditorId` · `errorCode` · `attribute` · `ptStatus` (text or `__none__`) · `ptClass` · `reauditState` · `q` (SKU ID contains) · `skuId` (exact).
`week` / `month` win over `from`/`to`. Invalid dates → 400.

## Auth
| Method & path | Notes |
|---|---|
| `GET /auth/status` | `{needsSetup, user}` – works without sign-in |
| `POST /auth/setup` | First run only: `{username, displayName, password≥10}` creates the Admin (409 afterwards) |
| `POST /auth/login` | `{username, password}`; 8 failures / 15 min / (IP+user) → 429 |
| `POST /auth/logout` · `POST /auth/password` | `{current, next}` |

## Dashboard data (view)
| Path | Returns |
|---|---|
| `GET /meta` | filter lists (builders, auditors, weeks, months, PT statuses, error types), data bounds, today (configured TZ), public settings |
| `GET /overview` | `kpis`, `reconciliation` (classifications vs error SKUs + multi-error SKUs), `levels`, `content`, `audit`, `errorTypes`, `weekly`, `daily`, `weekCompare`, `previous` (equal-length previous period when dates are filtered) |
| `GET /content-team` | ranked `members[]`: skus, samples, sampleRate, errorSkus, errorRate, classifications, level, rank, byType, topAttributes, weekly, change |
| `GET /audit-team` | `auditors[]`: skusAudited, records, share, classifications, errorSkus, byType, pt{}, reaudit{}, pendingCases, closedCases, weekly |
| `GET /errors` | byType, topErrors, byAttribute / topAttributes (10), byMember matrix, byWeek, repeated, totals |
| `GET /follow-ups` | PT / re-audit counts, ageing buckets, unmapped statuses, case `items[]` |
| `GET /trend` | weekly + daily metrics |
| `GET /suggestions` | rule-based suggestions with `evidence`; period = filters or latest week vs the week before |
| `GET /records?page&pageSize&sort&dir` | paged SKU audit rows (all original fields + classification) |
| `GET /records/export` | filtered rows as `.xlsx` |
| `GET /skus/:id` | SKU details + full audit history |

## Uploads
| Path | Notes |
|---|---|
| `GET /uploads` | history (imported, failed, undone …) |
| `POST /uploads` (multipart `files`, ≤10, .ods/.xlsx/.xls, ≤60 MB) | **Step 1.** Reads, validates and analyses duplicates; nothing is imported. Per file: `{id, failed, error}` or `{id, analysis}` (columns, counts, validation, `review[]`, `crossCheck`, `blockers`) |
| `POST /uploads/:id/analyze` | `{auditDate?, tableIndex?}` re-run after the date or sheet changes |
| `POST /uploads/:id/commit` | **Step 2.** `{auditDate?, tableIndex?, decisions:{rowNo:"skip"|"update"|"import"}}` – one transaction |
| `POST /uploads/:id/discard` · `POST /uploads/:id/undo` (undoUpload) | undo removes the records an import added |
| `GET /uploads/:id` · `GET /uploads/:id/report` | preview/report JSON · processing report `.xlsx` |

## Reports
`GET /reports` · `GET /reports/:id` (JSON snapshot) · `GET /reports/:id/excel` · `GET /reports/:id/pdf` ·
`POST /reports {from,to,kind:"custom"|"weekly"}` (report) · `POST /reports/last-week` (report).
Weekly reports are also created automatically for every finished Monday–Saturday week (checked every 15 min; a week counts as finished once the next Monday has come, from the configured hour, in the configured time zone). A weekly report is compared with the Monday–Saturday week before it. A file whose audit date is a Sunday is flagged in the upload review: it is outside every week, so it is not in a weekly report (it still counts everywhere else).

## Settings & users
`GET /settings` · `PUT /settings` (admin; re-classifies all PT/re-audit statuses) · `PUT /error-types` (admin) ·
`GET/POST /users`, `PATCH /users/:id` (admin; cannot remove the last active Admin).

## Feedback to a team member
| Path | Notes |
|---|---|
| `GET /feedback/:builderId` (view) | Personal report for one product team member (filters: from/to/week/month): their numbers, rule-based suggestions with evidence, SKUs to check, a ready-to-send message and their saved email |
| `GET /feedback/:builderId/pdf` (view) | The same as a PDF |
| `PUT /feedback/:builderId/email` (report) | `{email}` saves the address (empty string removes it) |

The system does not send email itself: the web page opens the user's email program (mailto) with the message filled in.

## Check mistakes at the source
* `GET /content-team/:id/source-checks` (view; same filters as `/content-team`) → `{items:[{id, skuId, auditDate, codes, saved, comment, attributes:[{name, matched, value, links:[{url, page}], note}], productLinks:[{kind: data|pdf, url, page}]}], missingFiles}`. Audited records of that person with a real error. `saved:false` = the file was uploaded before source links were kept (upload it again) or has no link columns. `note` = the part of Audit Comments written for that attribute ("Name>>…" or "<Name> …"), '' when the comment does not name it.
* `GET /source-file?rec=<record id>&u=<url>` (view) → the original PDF of a link saved for that record (used by the `/source-view` page, which finds and marks the captured value). Any other address → 404; private/local hosts → 400; not a PDF → 415; over 40 MB → 413; source site unreachable/refusing → 502.
* Web source links open as browser text-highlight links (`#:~:text=`), built in `client/src/lib/highlight.js`.

## Search, projects, Top 5
* `GET /search?q=` (view, ≥ 2 letters) → `{people:[{id,name,role}], projects, files, skus}`.
* Project = a name chosen by the uploader per file (the audit table has no project column); suggested from the file name, sent as `project` in `POST /uploads/:id/commit`, changed later with `PATCH /uploads/:id/project {project}` (upload permission). `GET /meta` lists `projects` (full names), `projectGroups` (first words only, used by the Project filter and search) and `uploads`.
* `GET /overview` also returns `top.content` (lowest error %, people with enough audited SKUs) and `top.audit` (most SKUs audited, with closed follow-up cases).
* The old SKU Audit Details page was removed from the app; `GET /records`, `/records/export` and `/skus/:id` remain for drill-down pop-ups.

## Category Performance
* `GET /categories` (view; filters from/to/week/month/project/uploadId/auditorId) → `categories[]` (skus, samples, errorRate, `members[]` with tier, `recommended[]`, `basis`, `needsSupport[]`), `people[]` (proven / needs-support categories), `summary`, `coverage`, `missingFiles`.
