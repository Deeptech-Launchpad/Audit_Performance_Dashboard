-- Audit Performance Platform - PostgreSQL schema (same tables as SQLite; 0/1 flags and ISO text dates kept identical so one code base serves both)

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','leader','viewer')),
  active        BIGINT NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- People named in the audit files (created automatically on import, never hard-coded)
CREATE TABLE IF NOT EXISTS employees (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  active     BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_roles (
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('content','auditor')),
  PRIMARY KEY (employee_id, role)
);

CREATE TABLE IF NOT EXISTS uploads (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  original_name TEXT NOT NULL,
  file_hash     TEXT NOT NULL,
  file_size     BIGINT NOT NULL,
  sheet_name    TEXT,
  header_row    BIGINT,
  audit_date    TEXT,                       -- YYYY-MM-DD, chosen/confirmed by the uploader
  project       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('preview','imported','discarded','undone','failed')),
  uploaded_by   BIGINT REFERENCES users(id),
  uploaded_at   TEXT NOT NULL,
  imported_at   TEXT,
  total_rows    BIGINT NOT NULL DEFAULT 0,
  imported_rows BIGINT NOT NULL DEFAULT 0,
  updated_rows  BIGINT NOT NULL DEFAULT 0,
  skipped_rows  BIGINT NOT NULL DEFAULT 0,
  has_unsampled BIGINT NOT NULL DEFAULT 1,   -- 1 = the file also lists SKUs that were NOT audited (so total SKUs can be counted)
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
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id           BIGINT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  sku_id              TEXT NOT NULL REFERENCES skus(sku_id),
  record_key          TEXT NOT NULL,        -- duplicate-detection fingerprint
  content_employee_id BIGINT REFERENCES employees(id),
  auditor_id          BIGINT REFERENCES employees(id),
  audit_date          TEXT NOT NULL,
  week_start          TEXT NOT NULL,        -- Monday of audit_date
  month               TEXT NOT NULL,        -- YYYY-MM
  is_sampled          BIGINT NOT NULL DEFAULT 0,
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
  has_findings        BIGINT NOT NULL DEFAULT 0,
  attrs_enriched      BIGINT,
  taxonomy            TEXT,
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
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_record_id BIGINT NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
  code            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cls_rec  ON error_classifications(audit_record_id);
CREATE INDEX IF NOT EXISTS ix_cls_code ON error_classifications(code);

-- Individual attributes named in "Attribute/Field" ("A | B" -> two rows)
CREATE TABLE IF NOT EXISTS record_attributes (
  audit_record_id BIGINT NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
  attribute       TEXT NOT NULL,
  is_attribute    BIGINT NOT NULL DEFAULT 1,
  was_enriched    BIGINT
);
CREATE INDEX IF NOT EXISTS ix_attr_rec ON record_attributes(audit_record_id);

-- Follow-up tracking (classified from the raw text using the status map in settings)
CREATE TABLE IF NOT EXISTS pt_tracking (
  audit_record_id BIGINT PRIMARY KEY REFERENCES audit_records(id) ON DELETE CASCADE,
  status_raw      TEXT,
  status_class    TEXT NOT NULL,            -- completed | pending | not_recorded | unmapped | not_applicable
  comments        TEXT,
  response        TEXT
);
CREATE TABLE IF NOT EXISTS reaudit_tracking (
  audit_record_id BIGINT PRIMARY KEY REFERENCES audit_records(id) ON DELETE CASCADE,
  comments        TEXT,
  state           TEXT NOT NULL             -- pending | passed | issues | not_due
);

CREATE TABLE IF NOT EXISTS error_types (
  code     TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  is_error BIGINT NOT NULL DEFAULT 1,
  tip      TEXT,
  verified BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- JSON
);
CREATE TABLE IF NOT EXISTS weekly_reports (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('weekly','custom')),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by BIGINT REFERENCES users(id),  -- NULL = generated automatically
  summary_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly ON weekly_reports(period_start) WHERE kind = 'weekly';

-- case-insensitive uniqueness (SQLite uses COLLATE NOCASE)
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username  ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS ux_employees_name  ON employees (lower(name));
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS has_unsampled BIGINT NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS project TEXT;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS attrs_enriched BIGINT;
ALTER TABLE record_attributes ADD COLUMN IF NOT EXISTS is_attribute BIGINT NOT NULL DEFAULT 1;
ALTER TABLE record_attributes ADD COLUMN IF NOT EXISTS was_enriched BIGINT;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS taxonomy TEXT;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS source_info TEXT;
ALTER TABLE record_attributes ADD COLUMN IF NOT EXISTS from_comment BIGINT NOT NULL DEFAULT 0;   -- 1 = found in the Audit Comments, not in column F
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS comment_attrs_v BIGINT;                         -- version of the comment reader applied to this upload
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_developer BIGINT NOT NULL DEFAULT 0;   -- can answer the Feedback board

-- Feedback board: bugs / feature requests from users to the developer
CREATE TABLE IF NOT EXISTS notes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'bug',      -- bug | feature | other
  title       TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  page        TEXT NOT NULL DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high
  status      TEXT NOT NULL DEFAULT 'new',      -- new | in_progress | done | wont_do
  reply       TEXT NOT NULL DEFAULT '',
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  done_at     TEXT,
  done_by     BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_notes_status ON notes(status);
