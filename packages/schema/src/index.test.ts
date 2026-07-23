import { describe, expect, test } from 'bun:test';
import {
  type CanonicalEvent,
  CanonicalEventSchema,
  SPEC_VERSION,
  type TypedCanonicalEvent,
  TypedCanonicalEventSchema,
  parseEvents,
  validateEvents,
} from './index.js';

// ---------- helpers ----------

function makeBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: SPEC_VERSION,
    run_id: 'run-001',
    agent_id: 'agent-001',
    model_id: 'claude-opus-4-8',
    event_id: 'evt-001',
    timestamp: '2026-07-24T12:00:00Z',
    type: 'tool_call',
    actor: 'agent',
    ...overrides,
  };
}

// ---------- CanonicalEventSchema: existing types ----------

describe('CanonicalEventSchema', () => {
  test('accepts a valid tool_call event', () => {
    const event = makeBase({
      type: 'tool_call',
      tool: { name: 'bash', capability: 'shell.execute' },
    });
    expect(CanonicalEventSchema.parse(event)).toBeTruthy();
  });

  test('accepts a valid policy_decision event', () => {
    const event = makeBase({
      type: 'policy_decision',
      policy: { decision: 'allow', reason: 'safe' },
    });
    expect(CanonicalEventSchema.parse(event)).toBeTruthy();
  });

  test('accepts a valid human_approval event', () => {
    const event = makeBase({
      type: 'human_approval',
      human: { reviewer_id: 'rev-001', decision: 'approve' },
    });
    expect(CanonicalEventSchema.parse(event)).toBeTruthy();
  });

  test('accepts a valid error event', () => {
    const event = makeBase({
      type: 'error',
      error: { kind: 'tool_failure', message: 'timeout' },
    });
    expect(CanonicalEventSchema.parse(event)).toBeTruthy();
  });

  test('rejects an invalid event_type', () => {
    const event = makeBase({ type: 'invalid_type' });
    expect(() => CanonicalEventSchema.parse(event)).toThrow();
  });
});

// ---------- New event types ----------

