import { describe, expect, it } from 'bun:test';
import { LangSmithAdapter } from './langsmith.js';
import type { LangSmithTrace, LangSmithRun } from './langsmith.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRACE_ID = 'trace-langsmith-001';
const TRACE_NAME = 'my-langsmith-agent';
const START_TIME = '2024-01-15T10:00:00.000Z';

function makeRun(overrides: Partial<LangSmithRun> = {}): LangSmithRun {
  return {
    id: 'run-001',
    name: 'default-run',
    run_type: 'chain',
    start_time: START_TIME,
    trace_id: TRACE_ID,
    ...overrides,
  };
}

function makeTrace(runs: LangSmithRun[], overrides: Partial<LangSmithTrace> = {}): LangSmithTrace {
  return {
    id: TRACE_ID,
    name: TRACE_NAME,
    start_time: START_TIME,
    runs,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. LLM run -> model_output with token count
// ---------------------------------------------------------------------------

describe('langsmith adapter — llm run produces model_output', () => {
  const run = makeRun({
    id: 'run-llm-001',
    name: 'gpt-4o',
    run_type: 'llm',
    extra: {
      invocation_params: { model_name: 'gpt-4o' },
    },
    outputs: {
      llm_output: {
        token_usage: { total_tokens: 250, prompt_tokens: 100, completion_tokens: 150 },
      },
      generations: [[{ text: 'Hello', generation_info: { finish_reason: 'stop' } }]],
    },
  });
  const trace = makeTrace([run]);

  it('returns exactly one event', () => {
    expect(LangSmithAdapter.toEvents(trace).length).toBe(1);
  });

  it('event type is model_output', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('model_output');
  });

  it('actor is agent', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('agent');
  });

  it('token_count is populated from llm_output.token_usage.total_tokens', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.model_output?.token_count).toBe(250);
  });

  it('finish_reason is populated from generations', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.model_output?.finish_reason).toBe('stop');
  });

  it('model_id is taken from invocation_params.model_name', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.model_id).toBe('gpt-4o');
  });

  it('event_id matches run.id', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.event_id).toBe('run-llm-001');
  });

  it('timestamp matches run.start_time', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.timestamp).toBe(START_TIME);
  });
});

// ---------------------------------------------------------------------------
// 2. Tool run -> tool_call with tool.name
// ---------------------------------------------------------------------------

describe('langsmith adapter — tool run produces tool_call', () => {
  const run = makeRun({
    id: 'run-tool-001',
    name: 'web_search',
    run_type: 'tool',
  });
  const trace = makeTrace([run]);

  it('returns exactly one event', () => {
    expect(LangSmithAdapter.toEvents(trace).length).toBe(1);
  });

  it('event type is tool_call', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('tool_call');
  });

  it('actor is agent', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('agent');
  });

  it('tool.name is taken from run.name', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.tool?.name).toBe('web_search');
  });
});

// ---------------------------------------------------------------------------
// 3. Run with error -> error event
// ---------------------------------------------------------------------------

describe('langsmith adapter — run with error produces error event', () => {
  const run = makeRun({
    id: 'run-error-001',
    name: 'failing-chain',
    run_type: 'chain',
    error: 'Connection timeout after 30s',
  });
  const trace = makeTrace([run]);

  it('event type is error', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('error');
  });

  it('actor is system', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('system');
  });

  it('error.kind is the run_type', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.error?.kind).toBe('chain');
  });

  it('error.message is the error string', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.error?.message).toBe('Connection timeout after 30s');
  });

  it('error takes priority over run_type classification', () => {
    const llmWithError = makeRun({
      id: 'run-llm-error',
      run_type: 'llm',
      error: 'rate limit exceeded',
    });
    const t = makeTrace([llmWithError]);
    const events = LangSmithAdapter.toEvents(t);
    expect(events[0]?.type).toBe('error');
    expect(events[0]?.error?.kind).toBe('llm');
  });
});

// ---------------------------------------------------------------------------
// 4. Retriever run -> observation with source
// ---------------------------------------------------------------------------

describe('langsmith adapter — retriever run produces observation', () => {
  const run = makeRun({
    id: 'run-retriever-001',
    name: 'vector-store-retriever',
    run_type: 'retriever',
  });
  const trace = makeTrace([run]);

  it('event type is observation', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('observation');
  });

  it('actor is tool', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('tool');
  });

  it('observation.source is prefixed with retriever:', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.observation?.source).toBe('retriever:vector-store-retriever');
  });
});

