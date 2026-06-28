/**
 * Tests for the Langfuse export adapter.
 */

import { describe, expect, it } from 'bun:test';
import { LangfuseAdapter } from './langfuse.js';
import type { LangfuseTrace } from './langfuse.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_TRACE: LangfuseTrace = {
  id: 'trace-001',
  name: 'my-agent-trace',
  userId: 'user-42',
  createdAt: '2024-01-15T10:00:00.000Z',
  observations: [],
};

// ---------------------------------------------------------------------------
// toEvents tests
// ---------------------------------------------------------------------------

describe('LangfuseAdapter.toEvents', () => {
  it('returns empty array for trace with no observations', () => {
    const events = LangfuseAdapter.toEvents(BASE_TRACE);
    expect(events).toEqual([]);
  });

  it('maps run_id from trace.id and agent_id from userId', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-1',
          traceId: 'trace-001',
          name: 'some-span',
          type: 'SPAN',
          startTime: '2024-01-15T10:01:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.run_id).toBe('trace-001');
    expect(ev.agent_id).toBe('user-42');
  });

  it('falls back agent_id to trace name when userId is absent', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      userId: undefined,
      observations: [
        {
          id: 'obs-1',
          traceId: 'trace-001',
          name: 'span-a',
          type: 'SPAN',
          startTime: '2024-01-15T10:01:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.agent_id).toBe('my-agent-trace');
  });

  it('falls back agent_id to langfuse-agent when userId and name are absent', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      userId: undefined,
      name: undefined,
      observations: [
        {
          id: 'obs-1',
          traceId: 'trace-001',
          name: 'span-a',
          type: 'SPAN',
          startTime: '2024-01-15T10:01:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.agent_id).toBe('langfuse-agent');
  });

  it('maps GENERATION observation to model_output with token counts', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-gen-1',
          traceId: 'trace-001',
          name: 'llm-call',
          type: 'GENERATION',
          startTime: '2024-01-15T10:01:00.000Z',
          endTime: '2024-01-15T10:01:05.000Z',
          model: 'gpt-4o',
          level: 'DEFAULT',
          usage: { input: 150, output: 80, total: 230 },
          statusMessage: 'stop',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('model_output');
    expect(ev.actor).toBe('agent');
    expect(ev.model_id).toBe('gpt-4o');
    expect(ev.model_output?.token_count).toBe(230);
    expect(ev.model_output?.finish_reason).toBe('stop');
    expect(ev.timestamp).toBe('2024-01-15T10:01:00.000Z');
  });

  it('sums input+output tokens when total is absent', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-gen-2',
          traceId: 'trace-001',
          name: 'llm-call-2',
          type: 'GENERATION',
          startTime: '2024-01-15T10:02:00.000Z',
          level: 'DEFAULT',
          usage: { input: 100, output: 50 },
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('model_output');
    expect(ev.model_output?.token_count).toBe(150);
  });

  it('maps SPAN with "tool" in name to tool_call', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-tool-1',
          traceId: 'trace-001',
          name: 'execute-tool-search',
          type: 'SPAN',
          startTime: '2024-01-15T10:03:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('tool_call');
    expect(ev.actor).toBe('agent');
    expect(ev.tool?.name).toBe('execute-tool-search');
  });

  it('maps SPAN with "function" in name to tool_call', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-fn-1',
          traceId: 'trace-001',
          name: 'call-function-retrieve',
          type: 'SPAN',
          startTime: '2024-01-15T10:04:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('tool_call');
  });

  it('maps SPAN with "action" in name to tool_call', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-action-1',
          traceId: 'trace-001',
          name: 'run-action-write',
          type: 'SPAN',
          startTime: '2024-01-15T10:05:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('tool_call');
  });

  it('maps SPAN with "call" in name to tool_call', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-call-1',
          traceId: 'trace-001',
          name: 'api-call-external',
          type: 'SPAN',
          startTime: '2024-01-15T10:06:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('tool_call');
  });

  it('maps ERROR level observation to error event regardless of type', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-err-1',
          traceId: 'trace-001',
          name: 'TimeoutError',
          type: 'GENERATION',
          startTime: '2024-01-15T10:07:00.000Z',
          level: 'ERROR',
          statusMessage: 'Request timed out after 30s',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('error');
    expect(ev.actor).toBe('system');
    expect(ev.error?.kind).toBe('TimeoutError');
    expect(ev.error?.message).toBe('Request timed out after 30s');
  });

  it('uses obs.name as error.message when statusMessage is absent', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-err-2',
          traceId: 'trace-001',
          name: 'NetworkError',
          type: 'SPAN',
          startTime: '2024-01-15T10:08:00.000Z',
          level: 'ERROR',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('error');
    expect(ev.error?.message).toBe('NetworkError');
  });

  it('maps EVENT type to observation with langfuse: source prefix', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-evt-1',
          traceId: 'trace-001',
          name: 'user-feedback',
          type: 'EVENT',
          startTime: '2024-01-15T10:09:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('observation');
    expect(ev.actor).toBe('system');
    expect(ev.observation?.source).toBe('langfuse:user-feedback');
  });

  it('maps SPAN with verif in name to observation with verifier: source prefix', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-verif-1',
          traceId: 'trace-001',
          name: 'verify-output',
          type: 'SPAN',
          startTime: '2024-01-15T10:10:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('observation');
    expect(ev.observation?.source).toBe('verifier:verify-output');
  });

  it('maps SPAN with check in name to verifier observation', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-check-1',
          traceId: 'trace-001',
          name: 'check-policy',
          type: 'SPAN',
          startTime: '2024-01-15T10:11:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('observation');
    expect(ev.observation?.source).toBe('verifier:check-policy');
  });

  it('maps plain SPAN (no special name) to langfuse: observation', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-plain-1',
          traceId: 'trace-001',
          name: 'retrieval-step',
          type: 'SPAN',
          startTime: '2024-01-15T10:12:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.type).toBe('observation');
    expect(ev.observation?.source).toBe('langfuse:retrieval-step');
  });

  it('sets schema_version correctly on all events', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-1',
          traceId: 'trace-001',
          name: 'step',
          type: 'SPAN',
          startTime: '2024-01-15T10:00:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.schema_version).toBe('open-agent-audit/v0.1');
  });

  it('uses model from observation as model_id', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-model-1',
          traceId: 'trace-001',
          name: 'llm',
          type: 'GENERATION',
          startTime: '2024-01-15T10:00:00.000Z',
          model: 'claude-3-5-sonnet-20241022',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.model_id).toBe('claude-3-5-sonnet-20241022');
  });

  it('falls back model_id to unknown when obs.model absent', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-nomodel-1',
          traceId: 'trace-001',
          name: 'step',
          type: 'SPAN',
          startTime: '2024-01-15T10:00:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const [ev] = LangfuseAdapter.toEvents(trace);
    expect(ev.model_id).toBe('unknown');
  });

  it('handles multiple observations producing multiple events', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-a',
          traceId: 'trace-001',
          name: 'llm',
          type: 'GENERATION',
          startTime: '2024-01-15T10:01:00.000Z',
          level: 'DEFAULT',
          usage: { input: 10, output: 20 },
        },
        {
          id: 'obs-b',
          traceId: 'trace-001',
          name: 'run-tool-search',
          type: 'SPAN',
          startTime: '2024-01-15T10:02:00.000Z',
          level: 'DEFAULT',
        },
        {
          id: 'obs-c',
          traceId: 'trace-001',
          name: 'CrashError',
          type: 'EVENT',
          startTime: '2024-01-15T10:03:00.000Z',
          level: 'ERROR',
          statusMessage: 'crashed',
        },
      ],
    };
    const events = LangfuseAdapter.toEvents(trace);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('model_output');
    expect(events[1].type).toBe('tool_call');
    expect(events[2].type).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// beginRun tests
