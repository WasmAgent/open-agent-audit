import { describe, expect, test } from 'bun:test';
import type { CanonicalEvent } from '@openagentaudit/schema';
import { auditDrift, driftGuard } from './index.js';
import type { DriftWindow } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;

function makeEvent(
  overrides: Partial<CanonicalEvent> & { type: CanonicalEvent['type'] },
): CanonicalEvent {
  _seq += 1;
  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'run-test',
    agent_id: 'agent-test',
    model_id: 'model-test',
    event_id: `evt-${_seq}`,
    timestamp: new Date().toISOString(),
    actor: 'agent',
    ...overrides,
  };
}

function toolCallEvent(toolName = 'bash', riskTags?: string[]): CanonicalEvent {
  return makeEvent({
    type: 'tool_call',
    tool: { name: toolName, ...(riskTags !== undefined ? { risk_tags: riskTags } : {}) },
  });
}

function observationEvent(): CanonicalEvent {
  return makeEvent({ type: 'observation' });
}

function errorEvent(): CanonicalEvent {
  return makeEvent({ type: 'error', error: { kind: 'RuntimeError', message: 'fail' } });
}

function humanApprovalEvent(): CanonicalEvent {
  return makeEvent({
    type: 'human_approval',
    actor: 'human_reviewer',
    human: { reviewer_id: 'reviewer-1', decision: 'approve' },
  });
}

function policyDecisionEvent(decision: 'allow' | 'deny' | 'ask_user' = 'deny'): CanonicalEvent {
  return makeEvent({
    type: 'policy_decision',
    policy: { decision, reason: 'rule matched' },
  });
}

function modelOutputEvent(tokenCount = 100): CanonicalEvent {
  return makeEvent({
    type: 'model_output',
    model_output: { token_count: tokenCount },
  });
}

function window(label: string, events: CanonicalEvent[]): DriftWindow {
  return { label, events };
}

function policyDecisionForTool(
  toolName: string,
  decision: 'allow' | 'deny' | 'ask_user' = 'deny',
  ruleId?: string,
): CanonicalEvent {
  return makeEvent({
    type: 'policy_decision',
    tool: { name: toolName },
    policy: {
      decision,
      reason: 'rule matched',
      ...(ruleId !== undefined ? { rule_id: ruleId } : {}),
    },
  });
}

