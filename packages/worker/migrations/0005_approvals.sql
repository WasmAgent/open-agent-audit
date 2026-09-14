-- packages/worker/migrations/0005_approvals.sql
--
-- Move human-approval state from KV to D1 so decisions are linearizable
-- (N2-P1-02). KV get-then-put cannot compare-and-set: two concurrent decisions
-- could both observe "pending" and both report success.
--
-- State transitions are performed with a single conditional UPDATE:
--   UPDATE approvals SET status=? ... WHERE id=? AND status='pending' RETURNING *
-- One returned row = winner; zero rows = already decided (409).

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  input       TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT,
  reason      TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_approvals_tenant ON approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(tenant_id, status);
