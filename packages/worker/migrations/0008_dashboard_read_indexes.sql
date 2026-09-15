-- 0008 — dashboard read-path index (D1-Q-01, issue #310 follow-up)
--
-- Measured with EXPLAIN QUERY PLAN on the production-shaped findings table:
-- before: SEARCH findings USING INDEX idx_findings_tenant (tenant_id=?) +
--         TEMP B-TREE for GROUP BY/ORDER BY, with per-row table lookups;
-- after:  SEARCH findings USING COVERING INDEX
--         idx_findings_tenant_created_severity (tenant_id=? AND created_at>?)
--         — severity is carried in the index, so the finding-trends
--         aggregation reads the index only (no row lookups).
-- Keep only this measured access path; drop the migration if the planner
-- changes.

CREATE INDEX IF NOT EXISTS idx_findings_tenant_created_severity
  ON findings (tenant_id, created_at, severity);

CREATE INDEX IF NOT EXISTS idx_audit_runs_tenant_created
  ON audit_runs (tenant_id, created_at);
