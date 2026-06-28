import { describe, expect, it } from 'bun:test';
import { OtelAdapter } from './otel.js';
import type { OtelTrace, OtelSpan } from './otel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_NANO = 1_700_000_000_000_000_000; // arbitrary fixed timestamp

function makeSpan(overrides: Partial<OtelSpan> = {}): OtelSpan {
  return {
    trace_id: 'trace-abc-123',
    span_id: 'span-001',
    name: 'chat',
    start_time_unix_nano: BASE_NANO,
    end_time_unix_nano: BASE_NANO + 1_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal OtelTrace with one 'chat' span -> model_output event
// ---------------------------------------------------------------------------

describe('otel adapter — chat span produces model_output', () => {
  const trace: OtelTrace = {
    spans: [makeSpan({ name: 'chat' })],
  };

  it('returns exactly one event', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events.length).toBe(1);
  });

  it('event type is model_output', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('model_output');
  });

  it('actor is agent', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('agent');
  });

  it('event_id matches span_id', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.event_id).toBe('span-001');
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const events = OtelAdapter.toEvents(trace);
    const ts = events[0]?.timestamp;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('carries token counts when present in attributes', () => {
    const traceWithTokens: OtelTrace = {
      spans: [
        makeSpan({
          name: 'chat',
          attributes: {
            'gen_ai.input.tokens': 100,
            'gen_ai.output.tokens': 50,
          },
        }),
      ],
    };
    const events = OtelAdapter.toEvents(traceWithTokens);
    expect(events[0]?.model_output?.token_count).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// 2. Span with gen_ai.tool.name -> tool_call event
// ---------------------------------------------------------------------------

describe('otel adapter — gen_ai.tool.name span produces tool_call', () => {
  const trace: OtelTrace = {
    spans: [
      makeSpan({
        name: 'some-operation',
        attributes: { 'gen_ai.tool.name': 'web_search' },
      }),
    ],
  };

  it('returns exactly one event', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events.length).toBe(1);
  });

  it('event type is tool_call', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('tool_call');
  });

  it('tool.name is taken from gen_ai.tool.name attribute', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.tool?.name).toBe('web_search');
  });

  it('tool.capability is also set to gen_ai.tool.name', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.tool?.capability).toBe('web_search');
  });
});

// ---------------------------------------------------------------------------
// 3. Span with status.code = 'ERROR' -> error event
// ---------------------------------------------------------------------------