function toolCallWithCapability(
  name: string,
  capability: string,
  riskTags?: string[],
): CanonicalEvent {
  return makeEvent({
    type: 'tool_call',
    tool: { name, capability, ...(riskTags !== undefined ? { risk_tags: riskTags } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('driftGuard', () => {
  test('identical windows → no drifted metrics, drift_score = 0', async () => {
    const events = [
      toolCallEvent('bash'),
      toolCallEvent('read_file'),
      observationEvent(),
      modelOutputEvent(50),
    ];
    const result = await driftGuard(window('A', events), window('B', [...events]));

    expect(result.drifted_metrics).toHaveLength(0);
    expect(result.drift_score).toBe(0);
  });

  test('one window all tool_calls, other all observations → tool_call_rate drifted', async () => {
    const eventsA = Array.from({ length: 10 }, () => toolCallEvent('bash'));
    const eventsB = Array.from({ length: 10 }, () => observationEvent());

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('tool_call_rate');
  });

  test('window A has many errors, window B has none → error_rate drifted', async () => {
    const eventsA = [
      ...Array.from({ length: 8 }, () => errorEvent()),
      observationEvent(),
      observationEvent(),
    ];
    const eventsB = Array.from({ length: 10 }, () => observationEvent());

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('error_rate');
  });

  test('window A has human approvals, window B has none → human_approval_rate drifted', async () => {
    const eventsA = [
      ...Array.from({ length: 8 }, () => humanApprovalEvent()),
      observationEvent(),
      observationEvent(),
    ];
    const eventsB = Array.from({ length: 10 }, () => observationEvent());

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('human_approval_rate');
  });

  test('drift_score = drifted_metrics.length / 9 * 100 (rounded)', async () => {
    // Force several metrics to drift: all tool_calls vs all errors
    const eventsA = Array.from({ length: 10 }, () => toolCallEvent('bash', ['high_risk']));
    const eventsB = Array.from({ length: 10 }, () => errorEvent());

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    const expected = Math.round((result.drifted_metrics.length / 9) * 100);
    expect(result.drift_score).toBe(expected);
  });

  test('custom threshold 0.5 → fewer metrics drift than threshold 0.1', async () => {
    const eventsA = [
      ...Array.from({ length: 6 }, () => toolCallEvent('bash')),
      ...Array.from({ length: 4 }, () => observationEvent()),
    ];
    const eventsB = [
      ...Array.from({ length: 4 }, () => toolCallEvent('bash')),
      ...Array.from({ length: 6 }, () => observationEvent()),
    ];

    const [looseResult, strictResult] = await Promise.all([
      driftGuard(window('A', eventsA), window('B', eventsB), { threshold: 0.5 }),
      driftGuard(window('A', eventsA), window('B', eventsB), { threshold: 0.1 }),
    ]);

    expect(looseResult.drifted_metrics.length).toBeLessThanOrEqual(
      strictResult.drifted_metrics.length,
    );
  });

  test('empty windows → no errors, drift_score = 0', async () => {
    const result = await driftGuard(window('A', []), window('B', []));

    expect(result.drift_score).toBe(0);
    expect(result.drifted_metrics).toHaveLength(0);
  });

  test('metrics array always has exactly 9 entries', async () => {
    const result = await driftGuard(
      window('A', [toolCallEvent()]),
      window('B', [observationEvent()]),
    );

    expect(result.metrics).toHaveLength(9);
  });

  test('each DriftMetric has name, window_a, window_b, delta, relative_delta, drifted', async () => {
    const result = await driftGuard(
      window('A', [toolCallEvent()]),
      window('B', [observationEvent()]),
    );

    for (const metric of result.metrics) {
      expect(typeof metric.name).toBe('string');
      expect(typeof metric.window_a).toBe('number');
      expect(typeof metric.window_b).toBe('number');
      expect(typeof metric.delta).toBe('number');
      expect(typeof metric.relative_delta).toBe('number');
      expect(typeof metric.drifted).toBe('boolean');
    }
  });

  test('windows field is always 2', async () => {
    const result = await driftGuard(window('A', []), window('B', []));
    expect(result.windows).toBe(2);
  });

  test('deny_rate drifted when window A has many denies and window B has none', async () => {
    const eventsA = [
      ...Array.from({ length: 8 }, () => policyDecisionEvent('deny')),
      policyDecisionEvent('allow'),
      policyDecisionEvent('allow'),
    ];
    const eventsB = Array.from({ length: 10 }, () => policyDecisionEvent('allow'));

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('deny_rate');
  });

  test('unique_tools_count drifted when window A uses many tools and window B uses one', async () => {
    const toolNames = ['bash', 'read_file', 'write_file', 'search', 'grep', 'curl'];
    const eventsA = toolNames.map((name) => toolCallEvent(name));
    const eventsB = Array.from({ length: 6 }, () => toolCallEvent('bash'));

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('unique_tools_count');
  });

  test('model_output_token_rate drifted when window A has many tokens and window B has few', async () => {
    const eventsA = Array.from({ length: 5 }, () => modelOutputEvent(1000));
    const eventsB = Array.from({ length: 5 }, () => modelOutputEvent(10));

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('model_output_token_rate');
  });

  test('high_risk_action_fraction drifted when window A all high_risk and window B has none', async () => {
    const eventsA = Array.from({ length: 10 }, () => toolCallEvent('bash', ['high_risk']));
    const eventsB = Array.from({ length: 10 }, () => toolCallEvent('read_file', []));

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('high_risk_action_fraction');
  });

  test('avg_risk_tag_count drifted when window A has many risk tags and window B has none', async () => {
    const eventsA = Array.from({ length: 10 }, () =>
      toolCallEvent('bash', ['high_risk', 'mutation', 'network']),
    );
    const eventsB = Array.from({ length: 10 }, () => toolCallEvent('read_file', []));

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    expect(result.drifted_metrics).toContain('avg_risk_tag_count');
  });

  test('delta = window_b - window_a for each metric', async () => {
    const eventsA = Array.from({ length: 10 }, () => toolCallEvent('bash'));
    const eventsB = Array.from({ length: 10 }, () => observationEvent());

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    for (const metric of result.metrics) {
      expect(metric.delta).toBeCloseTo(metric.window_b - metric.window_a, 9);
    }
  });

  test('drifted_metrics names match metrics where drifted=true', async () => {
    const eventsA = Array.from({ length: 10 }, () => toolCallEvent('bash', ['high_risk']));
    const eventsB = Array.from({ length: 10 }, () => errorEvent());

    const result = await driftGuard(window('A', eventsA), window('B', eventsB));

    const driftedFromMetrics = result.metrics
      .filter((m) => m.drifted)
      .map((m) => m.name)
      .sort();
    const driftedFromSummary = [...result.drifted_metrics].sort();

    expect(driftedFromMetrics).toEqual(driftedFromSummary);
  });
});

// ---------------------------------------------------------------------------
// auditDrift — audit-level drift detection (issue #196)
// ---------------------------------------------------------------------------

describe('auditDrift', () => {
  test('identical audits → no drift', async () => {
    const events = [toolCallEvent('bash'), policyDecisionForTool('bash', 'allow')];

    const result = await auditDrift([...events], [...events]);

    expect(result.drift_detected).toBe(false);
    expect(result.total_changes).toBe(0);
    expect(result.permission_escalations).toHaveLength(0);
    expect(result.new_tools).toHaveLength(0);
    expect(result.policy_changes).toHaveLength(0);
  });

  test('flags new tool usage (tool in current, absent in previous)', async () => {
    const previous = [toolCallEvent('bash')];
    const current = [toolCallEvent('bash'), toolCallEvent('write_file', ['mutation'])];

    const result = await auditDrift(previous, current);

    expect(result.new_tools.map((t) => t.tool)).toEqual(['write_file']);
    expect(result.new_tools[0]?.risk_tags).toContain('mutation');
    expect(result.drift_detected).toBe(true);
  });

  test('captures capability + risk_tags on a new tool', async () => {
    const previous = [toolCallEvent('bash')];
    const current = [
      toolCallEvent('bash'),
      toolCallWithCapability('curl', 'network.fetch', ['network']),
    ];

    const result = await auditDrift(previous, current);

    const newTool = result.new_tools[0];
    expect(newTool?.tool).toBe('curl');
    expect(newTool?.capability).toBe('network.fetch');
    expect(newTool?.risk_tags).toContain('network');
  });

  test('flags permission escalation deny → allow as critical', async () => {
    const previous = [policyDecisionForTool('exec', 'deny')];
    const current = [policyDecisionForTool('exec', 'allow')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(1);
    const escalation = result.permission_escalations[0];
    expect(escalation?.tool).toBe('exec');
    expect(escalation?.previous_decision).toBe('deny');
    expect(escalation?.current_decision).toBe('allow');
    expect(escalation?.severity).toBe('critical');
    // Escalations must not be double-counted as policy changes.
    expect(result.policy_changes.map((p) => p.tool)).not.toContain('exec');
  });

  test('flags permission escalation ask_user → allow as high', async () => {
    const previous = [policyDecisionForTool('deploy', 'ask_user')];
    const current = [policyDecisionForTool('deploy', 'allow')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(1);
    expect(result.permission_escalations[0]?.severity).toBe('high');
    expect(result.permission_escalations[0]?.previous_decision).toBe('ask_user');
    expect(result.permission_escalations[0]?.current_decision).toBe('allow');
  });

  test('flags permission escalation deny → ask_user as medium', async () => {
    const previous = [policyDecisionForTool('rm', 'deny')];
    const current = [policyDecisionForTool('rm', 'ask_user')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(1);
    expect(result.permission_escalations[0]?.severity).toBe('medium');
  });

  test('captures capability on an escalation', async () => {
    const previous = [
      toolCallWithCapability('exec', 'shell.execute'),
      policyDecisionForTool('exec', 'deny'),
    ];
    const current = [
      toolCallWithCapability('exec', 'shell.execute'),
      policyDecisionForTool('exec', 'allow'),
    ];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations[0]?.capability).toBe('shell.execute');
  });

  test('tightening allow → deny is a policy change, not an escalation', async () => {
    const previous = [policyDecisionForTool('exec', 'allow')];
    const current = [policyDecisionForTool('exec', 'deny')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(0);
    expect(result.policy_changes.map((p) => p.tool)).toContain('exec');
    const change = result.policy_changes[0];
    expect(change?.previous_decisions).toEqual(['allow']);
    expect(change?.current_decisions).toEqual(['deny']);
  });

  test('rule_id change with identical decisions is a policy change', async () => {
    const previous = [policyDecisionForTool('exec', 'allow', 'rule-v1')];
    const current = [policyDecisionForTool('exec', 'allow', 'rule-v2')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(0);
    expect(result.policy_changes).toHaveLength(1);
    expect(result.policy_changes[0]?.previous_rule_ids).toEqual(['rule-v1']);
    expect(result.policy_changes[0]?.current_rule_ids).toEqual(['rule-v2']);
    expect(result.policy_changes[0]?.previous_decisions).toEqual(['allow']);
    expect(result.policy_changes[0]?.current_decisions).toEqual(['allow']);
  });

  test('tool with no policy_decision in either audit produces no escalation/change', async () => {
    const previous = [toolCallEvent('bash')];
    const current = [toolCallEvent('bash')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(0);
    expect(result.policy_changes).toHaveLength(0);
    expect(result.new_tools).toHaveLength(0);
    expect(result.drift_detected).toBe(false);
  });

  test('escalation requires a prior decision — new tool with allow is new_tools only', async () => {
    const previous = [toolCallEvent('bash')];
    const current = [toolCallEvent('bash'), policyDecisionForTool('shell', 'allow')];

    const result = await auditDrift(previous, current);

    expect(result.permission_escalations).toHaveLength(0);
    // 'shell' had no policy_decision in previous → not comparable → no change row.
    expect(result.policy_changes).toHaveLength(0);
  });

  test('total_changes equals the sum of all three categories', async () => {
    const previous = [
      policyDecisionForTool('exec', 'deny'),
      policyDecisionForTool('rm', 'allow', 'rule-v1'),
      toolCallEvent('bash'),
    ];
    const current = [
      policyDecisionForTool('exec', 'allow'), // escalation
      policyDecisionForTool('rm', 'allow', 'rule-v2'), // policy change (rule_id)
      toolCallEvent('bash'),
      toolCallEvent('curl', ['network']), // new tool
    ];

    const result = await auditDrift(previous, current);

    expect(result.total_changes).toBe(
      result.permission_escalations.length + result.new_tools.length + result.policy_changes.length,
    );
    expect(result.permission_escalations).toHaveLength(1);
    expect(result.policy_changes).toHaveLength(1);
    expect(result.new_tools).toHaveLength(1);
    expect(result.drift_detected).toBe(true);
  });

  test('empty inputs → no drift', async () => {
    const result = await auditDrift([], []);

    expect(result.drift_detected).toBe(false);
    expect(result.total_changes).toBe(0);
  });

  test('report exposes the three Milestone-6 categories', async () => {
    const previous = [toolCallEvent('bash')];
    const current = [toolCallEvent('bash'), toolCallEvent('write_file')];

    const result = await auditDrift(previous, current);

    expect(result).toHaveProperty('permission_escalations');
    expect(result).toHaveProperty('new_tools');
    expect(result).toHaveProperty('policy_changes');
    expect(Array.isArray(result.permission_escalations)).toBe(true);
    expect(Array.isArray(result.new_tools)).toBe(true);
    expect(Array.isArray(result.policy_changes)).toBe(true);
  });
});
