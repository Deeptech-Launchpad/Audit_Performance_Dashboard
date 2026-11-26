-- Audit Performance Platform - SQLite schema (default engine, no install needed)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','leader','viewer')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- People named in the audit files (created automatically on import, never hard-coded)
CREATE TABLE IF NOT EXISTS employees (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT,                          -- optional: where feedback reports are sent
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_roles (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('content','auditor')),
  PRIMARY KEY (employee_id, role)
);

CREATE TABLE IF NOT EXISTS uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT NOT NULL,
  file_hash     TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  sheet_name    TEXT,
  header_row    INTEGER,
  audit_date    TEXT,                       -- YYYY-MM-DD, chosen/confirmed by the uploader
  project       TEXT,                       -- chosen by the uploader (pre-filled from the file name); not a column of the audit table
  status        TEXT NOT NULL CHECK (status IN ('preview','imported','discarded','undone','failed')),
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL,
  imported_at   TEXT,
  total_rows    INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows  INTEGER NOT NULL DEFAULT 0,
  skipped_rows  INTEGER NOT NULL DEFAULT 0,
  has_unsampled INTEGER NOT NULL DEFAULT 1,   -- 1 = the file also lists SKUs that were NOT audited (so total SKUs can be counted)
  report_json   TEXT,                       -- processing report (validation, duplicates, decisions)
  staged_json   TEXT                        -- parsed rows while status = 'preview'; cleared afterwards
);

-- One row per SKU (latest product details)
CREATE TABLE IF NOT EXISTS skus (
  sku_id       TEXT PRIMARY KEY,
  taxonomy     TEXT,
  leaf_node    TEXT,
  manufacturer TEXT,
  flight_group TEXT
);

-- One row per SKU row of an uploaded file (sampled or not)
CREATE TABLE IF NOT EXISTS audit_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id           INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  sku_id              TEXT NOT NULL REFERENCES skus(sku_id),
  record_key          TEXT NOT NULL,        -- duplicate-detection fingerprint
  content_employee_id INTEGER REFERENCES employees(id),
  auditor_id          INTEGER REFERENCES employees(id),
  audit_date          TEXT NOT NULL,
  week_start          TEXT NOT NULL,        -- Monday of audit_date
  month               TEXT NOT NULL,        -- YYYY-MM
  is_sampled          INTEGER NOT NULL DEFAULT 0,
  sample_flag         TEXT,
  error_raw           TEXT,                 -- original "Error Type" cell
  attribute_field     TEXT,
  audit_comments      TEXT,
  pt_status           TEXT,
  pt_comments         TEXT,
  reaudit_comments    TEXT,
  gap_similar         TEXT,
  pt_response         TEXT,
  cfb_attribute       TEXT,
  cfb_comments        TEXT,
  has_findings        INTEGER NOT NULL DEFAULT 0,
  attrs_enriched      INTEGER,                -- attributes with a value on this SKU (Att n + Raw/Build Val n columns); NULL = file had no attribute columns
  taxonomy            TEXT,                    -- PIM Taxonomy of the SKU (L1 category = text before the first ">"); NULL = file had no PIM Taxonomy column
  source_info         TEXT                    -- source links of the attributes named in column F (JSON); NULL = none / file had no link columns
);
CREATE INDEX IF NOT EXISTS ix_rec_sku     ON audit_records(sku_id);
CREATE INDEX IF NOT EXISTS ix_rec_date    ON audit_records(audit_date);
CREATE INDEX IF NOT EXISTS ix_rec_key     ON audit_records(record_key);
CREATE INDEX IF NOT EXISTS ix_rec_upload  ON audit_records(upload_id);
CREATE INDEX IF NOT EXISTS ix_rec_content ON audit_records(content_employee_id);
CREATE INDEX IF NOT EXISTS ix_rec_auditor ON audit_records(auditor_id);

-- One row per error code on a record ("DE | DM" -> two rows)
CREATE TABLE IF NOT EXISTS error_classifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_record_id INTEGER NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
  code            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cls_rec  ON error_classifications(audit_record_id);
CREATE INDEX IF NOT EXISTS ix_cls_code ON error_classifications(code);

-- Individual attributes named in "Attribute/Field" ("A | B" -> two rows)
CREATE TABLE IF NOT EXISTS record_attributes (
  audit_record_id INTEGER NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
  attribute       TEXT NOT NULL,
  is_attribute    INTEGER NOT NULL DEFAULT 1,  -- 1 = a real product attribute of this SKU; 0 = another field (e.g. Source, All)
  was_enriched    INTEGER                      -- 1 = the attribute had a value; 0 = left empty; NULL = unknown
);
CREATE INDEX IF NOT EXISTS ix_attr_rec ON record_attributes(audit_record_id);

-- Follow-up tracking (classified from the raw text using the status map in settings)
CREATE TABLE IF NOT EXISTS pt_tracking (
  audit_record_id INTEGER PRIMARY KEY REFERENCES audit_records(id) ON DELETE CASCADE,
  status_raw      TEXT,
  status_class    TEXT NOT NULL,            -- completed | pending | not_recorded | unmapped | not_applicable
  comments        TEXT,
  response        TEXT
);
CREATE TABLE IF NOT EXISTS reaudit_tracking (
  audit_record_id INTEGER PRIMARY KEY REFERENCES audit_records(id) ON DELETE CASCADE,
  comments        TEXT,
  state           TEXT NOT NULL             -- pending | passed | issues | not_due
);

CREATE TABLE IF NOT EXISTS error_types (
  code     TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  is_error INTEGER NOT NULL DEFAULT 1,
  tip      TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- JSON
);
CREATE TABLE IF NOT EXISTS weekly_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('weekly','custom')),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by INTEGER REFERENCES users(id),  -- NULL = generated automatically
  summary_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly ON weekly_reports(period_start) WHERE kind = 'weekly';
