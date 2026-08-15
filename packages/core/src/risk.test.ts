import { describe, expect, test } from 'bun:test';
import type { CanonicalEvent } from '@openagentaudit/schema';
import { computeRiskScore, getEventWeight } from './risk.js';

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

// ---------------------------------------------------------------------------
// computeRiskScore tests
// ---------------------------------------------------------------------------
describe('computeRiskScore', () => {
  test('empty events list returns score 0', () => {
    const result = computeRiskScore([], 'run-1');
    expect(result.score).toBe(0);
    expect(result.runId).toBe('run-1');
  });

  test('preserves runId in result', () => {
    const result = computeRiskScore([], 'my-run-abc');
    expect(result.runId).toBe('my-run-abc');
  });

  test('single error event returns default error weight (5)', () => {
    const events = [makeEvent({ type: 'error' })];
    const result = computeRiskScore(events, 'run-2');
    expect(result.score).toBe(5);
  });

  test('multiple events accumulate scores', () => {
    const events = [
      makeEvent({ type: 'error' }),           // 5
      makeEvent({ type: 'tool_call' }),        // 1
      makeEvent({ type: 'observation' }),      // 0
    ];
    const result = computeRiskScore(events, 'run-3');
    expect(result.score).toBe(6);
  });

  test('default policy_decision deny adds base + deny extra (3+7=10)', () => {
    const events = [
      makeEvent({
        type: 'policy_decision',
        policy: { decision: 'deny', reason: 'not-allowed' },
      }),
    ];
    const result = computeRiskScore(events, 'run-4');
    expect(result.score).toBe(10);
  });

  test('policy_decision allow only adds base weight (3)', () => {
    const events = [
      makeEvent({
        type: 'policy_decision',
        policy: { decision: 'allow', reason: 'ok' },
      }),
    ];
    const result = computeRiskScore(events, 'run-5');
    expect(result.score).toBe(3);
  });

  test('custom weights override defaults', () => {
    const events = [makeEvent({ type: 'error' })];
    const result = computeRiskScore(events, 'run-6', { error: 100 });
    expect(result.score).toBe(100);
  });

  test('custom weights for unknown type key still apply', () => {
    const events = [makeEvent({ type: 'observation' })]; // default 0
    const result = computeRiskScore(events, 'run-7', { observation: 42 });
    expect(result.score).toBe(42);
  });

  test('high_risk tool tag adds extra weight on top of base', () => {
    const events = [
      makeEvent({
        type: 'tool_call',
        tool: { name: 'bash', risk_tags: ['high_risk'] },
      }),
    ];
    // base=1 + high_risk_tag=3 = 4
    const result = computeRiskScore(events, 'run-8');
    expect(result.score).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// getEventWeight tests
// ---------------------------------------------------------------------------
describe('getEventWeight', () => {
  test('returns 0 for observation with default weights', () => {
    expect(getEventWeight(makeEvent({ type: 'observation' }))).toBe(0);
  });

  test('custom weights override event type', () => {
    expect(getEventWeight(makeEvent({ type: 'error' }), { error: 99 })).toBe(99);
  });
});