describe('otel adapter — ERROR span produces error event', () => {
  const trace: OtelTrace = {
    spans: [
      makeSpan({
        name: 'chat',
        status: { code: 'ERROR', message: 'rate limit exceeded' },
      }),
    ],
  };

  it('event type is error', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.type).toBe('error');
  });

  it('actor is system', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.actor).toBe('system');
  });

  it('error.kind is span name', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.error?.kind).toBe('chat');
  });

  it('error.message is taken from status.message', () => {
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.error?.message).toBe('rate limit exceeded');
  });

  it('error.message falls back when status.message is absent', () => {
    const traceNoMsg: OtelTrace = {
      spans: [makeSpan({ status: { code: 'ERROR' } })],
    };
    const events = OtelAdapter.toEvents(traceNoMsg);
    expect(events[0]?.error?.message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. run_id is derived from trace_id
// ---------------------------------------------------------------------------

describe('otel adapter — run_id derives from trace_id', () => {
  it('run_id equals the trace_id from the span (resource_spans form)', () => {
    const trace: OtelTrace = {
      resource_spans: [
        {
          resource: { attributes: {} },
          scope_spans: [
            {
              spans: [makeSpan({ trace_id: 'my-trace-xyz' })],
            },
          ],
        },
      ],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.run_id).toBe('my-trace-xyz');
  });

  it('run_id equals the trace_id from the span (flat spans form)', () => {
    const trace: OtelTrace = {
      spans: [makeSpan({ trace_id: 'flat-trace-999' })],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.run_id).toBe('flat-trace-999');
  });

  it('all events in a multi-span trace share the same run_id', () => {
    const trace: OtelTrace = {
      spans: [
        makeSpan({ trace_id: 'shared-trace', span_id: 's1' }),
        makeSpan({ trace_id: 'shared-trace', span_id: 's2', name: 'execute_tool' }),
      ],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.run_id).toBe('shared-trace');
    expect(events[1]?.run_id).toBe('shared-trace');
  });
});

// ---------------------------------------------------------------------------
// 5. agent_id falls back to 'otel-agent' if no service.name
// ---------------------------------------------------------------------------

describe('otel adapter — agent_id fallback', () => {
  it("agent_id is 'otel-agent' when no service.name and no gen_ai.system", () => {
    const trace: OtelTrace = {
      spans: [makeSpan({ attributes: {} })],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.agent_id).toBe('otel-agent');
  });

  it('agent_id is taken from resource service.name when present', () => {
    const trace: OtelTrace = {
      resource_spans: [
        {
          resource: { attributes: { 'service.name': 'my-ai-service' } },
          scope_spans: [
            {
              spans: [makeSpan()],
            },
          ],
        },
      ],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.agent_id).toBe('my-ai-service');
  });

  it('agent_id falls back to gen_ai.system when no service.name', () => {
    const trace: OtelTrace = {
      spans: [
        makeSpan({ attributes: { 'gen_ai.system': 'openai' } }),
      ],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events[0]?.agent_id).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// 6. OtelTrace with empty spans -> returns empty array, no error
// ---------------------------------------------------------------------------

describe('otel adapter — empty input', () => {
  it('empty spans array returns empty array', () => {
    const trace: OtelTrace = { spans: [] };
    expect(() => OtelAdapter.toEvents(trace)).not.toThrow();
    expect(OtelAdapter.toEvents(trace)).toEqual([]);
  });

  it('empty resource_spans returns empty array', () => {
    const trace: OtelTrace = { resource_spans: [] };
    expect(() => OtelAdapter.toEvents(trace)).not.toThrow();
    expect(OtelAdapter.toEvents(trace)).toEqual([]);
  });

  it('resource_spans with empty scope_spans returns empty array', () => {
    const trace: OtelTrace = {
      resource_spans: [
        {
          resource: { attributes: {} },
          scope_spans: [],
        },
      ],
    };
    expect(OtelAdapter.toEvents(trace)).toEqual([]);
  });

  it('no spans or resource_spans returns empty array', () => {
    const trace: OtelTrace = {};
    expect(OtelAdapter.toEvents(trace)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Both resource_spans and flat spans input formats work
// ---------------------------------------------------------------------------

describe('otel adapter — input format compatibility', () => {
  const SPAN_CHAT = makeSpan({ span_id: 'rs-span-1', name: 'chat', trace_id: 'trace-rs' });
  const SPAN_FLAT = makeSpan({ span_id: 'flat-span-1', name: 'chat', trace_id: 'trace-flat' });

  it('resource_spans format produces correct model_output event', () => {
    const trace: OtelTrace = {
      resource_spans: [
        {
          resource: { attributes: { 'service.name': 'svc-a' } },
          scope_spans: [{ spans: [SPAN_CHAT] }],
        },
      ],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('model_output');
    expect(events[0]?.agent_id).toBe('svc-a');
    expect(events[0]?.run_id).toBe('trace-rs');
  });

  it('flat spans format produces correct model_output event', () => {
    const trace: OtelTrace = { spans: [SPAN_FLAT] };
    const events = OtelAdapter.toEvents(trace);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('model_output');
    expect(events[0]?.run_id).toBe('trace-flat');
  });

  it('mixed format (both resource_spans and spans) processes all spans', () => {
    const trace: OtelTrace = {
      resource_spans: [
        {
          resource: { attributes: {} },
          scope_spans: [{ spans: [makeSpan({ span_id: 'r1', trace_id: 'trace-mixed' })] }],
        },
      ],
      spans: [makeSpan({ span_id: 'f1', trace_id: 'trace-mixed' })],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events.length).toBe(2);
    const ids = events.map((e) => e.event_id);
    expect(ids).toContain('r1');
    expect(ids).toContain('f1');
  });

  it('multiple scope_spans within one resource are all processed', () => {
    const trace: OtelTrace = {
      resource_spans: [
        {
          resource: { attributes: {} },
          scope_spans: [
            { spans: [makeSpan({ span_id: 'scope1-span1', trace_id: 'tr' })] },
            { spans: [makeSpan({ span_id: 'scope2-span1', trace_id: 'tr' })] },
          ],
        },
      ],
    };
    const events = OtelAdapter.toEvents(trace);
    expect(events.length).toBe(2);
  });
});