// ---------------------------------------------------------------------------
// 5. run_id comes from trace.id (not run.trace_id)
// ---------------------------------------------------------------------------

describe('langsmith adapter — run_id from trace.id', () => {
  it('run_id equals trace.id', () => {
    const run = makeRun({ id: 'run-abc', trace_id: 'something-else' });
    const trace = makeTrace([run], { id: 'canonical-trace-id-xyz' });
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.run_id).toBe('canonical-trace-id-xyz');
  });

  it('all events in a multi-run trace share trace.id as run_id', () => {
    const runs = [
      makeRun({ id: 'r1', run_type: 'llm' }),
      makeRun({ id: 'r2', run_type: 'tool', name: 'search' }),
      makeRun({ id: 'r3', run_type: 'retriever', name: 'retriever' }),
    ];
    const trace = makeTrace(runs, { id: 'shared-trace-456' });
    const events = LangSmithAdapter.toEvents(trace);
    expect(events.every((e) => e.run_id === 'shared-trace-456')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Empty runs -> empty array
// ---------------------------------------------------------------------------

describe('langsmith adapter — empty runs', () => {
  it('empty runs array returns empty array', () => {
    const trace = makeTrace([]);
    expect(() => LangSmithAdapter.toEvents(trace)).not.toThrow();
    expect(LangSmithAdapter.toEvents(trace)).toEqual([]);
  });

  it('beginRun with empty runs has event_count of 0', () => {
    const trace = makeTrace([]);
    const run = LangSmithAdapter.beginRun(trace);
    expect(run.event_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Chain run -> observation with chain: prefix
// ---------------------------------------------------------------------------

describe('langsmith adapter — chain run produces observation with chain prefix', () => {
  const run = makeRun({
    id: 'run-chain-001',
    name: 'qa-chain',
    run_type: 'chain',
  });
  const trace = makeTrace([run]);

  it('event type is observation', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('observation');
  });

  it('actor is agent', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('agent');
  });

  it('observation.source is prefixed with chain:', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.observation?.source).toBe('chain:qa-chain');
  });
});

// ---------------------------------------------------------------------------
// 8. Default / unknown run_type -> observation with langsmith: prefix
// ---------------------------------------------------------------------------

describe('langsmith adapter — default run_type produces observation', () => {
  const run = makeRun({
    id: 'run-embed-001',
    name: 'text-embedding-3',
    run_type: 'embedding',
  });
  const trace = makeTrace([run]);

  it('event type is observation', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('observation');
  });

  it('actor is system', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('system');
  });

  it('observation.source is prefixed with langsmith:', () => {
    const events = LangSmithAdapter.toEvents(trace);
    expect(events[0]?.observation?.source).toBe('langsmith:text-embedding-3');
  });
});

// ---------------------------------------------------------------------------
// 9. beginRun maps fields correctly
// ---------------------------------------------------------------------------

describe('langsmith adapter — beginRun', () => {
  const trace = makeTrace([makeRun(), makeRun({ id: 'run-002' })]);

  it('run_id equals trace.id', () => {
    const auditRun = LangSmithAdapter.beginRun(trace);
    expect(auditRun.run_id).toBe(TRACE_ID);
  });

  it('agent_id equals trace.name', () => {
    const auditRun = LangSmithAdapter.beginRun(trace);
    expect(auditRun.agent_id).toBe(TRACE_NAME);
  });

  it('model_id is langsmith-import', () => {
    const auditRun = LangSmithAdapter.beginRun(trace);
    expect(auditRun.model_id).toBe('langsmith-import');
  });

  it('created_at equals trace.start_time', () => {
    const auditRun = LangSmithAdapter.beginRun(trace);
    expect(auditRun.created_at).toBe(START_TIME);
  });

  it('event_count equals number of runs', () => {
    const auditRun = LangSmithAdapter.beginRun(trace);
    expect(auditRun.event_count).toBe(2);
  });

  it('source_adapter is langsmith-export-v0.1', () => {
    const auditRun = LangSmithAdapter.beginRun(trace);
    expect(auditRun.source_adapter).toBe('langsmith-export-v0.1');
  });

  it('task.description falls back when trace has no name', () => {
    const noNameTrace = makeTrace([], { name: undefined });
    const auditRun = LangSmithAdapter.beginRun(noNameTrace);
    expect(auditRun.agent_id).toBe('langsmith-agent');
    expect(auditRun.task.description).toBe('LangSmith trace import');
  });
});