describe('benchmark_result event', () => {
  test('parses with required fields', () => {
    const event = makeBase({
      type: 'benchmark_result',
      benchmark: { benchmark_name: 'SWE-bench', score: 0.42 },
    });
    const parsed = CanonicalEventSchema.parse(event);
    expect(parsed.type).toBe('benchmark_result');
    expect(parsed.benchmark?.benchmark_name).toBe('SWE-bench');
    expect(parsed.benchmark?.score).toBe(0.42);
  });

  test('parses with all optional fields', () => {
    const event = makeBase({
      type: 'benchmark_result',
      benchmark: {
        benchmark_name: 'HumanEval',
        score: 87.5,
        score_unit: 'percent',
        dataset: 'HumanEval-Plus',
        total_cases: 500,
        passed_cases: 438,
        metadata: { evaluator: 'v2.1' },
      },
    });
    const parsed = CanonicalEventSchema.parse(event);
    expect(parsed.benchmark?.score_unit).toBe('percent');
    expect(parsed.benchmark?.total_cases).toBe(500);
    expect(parsed.benchmark?.metadata?.evaluator).toBe('v2.1');
  });

  test('rejects missing benchmark payload in TypedCanonicalEventSchema', () => {
    const event = makeBase({ type: 'benchmark_result' });
    expect(CanonicalEventSchema.safeParse(event).success).toBe(true);
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('training_manifest event', () => {
  test('parses with required fields', () => {
    const event = makeBase({
      type: 'training_manifest',
      training_manifest: { dataset_hash: 'abc123' },
    });
    const parsed = CanonicalEventSchema.parse(event);
    expect(parsed.type).toBe('training_manifest');
    expect(parsed.training_manifest?.dataset_hash).toBe('abc123');
  });

  test('parses with all optional fields', () => {
    const event = makeBase({
      type: 'training_manifest',
      training_manifest: {
        dataset_hash: 'def456',
        dataset_name: 'code-corpus-v3',
        sample_count: 100_000,
        splits: ['train', 'val', 'test'],
        contamination_checked: true,
        config_hash: 'cfg789',
        metadata: { source: 'internal' },
      },
    });
    const parsed = CanonicalEventSchema.parse(event);
    expect(parsed.training_manifest?.splits).toEqual(['train', 'val', 'test']);
    expect(parsed.training_manifest?.contamination_checked).toBe(true);
  });

  test('TypedCanonicalEventSchema rejects missing training_manifest payload', () => {
    const event = makeBase({ type: 'training_manifest' });
    expect(CanonicalEventSchema.safeParse(event).success).toBe(true);
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('runtime_trace event', () => {
  test('parses with required fields', () => {
    const event = makeBase({
      type: 'runtime_trace',
      runtime_trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) },
    });
    const parsed = CanonicalEventSchema.parse(event);
    expect(parsed.type).toBe('runtime_trace');
    expect(parsed.runtime_trace?.trace_id).toBe('a'.repeat(32));
    expect(parsed.runtime_trace?.span_id).toBe('b'.repeat(16));
  });

  test('parses with all optional fields', () => {
    const event = makeBase({
      type: 'runtime_trace',
      runtime_trace: {
        trace_id: 'c'.repeat(32),
        span_id: 'd'.repeat(16),
        parent_span_id: 'e'.repeat(16),
        span_name: 'agent.think',
        duration_ms: 1234,
        attributes: { 'llm.model': 'opus', 'llm.tokens': 500 },
        status: 'ok',
      },
    });
    const parsed = CanonicalEventSchema.parse(event);
    expect(parsed.runtime_trace?.span_name).toBe('agent.think');
    expect(parsed.runtime_trace?.duration_ms).toBe(1234);
    expect(parsed.runtime_trace?.status).toBe('ok');
    expect(parsed.runtime_trace?.attributes?.['llm.model']).toBe('opus');
  });

  test('TypedCanonicalEventSchema rejects missing runtime_trace payload', () => {
    const event = makeBase({ type: 'runtime_trace' });
    expect(CanonicalEventSchema.safeParse(event).success).toBe(true);
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });
});

// ---------- TypedCanonicalEventSchema: discriminated union ----------

describe('TypedCanonicalEventSchema', () => {
  test('accepts tool_call with required tool payload', () => {
    const event = makeBase({
      type: 'tool_call',
      tool: { name: 'bash' },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects tool_call without tool payload', () => {
    const event = makeBase({ type: 'tool_call' });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts policy_decision with required policy payload', () => {
    const event = makeBase({
      type: 'policy_decision',
      policy: { decision: 'deny', reason: 'unsafe' },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects policy_decision without policy payload', () => {
    const event = makeBase({ type: 'policy_decision' });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts human_approval with required human payload', () => {
    const event = makeBase({
      type: 'human_approval',
      human: { reviewer_id: 'r1', decision: 'approve' },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects human_approval without human payload', () => {
    const event = makeBase({ type: 'human_approval' });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts error with required error payload', () => {
    const event = makeBase({
      type: 'error',
      error: { kind: 'timeout', message: '30s exceeded' },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects error without error payload', () => {
    const event = makeBase({ type: 'error' });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts benchmark_result with required benchmark payload', () => {
    const event = makeBase({
      type: 'benchmark_result',
      benchmark: { benchmark_name: 'SWE-bench', score: 0.5 },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('accepts training_manifest with required training_manifest payload', () => {
    const event = makeBase({
      type: 'training_manifest',
      training_manifest: { dataset_hash: 'h1' },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('accepts runtime_trace with required runtime_trace payload', () => {
    const event = makeBase({
      type: 'runtime_trace',
      runtime_trace: { trace_id: 't'.repeat(32), span_id: 's'.repeat(16) },
    });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('accepts observation without observation payload', () => {
    const event = makeBase({ type: 'observation' });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  test('accepts final_answer without extra payload', () => {
    const event = makeBase({ type: 'final_answer' });
    expect(TypedCanonicalEventSchema.safeParse(event).success).toBe(true);
  });
});

// ---------- parseEvents / validateEvents ----------

describe('parseEvents', () => {
  test('parses a mixed array including new event types', () => {
    const raw = [
      makeBase({ type: 'tool_call', tool: { name: 'bash' } }),
      makeBase({
        type: 'benchmark_result',
        event_id: 'evt-002',
        benchmark: { benchmark_name: 'SWE-bench', score: 0.42 },
      }),
      makeBase({
        type: 'training_manifest',
        event_id: 'evt-003',
        training_manifest: { dataset_hash: 'abc' },
      }),
      makeBase({
        type: 'runtime_trace',
        event_id: 'evt-004',
        runtime_trace: { trace_id: 't'.repeat(32), span_id: 's'.repeat(16) },
      }),
    ];
    const events = parseEvents(raw);
    expect(events).toHaveLength(4);
    expect(events[1]?.type).toBe('benchmark_result');
    expect(events[2]?.type).toBe('training_manifest');
    expect(events[3]?.type).toBe('runtime_trace');
  });

  test('throws on invalid input', () => {
    expect(() => parseEvents([{ type: 'not_a_type' }])).toThrow();
  });
});

describe('validateEvents', () => {
  test('separates valid and invalid events', () => {
    const raw = [
      makeBase({ type: 'tool_call', tool: { name: 'bash' } }),
      { type: 'bad' },
      makeBase({
        type: 'runtime_trace',
        event_id: 'evt-005',
        runtime_trace: { trace_id: 'x'.repeat(32), span_id: 'y'.repeat(16) },
      }),
    ];
    const { valid, errors } = validateEvents(raw);
    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.index).toBe(1);
  });

  test('returns empty arrays for empty input', () => {
    const { valid, errors } = validateEvents([]);
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
