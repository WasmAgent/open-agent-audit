import { describe, test, expect } from 'bun:test';
import { policyAudit } from './index.js';
import type { PolicyAuditContext } from './index.js';
import type { CanonicalEvent } from '@openagentaudit/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 'open-agent-audit/v0.1' as const;

/** Build a minimal PolicyAuditContext with the given capability lists. */
const ctx = (
  declared: string[] = [],
  high_risk: string[] = [],
  denied: string[] = [],
): PolicyAuditContext => ({
  manifest: {
    declared_capabilities: declared,
    high_risk_capabilities: high_risk,
    denied_capabilities: denied,
  },
});

let _counter = 0;
/** Create a deterministic unique event_id. */
function nextId(prefix = 'evt'): string {
  return `${prefix}-${++_counter}`;
}

/** Build a CanonicalEvent with sensible defaults; caller can override any field. */
function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: 'run-001',
    agent_id: 'agent-001',
    model_id: 'model-001',
    event_id: nextId(),
    timestamp: '2024-01-01T00:00:00Z',
    type: 'observation',
    actor: 'system',
    ...overrides,
  };
}

/** Build a tool_call event. */
function toolCall(
  toolName: string,
  overrides: Partial<CanonicalEvent> & {
    capability?: string;
    risk_tags?: string[];
  } = {},
): CanonicalEvent {
  const { capability, risk_tags, ...rest } = overrides;
  return makeEvent({
    type: 'tool_call',
    actor: 'agent',
    tool: {
      name: toolName,
      ...(capability !== undefined ? { capability } : {}),
      ...(risk_tags !== undefined ? { risk_tags } : {}),
    },
    ...rest,
  });
}

/** Build a policy_decision event for a named tool. */
function policyDecision(
  toolName: string,
  decision: 'allow' | 'deny' | 'ask_user',
  overrides: Partial<CanonicalEvent> = {},
): CanonicalEvent {
  return makeEvent({
    type: 'policy_decision',
    actor: 'system',
    tool: { name: toolName },
    policy: { decision, reason: `${decision} for ${toolName}` },
    ...overrides,
  });
}

