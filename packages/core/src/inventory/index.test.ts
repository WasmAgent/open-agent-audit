import { describe, expect, test } from 'bun:test';
import type { CanonicalEvent } from '@openagentaudit/schema';
import { inventory } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE: Omit<CanonicalEvent, 'event_id' | 'type' | 'actor' | 'timestamp'> = {
  schema_version: 'open-agent-audit/v0.1',
  run_id: 'run-1',
  agent_id: 'agent-1',
  model_id: 'model-1',
};

let _seq = 0;
function mkEvent(
  overrides: Partial<CanonicalEvent> & Pick<CanonicalEvent, 'type' | 'actor'>,
): CanonicalEvent {
  _seq++;
  return {
    ...BASE,
    event_id: `evt-${_seq}`,
    timestamp: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    ...overrides,
  } as CanonicalEvent;
}

function toolCallEvent(
  toolName: string,
  opts: {
    run_id?: string;
    capability?: string;
    risk_tags?: string[];
    timestamp?: string;
  } = {},
): CanonicalEvent {
  const ev = mkEvent({ type: 'tool_call', actor: 'agent' });
  if (opts.run_id) ev.run_id = opts.run_id;
  if (opts.timestamp) ev.timestamp = opts.timestamp;
  ev.tool = {
    name: toolName,
    ...(opts.capability !== undefined ? { capability: opts.capability } : {}),
    ...(opts.risk_tags !== undefined ? { risk_tags: opts.risk_tags } : {}),
  };
  return ev;
}

function policyEvent(
  toolName: string,
  decision: 'allow' | 'deny' | 'ask_user',
  opts: { run_id?: string } = {},
): CanonicalEvent {
  const ev = mkEvent({ type: 'policy_decision', actor: 'system' });
  if (opts.run_id) ev.run_id = opts.run_id;
  ev.tool = { name: toolName };
  ev.policy = { decision, reason: 'test' };
  return ev;
}

function errorEvent(opts: { run_id?: string; timestamp?: string } = {}): CanonicalEvent {
  const ev = mkEvent({ type: 'error', actor: 'system' });
  if (opts.run_id) ev.run_id = opts.run_id;
  if (opts.timestamp) ev.timestamp = opts.timestamp;
  ev.error = { kind: 'tool_error', message: 'something went wrong' };
  return ev;
}

