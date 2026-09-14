-- packages/worker/migrations/0001_init.sql
-- Canonical base D1 schema (v0.1).
--
-- This file is the single source of truth for the base schema. The reference
-- copy at examples/cloudflare/d1-schema.sql mirrors this DDL; the schema-drift
-- test (test/migrations.test.ts) fails if the two diverge.
--
-- History: this file previously contained only a comment pointing at the
-- example schema, so an empty database could not be rebuilt from migrations
-- alone (N2-P1-08). The DDL below is the authoritative base.

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
  -- A project slug is unique per tenant. The globally-unique project_id is a
  -- tenant-namespaced surrogate (see defaultProjectId in the worker) so two
  -- tenants can each own a project named "default" (N2-P0-01).
  UNIQUE (tenant_id, name),
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