/** Build a human_approval event in a given run. */
function humanApproval(runId = 'run-001'): CanonicalEvent {
  return makeEvent({
    type: 'human_approval',
    actor: 'human_reviewer',
    run_id: runId,
    human: { reviewer_id: 'rev-001', decision: 'approve' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('policyAudit', () => {
  // 1. Empty events, empty manifest — no findings
  test('empty events and empty manifest produce no findings', async () => {
    const findings = await policyAudit([], ctx());
    expect(findings).toHaveLength(0);
  });

  // 2. tool_call with undeclared capability — OAA-R-CAP-001 (high)
  test('tool_call with undeclared capability fires OAA-R-CAP-001 at high severity', async () => {
    const ev = toolCall('bash', { capability: 'filesystem.write' });
    const findings = await policyAudit([ev], ctx([])); // nothing declared
    const cap001 = findings.filter((f) => f.rule_id === 'OAA-R-CAP-001');
    expect(cap001).toHaveLength(1);
    expect(cap001[0]!.severity).toBe('high');
  });

  // 3. tool_call with declared capability — no OAA-R-CAP-001
  test('tool_call with a declared capability does not fire OAA-R-CAP-001', async () => {
    const ev = toolCall('bash', { capability: 'filesystem.write' });
    const findings = await policyAudit([ev], ctx(['filesystem.write']));
    const cap001 = findings.filter((f) => f.rule_id === 'OAA-R-CAP-001');
    expect(cap001).toHaveLength(0);
  });

  // 4. tool_call with denied capability — OAA-R-CAP-002 (critical)
  test('tool_call with denied capability fires OAA-R-CAP-002 at critical severity', async () => {
    const ev = toolCall('bash', { capability: 'network.exfiltrate' });
    const findings = await policyAudit([ev], ctx(['network.exfiltrate'], [], ['network.exfiltrate']));
    const cap002 = findings.filter((f) => f.rule_id === 'OAA-R-CAP-002');
    expect(cap002).toHaveLength(1);
    expect(cap002[0]!.severity).toBe('critical');
  });

  // 5. tool_call with high_risk capability, no human_approval in run — OAA-R-OVERSIGHT-001 (high)
  test('tool_call with high_risk capability and no human_approval fires OAA-R-OVERSIGHT-001 at high severity', async () => {
    const ev = toolCall('deploy', { capability: 'infra.deploy' });
    const findings = await policyAudit([ev], ctx(['infra.deploy'], ['infra.deploy'], []));
    const oversight001 = findings.filter((f) => f.rule_id === 'OAA-R-OVERSIGHT-001');
    expect(oversight001).toHaveLength(1);
    expect(oversight001[0]!.severity).toBe('high');
  });

  // 6. tool_call with high_risk capability, human_approval present in same run — no OAA-R-OVERSIGHT-001
  test('tool_call with high_risk capability and human_approval in run does not fire OAA-R-OVERSIGHT-001', async () => {
    const approval = humanApproval('run-001');
    const ev = toolCall('deploy', { capability: 'infra.deploy', run_id: 'run-001' });
    const findings = await policyAudit(
      [approval, ev],
      ctx(['infra.deploy'], ['infra.deploy'], []),
    );
    const oversight001 = findings.filter((f) => f.rule_id === 'OAA-R-OVERSIGHT-001');
    expect(oversight001).toHaveLength(0);
  });

  // 7. policy_decision deny, then same tool_call again — OAA-R-POLICY-001
  test('tool_call after a policy_decision deny for the same tool fires OAA-R-POLICY-001', async () => {
    const deny = policyDecision('bash', 'deny');
    const call = toolCall('bash', { capability: 'filesystem.read' });
    // Declare the capability to avoid CAP-001 noise
    const findings = await policyAudit([deny, call], ctx(['filesystem.read']));
    const policy001 = findings.filter((f) => f.rule_id === 'OAA-R-POLICY-001');
    expect(policy001).toHaveLength(1);
    expect(policy001[0]!.severity).toBe('critical');
  });

  // 7b. tool_call BEFORE a policy_decision deny does not fire OAA-R-POLICY-001
  test('tool_call before a policy_decision deny does not fire OAA-R-POLICY-001', async () => {
    const call = toolCall('bash', { capability: 'filesystem.read' });
    const deny = policyDecision('bash', 'deny');
    const findings = await policyAudit([call, deny], ctx(['filesystem.read']));
    const policy001 = findings.filter((f) => f.rule_id === 'OAA-R-POLICY-001');
    expect(policy001).toHaveLength(0);
  });

  // 8. tool_call with high_risk risk_tag, no policy_decision at all — OAA-R-POLICY-002 (medium)
  test('tool_call with high_risk risk_tag and no policy_decision fires OAA-R-POLICY-002 at medium severity', async () => {
    const ev = toolCall('rm-rf', { risk_tags: ['high_risk'] });
    const findings = await policyAudit([ev], ctx());
    const policy002 = findings.filter((f) => f.rule_id === 'OAA-R-POLICY-002');
    expect(policy002).toHaveLength(1);
    expect(policy002[0]!.severity).toBe('medium');
  });

  // 8b. tool_call with mutation risk_tag, no policy_decision — OAA-R-POLICY-002 (medium)
  test('tool_call with mutation risk_tag and no policy_decision fires OAA-R-POLICY-002', async () => {
    const ev = toolCall('write-file', { risk_tags: ['mutation'] });
    const findings = await policyAudit([ev], ctx());
    const policy002 = findings.filter((f) => f.rule_id === 'OAA-R-POLICY-002');
    expect(policy002).toHaveLength(1);
    expect(policy002[0]!.severity).toBe('medium');
  });

  // 9. tool_call with high_risk risk_tag, policy_decision present — no OAA-R-POLICY-002
  test('tool_call with high_risk risk_tag and a policy_decision does not fire OAA-R-POLICY-002', async () => {
    const allow = policyDecision('rm-rf', 'allow');
    const ev = toolCall('rm-rf', { risk_tags: ['high_risk'] });
    const findings = await policyAudit([allow, ev], ctx());
    const policy002 = findings.filter((f) => f.rule_id === 'OAA-R-POLICY-002');
    expect(policy002).toHaveLength(0);
  });

  // 10. hash chain break — OAA-R-INTEGRITY-001 (medium)
  test('hash chain break fires OAA-R-INTEGRITY-001 at medium severity', async () => {
    const e1 = makeEvent({
      event_id: nextId('chain'),
      evidence: { hash: 'aaaaaa', prev_hash: '0'.repeat(64) },
    });
    const e2 = makeEvent({
      event_id: nextId('chain'),
      evidence: { hash: 'bbbbbb', prev_hash: 'WRONG-HASH' }, // mismatch
    });
    const findings = await policyAudit([e1, e2], ctx());
    const integrity001 = findings.filter((f) => f.rule_id === 'OAA-R-INTEGRITY-001');
    expect(integrity001).toHaveLength(1);
    expect(integrity001[0]!.severity).toBe('medium');
  });

  // 11. valid hash chain — no OAA-R-INTEGRITY-001
  test('valid hash chain does not fire OAA-R-INTEGRITY-001', async () => {
    const hash1 = 'aaaaaa';
    const hash2 = 'bbbbbb';
    const e1 = makeEvent({
      event_id: nextId('valid-chain'),
      evidence: { hash: hash1, prev_hash: '0'.repeat(64) },
    });
    const e2 = makeEvent({
      event_id: nextId('valid-chain'),
      evidence: { hash: hash2, prev_hash: hash1 },
    });
    const e3 = makeEvent({
      event_id: nextId('valid-chain'),
      evidence: { hash: 'cccccc', prev_hash: hash2 },
    });
    const findings = await policyAudit([e1, e2, e3], ctx());
    const integrity001 = findings.filter((f) => f.rule_id === 'OAA-R-INTEGRITY-001');
    expect(integrity001).toHaveLength(0);
  });

  // 12. evidence_ids on each finding point to the relevant event_id(s)
  describe('evidence_ids correctness', () => {
    test('OAA-R-CAP-001 evidence_ids contains the offending event_id', async () => {
      const ev = toolCall('bash', { capability: 'disk.format', event_id: 'ev-cap001' });
      const findings = await policyAudit([ev], ctx([]));
      const f = findings.find((x) => x.rule_id === 'OAA-R-CAP-001');
      expect(f).toBeDefined();
      expect(f!.evidence_ids).toContain('ev-cap001');
    });

    test('OAA-R-CAP-002 evidence_ids contains the offending event_id', async () => {
      const ev = toolCall('bash', { capability: 'network.exfiltrate', event_id: 'ev-cap002' });
      const findings = await policyAudit([ev], ctx(['network.exfiltrate'], [], ['network.exfiltrate']));
      const f = findings.find((x) => x.rule_id === 'OAA-R-CAP-002');
      expect(f).toBeDefined();
      expect(f!.evidence_ids).toContain('ev-cap002');
    });

    test('OAA-R-OVERSIGHT-001 evidence_ids contains the offending event_id', async () => {
      const ev = toolCall('deploy', { capability: 'infra.deploy', event_id: 'ev-oversight' });
      const findings = await policyAudit([ev], ctx(['infra.deploy'], ['infra.deploy'], []));
      const f = findings.find((x) => x.rule_id === 'OAA-R-OVERSIGHT-001');
      expect(f).toBeDefined();
      expect(f!.evidence_ids).toContain('ev-oversight');
    });

    test('OAA-R-POLICY-001 evidence_ids contains the offending tool_call event_id', async () => {
      const deny = policyDecision('bash', 'deny');
      const call = toolCall('bash', { event_id: 'ev-policy001' });
      const findings = await policyAudit([deny, call], ctx());
      const f = findings.find((x) => x.rule_id === 'OAA-R-POLICY-001');
      expect(f).toBeDefined();
      expect(f!.evidence_ids).toContain('ev-policy001');
    });

    test('OAA-R-POLICY-002 evidence_ids contains the offending event_id', async () => {
      const ev = toolCall('rm-rf', { risk_tags: ['high_risk'], event_id: 'ev-policy002' });
      const findings = await policyAudit([ev], ctx());
      const f = findings.find((x) => x.rule_id === 'OAA-R-POLICY-002');
      expect(f).toBeDefined();
      expect(f!.evidence_ids).toContain('ev-policy002');
    });

    test('OAA-R-INTEGRITY-001 evidence_ids contains both prev and current event_id', async () => {
      const e1 = makeEvent({ event_id: 'ev-prev', evidence: { hash: 'hash-prev' } });
      const e2 = makeEvent({
        event_id: 'ev-break',
        evidence: { hash: 'hash-curr', prev_hash: 'WRONG' },
      });
      const findings = await policyAudit([e1, e2], ctx());
      const f = findings.find((x) => x.rule_id === 'OAA-R-INTEGRITY-001');
      expect(f).toBeDefined();
      expect(f!.evidence_ids).toContain('ev-prev');
      expect(f!.evidence_ids).toContain('ev-break');
    });
  });

  // 13. finding_id is deterministic: same rule + event_id → same finding_id
  test('finding_id is deterministic for the same rule_id and event_id', async () => {
    const eventId = 'deterministic-evt-001';
    const ev = toolCall('bash', { capability: 'filesystem.write', event_id: eventId });

    const [run1, run2] = await Promise.all([
      policyAudit([ev], ctx([])),
      policyAudit([ev], ctx([])),
    ]);

    const f1 = run1.find((x) => x.rule_id === 'OAA-R-CAP-001');
    const f2 = run2.find((x) => x.rule_id === 'OAA-R-CAP-001');
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    expect(f1!.finding_id).toBe(f2!.finding_id);
  });

  test('different event_ids produce different finding_ids for the same rule', async () => {
    const ev1 = toolCall('bash', { capability: 'filesystem.write', event_id: 'det-evt-A' });
    const ev2 = toolCall('bash', { capability: 'filesystem.write', event_id: 'det-evt-B' });

    const findings1 = await policyAudit([ev1], ctx([]));
    const findings2 = await policyAudit([ev2], ctx([]));

    const f1 = findings1.find((x) => x.rule_id === 'OAA-R-CAP-001');
    const f2 = findings2.find((x) => x.rule_id === 'OAA-R-CAP-001');
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    expect(f1!.finding_id).not.toBe(f2!.finding_id);
  });

  // Additional edge cases

  test('multiple tool_calls with undeclared capabilities produce one finding per event', async () => {
    const e1 = toolCall('bash', { capability: 'fs.read' });
    const e2 = toolCall('net', { capability: 'net.fetch' });
    const findings = await policyAudit([e1, e2], ctx([]));
    const cap001 = findings.filter((f) => f.rule_id === 'OAA-R-CAP-001');
    expect(cap001).toHaveLength(2);
  });

  test('tool_call without capability field does not fire OAA-R-CAP-001 or OAA-R-CAP-002', async () => {
    const ev = toolCall('bash'); // no capability field
    const findings = await policyAudit([ev], ctx([]));
    expect(findings.filter((f) => f.rule_id === 'OAA-R-CAP-001')).toHaveLength(0);
    expect(findings.filter((f) => f.rule_id === 'OAA-R-CAP-002')).toHaveLength(0);
  });

  test('tool_call capability in denied list also fires OAA-R-CAP-001 when not declared', async () => {
    // A denied capability that is also not in declared_capabilities should fire both rules
    const ev = toolCall('bash', { capability: 'network.exfiltrate' });
    const findings = await policyAudit([ev], ctx([], [], ['network.exfiltrate']));
    expect(findings.filter((f) => f.rule_id === 'OAA-R-CAP-001')).toHaveLength(1);
    expect(findings.filter((f) => f.rule_id === 'OAA-R-CAP-002')).toHaveLength(1);
  });

  test('human_approval in a different run_id does not suppress OAA-R-OVERSIGHT-001', async () => {
    const approval = humanApproval('run-OTHER');
    const ev = toolCall('deploy', { capability: 'infra.deploy', run_id: 'run-001' });
    const findings = await policyAudit(
      [approval, ev],
      ctx(['infra.deploy'], ['infra.deploy'], []),
    );
    const oversight001 = findings.filter((f) => f.rule_id === 'OAA-R-OVERSIGHT-001');
    expect(oversight001).toHaveLength(1);
  });

  test('policy_decision allow for a tool with high_risk tag suppresses OAA-R-POLICY-002', async () => {
    const allow = policyDecision('dangerous-tool', 'allow');
    const ev = toolCall('dangerous-tool', { risk_tags: ['mutation', 'high_risk'] });
    const findings = await policyAudit([allow, ev], ctx());
    expect(findings.filter((f) => f.rule_id === 'OAA-R-POLICY-002')).toHaveLength(0);
  });

  test('events without prev_hash do not fire OAA-R-INTEGRITY-001 even if prior hash exists', async () => {
    const e1 = makeEvent({ evidence: { hash: 'abc123' } });
    const e2 = makeEvent({ evidence: { hash: 'def456' } }); // no prev_hash
    const findings = await policyAudit([e1, e2], ctx());
    expect(findings.filter((f) => f.rule_id === 'OAA-R-INTEGRITY-001')).toHaveLength(0);
  });

  test('schema_version on each finding matches SPEC_VERSION', async () => {
    const ev = toolCall('bash', { capability: 'fs.exec' });
    const findings = await policyAudit([ev], ctx([]));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.schema_version).toBe(SCHEMA_VERSION);
    }
  });
});
