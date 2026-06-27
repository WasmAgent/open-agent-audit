-- OpenAgentAudit — Initial D1 schema (v0.1)
--
-- Apply with: wrangler d1 execute oaa-meta --file=examples/cloudflare/d1-schema.sql
--
-- This file contains DDL only. No data is committed to the public repo.

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
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

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

CREATE TABLE IF NOT EXISTS findings (
  finding_id        TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  severity          TEXT NOT NULL,
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  evidence_ids      TEXT NOT NULL,
  standard_mappings TEXT,
  recommendation    TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES audit_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_findings_run      ON findings(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);

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