// ---------------------------------------------------------------------------

describe('LangfuseAdapter.beginRun', () => {
  it('returns AuditRun with correct fields', () => {
    const run = LangfuseAdapter.beginRun(BASE_TRACE);
    expect(run.schema_version).toBe('open-agent-audit/v0.1');
    expect(run.run_id).toBe('trace-001');
    expect(run.agent_id).toBe('user-42');
    expect(run.model_id).toBe('langfuse-import');
    expect(run.created_at).toBe('2024-01-15T10:00:00.000Z');
    expect(run.event_count).toBe(0);
    expect(run.source_adapter).toBe('langfuse-export-v0.1');
  });

  it('sets task description from trace name', () => {
    const run = LangfuseAdapter.beginRun(BASE_TRACE);
    expect(run.task.id).toBe('langfuse-import');
    expect(run.task.description).toBe('my-agent-trace');
    expect(run.task.risk_level).toBe('low');
  });

  it('uses fallback task description when name is absent', () => {
    const trace: LangfuseTrace = { ...BASE_TRACE, name: undefined };
    const run = LangfuseAdapter.beginRun(trace);
    expect(run.task.description).toBe('Langfuse trace import');
  });

  it('event_count reflects number of observations', () => {
    const trace: LangfuseTrace = {
      ...BASE_TRACE,
      observations: [
        {
          id: 'obs-1',
          traceId: 'trace-001',
          name: 'step',
          type: 'SPAN',
          startTime: '2024-01-15T10:01:00.000Z',
          level: 'DEFAULT',
        },
        {
          id: 'obs-2',
          traceId: 'trace-001',
          name: 'llm',
          type: 'GENERATION',
          startTime: '2024-01-15T10:02:00.000Z',
          level: 'DEFAULT',
        },
      ],
    };
    const run = LangfuseAdapter.beginRun(trace);
    expect(run.event_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Adapter metadata tests
// ---------------------------------------------------------------------------

describe('LangfuseAdapter metadata', () => {
  it('has correct id', () => {
    expect(LangfuseAdapter.id).toBe('langfuse-export-v0.1');
  });

  it('has correct version', () => {
    expect(LangfuseAdapter.version).toBe('0.1.0');
  });
});
