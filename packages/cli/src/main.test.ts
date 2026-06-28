import { describe, test, expect } from 'bun:test';
import {
  validate,
  inventory,
  policyAudit,
  computeRiskScore,
  renderReport,
} from '@openagentaudit/core';
import { validateEvents } from '@openagentaudit/schema';

// ---------------------------------------------------------------------------
// Golden trace — 7 events designed to yield a deterministic EAS of 85 / B.
//
// Component breakdown:
//   trace_completeness    =  80  (4 events lack evidence_id → 100 - 4*5 = 80)
//   provenance_integrity  =  60  (hash chain present, no ed25519 signatures)
//   objective_verification= 100  (2 verifier observations for 2 tool_calls ≥ 80%)
//   policy_coverage       = 100  (2 policy_decision events for 2 tool_calls)
//   human_oversight       =  80  (no high-risk tool tags)
//   contamination_inverted= 100  (no contamination data supplied)
//
//   EAS = 0.2*80 + 0.2*60 + 0.2*100 + 0.15*100 + 0.15*80 + 0.1*100
//       = 16 + 12 + 20 + 15 + 12 + 10 = 85
// ---------------------------------------------------------------------------
const EVENTS_JSONL = `
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-001","timestamp":"2025-01-01T00:00:00.000Z","type":"tool_call","actor":"agent","tool":{"name":"bash"},"evidence":{"hash":"aaaa0001","prev_hash":"0000000000000000000000000000000000000000000000000000000000000000"}}
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-002","timestamp":"2025-01-01T00:00:01.000Z","type":"observation","actor":"system","observation":{"source":"verifier:bash"},"evidence":{"evidence_id":"eid-002","hash":"aaaa0002","prev_hash":"aaaa0001"}}
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-003","timestamp":"2025-01-01T00:00:02.000Z","type":"tool_call","actor":"agent","tool":{"name":"write_file","capability":"filesystem.write"},"evidence":{"hash":"aaaa0003","prev_hash":"aaaa0002"}}
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-004","timestamp":"2025-01-01T00:00:03.000Z","type":"policy_decision","actor":"system","policy":{"decision":"allow","reason":"within-scope"},"evidence":{"evidence_id":"eid-004","hash":"aaaa0004","prev_hash":"aaaa0003"}}
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-005","timestamp":"2025-01-01T00:00:04.000Z","type":"observation","actor":"system","observation":{"source":"verifier:write_file"},"evidence":{"hash":"aaaa0005","prev_hash":"aaaa0004"}}
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-006","timestamp":"2025-01-01T00:00:05.000Z","type":"policy_decision","actor":"system","policy":{"decision":"allow","reason":"within-scope"},"evidence":{"evidence_id":"eid-006","hash":"aaaa0006","prev_hash":"aaaa0005"}}
{"schema_version":"open-agent-audit/v0.1","run_id":"golden-run-001","agent_id":"agent-smoke","model_id":"claude-smoke","event_id":"ev-007","timestamp":"2025-01-01T00:00:06.000Z","type":"model_output","actor":"agent","model_output":{"finish_reason":"end_turn"},"evidence":{"hash":"aaaa0007","prev_hash":"aaaa0006"}}
`.trim();

describe('CLI pipeline smoke test', () => {
  test('full pipeline: validate → inventory → policyAudit → score → report', async () => {
    const lines = EVENTS_JSONL.trim().split('\n');
    const raw = lines.map((l) => JSON.parse(l));

    // Schema-layer validation
    const { valid: events, errors: schemaErrors } = validateEvents(raw);
    expect(schemaErrors).toHaveLength(0);
    expect(events).toHaveLength(7);

    // Core engine: validate
    const vr = await validate(events);
    expect(vr.errors).toHaveLength(0);

    // Core engine: inventory
    const inv = await inventory(events);
    expect(inv.tools.length).toBeGreaterThan(0);

    // Core engine: policyAudit
    const findings = await policyAudit(events, {
      manifest: {
        declared_capabilities: [],
        high_risk_capabilities: [],
        denied_capabilities: [],
      },
    });
    expect(findings.length).toBeGreaterThan(0);

    // Core engine: computeRiskScore
    const score = await computeRiskScore(events, 'smoke-run-001');
    expect(score.evidence_admission_score.score).toBe(85);
    expect(score.evidence_admission_score.grade).toBe('B');

    // Core engine: renderReport
    const bundle = await renderReport(events, findings, score, inv);
    expect(bundle.markdown).toContain('Evidence Admission Score');
    expect(bundle.html).toContain('85/100');
    expect(bundle.json).toBeTruthy();

    const jsonReport = JSON.parse(bundle.json);
    expect(jsonReport.run_id).toBe('golden-run-001');
  });

  test('AEP adapter produces parseable events', async () => {
    const { aepV0_2 } = await import('@openagentaudit/adapters');
    expect(typeof aepV0_2.AepV0_2Adapter.toEvents).toBe('function');
  });
});
