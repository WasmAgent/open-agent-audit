-- packages/worker/migrations/0004_schema_baseline_repair.sql
--
-- Baseline repair for deployments where 0001_init.sql was applied as a
-- comment-only stub and the base tables were created out-of-band from
-- examples/cloudflare/d1-schema.sql (N2-P1-08). Every statement is guarded so
-- this migration is a no-op on an already-correct schema and safe to re-run.
--
-- This does not rewrite any already-applied migration. It also adds the
-- per-tenant project-slug uniqueness constraint that the surrogate-key fix
-- (N2-P0-01) relies on.

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'pilot',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

-- For databases whose `projects` table predates the inline UNIQUE constraint,
-- add the equivalent unique index. Idempotent and additive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_tenant_name ON projects(tenant_id, name);

CREATE TABLE IF NOT EXISTS audit_runs (
  run_id                   TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  project_id               TEXT NOT NULL,
  status                   TEXT NOT NULL,
  input_format             TEXT NOT NULL,
  schema_version           TEXT NOT NULL,
  profile_ids              TEXT NOT NULL,
  raw_r2_key               TEXT,
  normalized_prefix        TEXT,
  report_prefix            TEXT,
  event_count              INTEGER DEFAULT 0,
  finding_count            INTEGER DEFAULT 0,
  risk_score               REAL,
  evidence_admission_score REAL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  completed_at             TEXT,
  error_message            TEXT,
  FOREIGN KEY (tenant_id)  REFERENCES tenants(tenant_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_tenant ON audit_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs(status);

-- Includes the columns added by 0003_findings_extended.sql so a database that
-- is missing the table entirely can still be rebuilt.
CREATE TABLE IF NOT EXISTS findings (
  finding_id                TEXT PRIMARY KEY,
  run_id                    TEXT NOT NULL,
  tenant_id                 TEXT NOT NULL,
  severity                  TEXT NOT NULL,
  category                  TEXT NOT NULL,
  title                     TEXT NOT NULL,
  evidence_ids              TEXT NOT NULL,
  standard_mappings         TEXT,
  recommendation            TEXT,
  created_at                TEXT NOT NULL,
  description               TEXT,
  event_id                  TEXT,
  confidence                TEXT,
  false_positive_likelihood REAL,
  first_seen                TEXT,
  last_seen                 TEXT,
  occurrence_count          INTEGER,
  suppressed                INTEGER,
  suppression_reason        TEXT,
  FOREIGN KEY (run_id) REFERENCES audit_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_findings_run      ON findings(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_tenant   ON findings(tenant_id);

CREATE TABLE IF NOT EXISTS evidence_index (
  evidence_id      TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  tenant_id        TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  event_ts         TEXT,
  r2_key           TEXT NOT NULL,
  byte_start       INTEGER,
  byte_end         INTEGER,
  hash             TEXT,
  signature_status TEXT,
  FOREIGN KEY (run_id) REFERENCES audit_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence_index(run_id);

CREATE TABLE IF NOT EXISTS reports (
  report_id            TEXT PRIMARY KEY,
  run_id               TEXT NOT NULL,
  tenant_id            TEXT NOT NULL,
  format               TEXT NOT NULL,
  r2_key               TEXT NOT NULL,
  profile_ids          TEXT NOT NULL,
  generated_by_version TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  retention_until      TEXT,
  FOREIGN KEY (run_id) REFERENCES audit_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_run ON reports(run_id);