function humanApprovalEvent(
  reviewerId: string,
  decision: 'approve' | 'deny' | 'escalate',
  opts: { run_id?: string; timestamp?: string } = {},
): CanonicalEvent {
  const ev = mkEvent({ type: 'human_approval', actor: 'human_reviewer' });
  if (opts.run_id) ev.run_id = opts.run_id;
  if (opts.timestamp) ev.timestamp = opts.timestamp;
  ev.human = { reviewer_id: reviewerId, decision };
  return ev;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('inventory()', () => {
  // 1. Empty events
  test('empty events returns zeroed report', async () => {
    const report = await inventory([]);
    expect(report.total_events).toBe(0);
    expect(report.tool_call_count).toBe(0);
    expect(report.policy_decision_count).toBe(0);
    expect(report.human_approval_count).toBe(0);
    expect(report.error_count).toBe(0);
    expect(report.tools).toEqual([]);
    expect(report.capabilities).toEqual([]);
    expect(report.high_risk_actions).toEqual([]);
    expect(report.human_approvals).toEqual([]);
  });

  // 2. Single tool_call
  test('single tool_call produces one tool entry with calls=1', async () => {
    const events = [toolCallEvent('read_file')];
    const report = await inventory(events);
    expect(report.tools).toHaveLength(1);
    expect(report.tools[0]!.name).toBe('read_file');
    expect(report.tools[0]!.calls).toBe(1);
    expect(report.tools[0]!.failures).toBe(0);
    expect(report.tools[0]!.denied).toBe(0);
    expect(report.tools[0]!.approved).toBe(0);
    expect(report.tool_call_count).toBe(1);
  });

  // 3. Two tool_calls with same name deduplicated
  test('two tool_calls with same name → one tool entry with calls=2', async () => {
    const events = [toolCallEvent('read_file'), toolCallEvent('read_file')];
    const report = await inventory(events);
    expect(report.tools).toHaveLength(1);
    expect(report.tools[0]!.name).toBe('read_file');
    expect(report.tools[0]!.calls).toBe(2);
  });

  // 4. error attributed to preceding tool_call in same run
  test('tool_call followed by error in same run → tool entry has failures=1', async () => {
    const events = [
      toolCallEvent('write_file', { run_id: 'run-err' }),
      errorEvent({ run_id: 'run-err' }),
    ];
    const report = await inventory(events);
    const tool = report.tools.find((t) => t.name === 'write_file');
    expect(tool).toBeDefined();
    expect(tool!.failures).toBe(1);
    expect(report.error_count).toBe(1);
  });

  // 4b. error in different run is NOT attributed to tool_call in another run
  test('error in different run does not increment failures on tool in other run', async () => {
    const events = [
      toolCallEvent('write_file', { run_id: 'run-a' }),
      errorEvent({ run_id: 'run-b' }),
    ];
    const report = await inventory(events);
    const tool = report.tools.find((t) => t.name === 'write_file');
    expect(tool!.failures).toBe(0);
    expect(report.error_count).toBe(1);
  });

  // 5. policy_decision deny
  test('policy_decision deny → tool entry has denied=1', async () => {
    const events = [
      toolCallEvent('exec', { run_id: 'run-2' }),
      policyEvent('exec', 'deny', { run_id: 'run-2' }),
    ];
    const report = await inventory(events);
    const tool = report.tools.find((t) => t.name === 'exec');
    expect(tool).toBeDefined();
    expect(tool!.denied).toBe(1);
    expect(tool!.approved).toBe(0);
    expect(report.policy_decision_count).toBe(1);
  });

  // 6. policy_decision allow
  test('policy_decision allow → tool entry has approved=1', async () => {
    const events = [
      toolCallEvent('read_file', { run_id: 'run-3' }),
      policyEvent('read_file', 'allow', { run_id: 'run-3' }),
    ];
    const report = await inventory(events);
    const tool = report.tools.find((t) => t.name === 'read_file');
    expect(tool!.approved).toBe(1);
    expect(tool!.denied).toBe(0);
  });

  // 7. high_risk tool_call followed by human_approval → has_approval=true
  test('high_risk tool_call followed by human_approval in same run → has_approval=true', async () => {
    const t1 = '2024-01-01T10:00:00.000Z';
    const t2 = '2024-01-01T10:05:00.000Z';
    const events = [
      toolCallEvent('delete_database', { run_id: 'run-hr', risk_tags: ['high_risk'], timestamp: t1 }),
      humanApprovalEvent('reviewer-1', 'approve', { run_id: 'run-hr', timestamp: t2 }),
    ];
    const report = await inventory(events);
    expect(report.high_risk_actions).toHaveLength(1);
    expect(report.high_risk_actions[0]!.tool_name).toBe('delete_database');
    expect(report.high_risk_actions[0]!.has_approval).toBe(true);
  });

  // 8. high_risk tool_call with no human_approval → has_approval=false
  test('high_risk tool_call with no human_approval → has_approval=false', async () => {
    const events = [
      toolCallEvent('delete_database', { run_id: 'run-noapproval', risk_tags: ['mutation'] }),
    ];
    const report = await inventory(events);
    expect(report.high_risk_actions).toHaveLength(1);
    expect(report.high_risk_actions[0]!.has_approval).toBe(false);
  });

  // 8b. human_approval in a DIFFERENT run does not satisfy has_approval
  test('human_approval in different run does not set has_approval=true', async () => {
    const t1 = '2024-01-01T10:00:00.000Z';
    const t2 = '2024-01-01T10:05:00.000Z';
    const tc = toolCallEvent('delete_database', { run_id: 'run-a', risk_tags: ['high_risk'], timestamp: t1 });
    tc.run_id = 'run-a';
    const ha = humanApprovalEvent('reviewer-1', 'approve', { run_id: 'run-b', timestamp: t2 });
    ha.run_id = 'run-b';
    const report = await inventory([tc, ha]);
    expect(report.high_risk_actions[0]!.has_approval).toBe(false);
  });

  // 8c. human_approval BEFORE the tool_call timestamp does not set has_approval=true
  test('human_approval before tool_call timestamp does not set has_approval=true', async () => {
    const t_early = '2024-01-01T09:00:00.000Z';
    const t_later = '2024-01-01T10:00:00.000Z';
    const ha = humanApprovalEvent('reviewer-1', 'approve', { run_id: 'run-timing', timestamp: t_early });
    const tc = toolCallEvent('delete_database', { run_id: 'run-timing', risk_tags: ['high_risk'], timestamp: t_later });
    const report = await inventory([ha, tc]);
    expect(report.high_risk_actions[0]!.has_approval).toBe(false);
  });

  // 9. human_approval event → human_approvals array has entry
  test('human_approval event is recorded in human_approvals with reviewer_id and decision', async () => {
    const events = [humanApprovalEvent('alice', 'approve', { run_id: 'run-4' })];
    const report = await inventory(events);
    expect(report.human_approvals).toHaveLength(1);
    expect(report.human_approvals[0]!.reviewer_id).toBe('alice');
    expect(report.human_approvals[0]!.decision).toBe('approve');
    expect(report.human_approval_count).toBe(1);
  });

  // 9b. human_approval with deny decision
  test('human_approval with deny decision is recorded correctly', async () => {
    const events = [humanApprovalEvent('bob', 'deny', { run_id: 'run-5' })];
    const report = await inventory(events);
    expect(report.human_approvals[0]!.reviewer_id).toBe('bob');
    expect(report.human_approvals[0]!.decision).toBe('deny');
  });

  // 10. tool with capability → capabilities array includes it
  test('tool with capability is reflected in capabilities array', async () => {
    const events = [toolCallEvent('read_file', { capability: 'filesystem' })];
    const report = await inventory(events);
    const cap = report.capabilities.find((c) => c.capability === 'filesystem');
    expect(cap).toBeDefined();
    expect(cap!.tools).toContain('read_file');
  });

  // 10b. multiple tools with same capability are grouped
  test('multiple tools with same capability are grouped under one capability entry', async () => {
    const events = [
      toolCallEvent('read_file', { capability: 'filesystem' }),
      toolCallEvent('write_file', { capability: 'filesystem' }),
    ];
    const report = await inventory(events);
    const cap = report.capabilities.find((c) => c.capability === 'filesystem');
    expect(cap).toBeDefined();
    expect(cap!.tools).toHaveLength(2);
    expect(cap!.tools).toContain('read_file');
    expect(cap!.tools).toContain('write_file');
  });

  // 10c. tool without capability does not appear in capabilities
  test('tool without capability does not appear in capabilities array', async () => {
    const events = [toolCallEvent('exec')];
    const report = await inventory(events);
    expect(report.capabilities).toHaveLength(0);
  });

  // 11. total_events matches input length
  test('total_events matches input array length', async () => {
    const events = [
      toolCallEvent('read_file'),
      policyEvent('read_file', 'allow'),
      humanApprovalEvent('reviewer-1', 'approve'),
      errorEvent(),
    ];
    const report = await inventory(events);
    expect(report.total_events).toBe(4);
  });

  // 12. Correct counts: tool_call_count, policy_decision_count, human_approval_count, error_count
  test('all event type counts are correct', async () => {
    const events = [
      toolCallEvent('tool-a'),
      toolCallEvent('tool-b'),
      policyEvent('tool-a', 'allow'),
      policyEvent('tool-b', 'deny'),
      policyEvent('tool-b', 'deny'),
      humanApprovalEvent('rev-1', 'approve'),
      errorEvent(),
    ];
    const report = await inventory(events);
    expect(report.tool_call_count).toBe(2);
    expect(report.policy_decision_count).toBe(3);
    expect(report.human_approval_count).toBe(1);
    expect(report.error_count).toBe(1);
    expect(report.total_events).toBe(7);
  });

  // 12b. capability policy_count is incremented per policy_decision for that tool
  test('capability policy_count reflects number of policy decisions for tools in that capability', async () => {
    const events = [
      toolCallEvent('read_file', { capability: 'filesystem' }),
      policyEvent('read_file', 'allow'),
      policyEvent('read_file', 'deny'),
    ];
    const report = await inventory(events);
    const cap = report.capabilities.find((c) => c.capability === 'filesystem');
    expect(cap!.policy_count).toBe(2);
  });

  // 12c. risk_tags accumulated on tool
  test('risk_tags from tool_call events are accumulated on the tool entry', async () => {
    const events = [
      toolCallEvent('exec', { risk_tags: ['high_risk', 'mutation'] }),
      toolCallEvent('exec', { risk_tags: ['network'] }),
    ];
    const report = await inventory(events);
    const tool = report.tools.find((t) => t.name === 'exec');
    expect(tool!.risk_tags).toContain('high_risk');
    expect(tool!.risk_tags).toContain('mutation');
    expect(tool!.risk_tags).toContain('network');
    // deduplicated — should not have duplicates
    expect(tool!.risk_tags.filter((t) => t === 'high_risk').length).toBe(1);
  });

  // high_risk tags coverage: all tags in HIGH_RISK_TAGS set
  test.each([
    ['human_required'],
    ['high_risk'],
    ['mutation'],
    ['filesystem'],
    ['network'],
    ['secret'],
  ])('tool with risk_tag "%s" appears in high_risk_actions', async (tag) => {
    const events = [toolCallEvent('some_tool', { risk_tags: [tag] })];
    const report = await inventory(events);
    expect(report.high_risk_actions).toHaveLength(1);
    expect(report.high_risk_actions[0]!.risk_tags).toContain(tag);
  });

  // non-high-risk tag does not create a high_risk_action
  test('tool with non-high-risk tag does not appear in high_risk_actions', async () => {
    const events = [toolCallEvent('read_file', { risk_tags: ['read_only'] })];
    const report = await inventory(events);
    expect(report.high_risk_actions).toHaveLength(0);
  });

  // multiple errors for the same tool_call only count once (activeToolPerRun cleared after first)
  test('multiple errors after one tool_call in the same run count as one failure', async () => {
    const events = [
      toolCallEvent('exec', { run_id: 'run-multi-err' }),
      errorEvent({ run_id: 'run-multi-err' }),
      errorEvent({ run_id: 'run-multi-err' }),
    ];
    const report = await inventory(events);
    const tool = report.tools.find((t) => t.name === 'exec');
    expect(tool!.failures).toBe(1);
    expect(report.error_count).toBe(2);
  });
});
