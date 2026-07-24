import { describe, expect, it } from 'bun:test';
import { BscodeAdapter, getProvenance } from './bscode.js';
import type { RolloutWireRecord } from './bscode.js';
import { AdapterError } from './errors.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RECORD: RolloutWireRecord = {
  schema_version: 'rollout-wire/v1',
  rollout_id: 'rollout-001',
  task: 'Fix the bug in the parser',
  branch_index: 0,
  temperature: 0.7,
  session_id: 'session-abc',
  tool_call_sequence: [],
  final_answer: 'Bug fixed by updating regex pattern',
  build_result: null,
  objective_score: 1,
  objective_status: 'pass',
  rank: 1,
  total_score: 95,
  provenance: {
    source: 'bscode',
    session_id: 'session-abc',
    job_id: 'job-001',
    exported_at_ms: 1700000000000,
  },
};

// ---------------------------------------------------------------------------
// toEvents tests
// ---------------------------------------------------------------------------

describe('BscodeAdapter.toEvents', () => {
  it('emits a final_answer event even with empty tool_call_sequence', () => {
    const events = BscodeAdapter.toEvents(BASE_RECORD);
    const final = events.find((e) => e.type === 'final_answer');
    expect(final).toBeDefined();
    expect(final?.actor).toBe('agent');
  });

  it('emits tool_call events for tool_call entries', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      tool_call_sequence: [
        {
          event: 'tool_call',
          data: { name: 'read_file', path: '/src/main.ts' },
          timestamp_ms: 1700000000000,
        },
      ],
    };
    const events = BscodeAdapter.toEvents(record);
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toBeDefined();
    expect(toolCall?.tool?.name).toBe('read_file');
    expect(toolCall?.actor).toBe('agent');
  });

  it('emits observation events for tool_result entries', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      tool_call_sequence: [
        {
          event: 'tool_result',
          data: { result: 'file contents here' },
          timestamp_ms: 1700000001000,
        },
      ],
    };
    const events = BscodeAdapter.toEvents(record);
    const obs = events.find((e) => e.type === 'observation');
    expect(obs).toBeDefined();
    expect(obs?.actor).toBe('tool');
  });

  it('falls back to "unknown" tool name when data.name is not a string', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      tool_call_sequence: [
        {
          event: 'tool_call',
          data: { name: 123 },
          timestamp_ms: 1700000000000,
        },
      ],
    };
    const events = BscodeAdapter.toEvents(record);
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall?.tool?.name).toBe('unknown');
  });

  it('emits build_verifier observation when build_result is present', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      build_result: {
        status: 'success',
        exitCode: 0,
        ranAtMs: 1700000005000,
      },
    };
    const events = BscodeAdapter.toEvents(record);
    const buildObs = events.filter((e) => e.observation?.source === 'build_verifier');
    expect(buildObs.length).toBe(1);
  });

  it('emits verifier observation when objective_score is 1', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      build_result: {
        status: 'success',
        exitCode: 0,
        ranAtMs: 1700000005000,
      },
      objective_score: 1,
    };
    const events = BscodeAdapter.toEvents(record);
    const verifierObs = events.filter(
      (e) => e.observation?.source === 'verifier:bscode-build-verifier',
    );
    expect(verifierObs.length).toBe(1);
  });

  it('does not emit verifier observation when objective_score is 0', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      build_result: {
        status: 'failed',
        exitCode: 1,
        ranAtMs: 1700000005000,
      },
      objective_score: 0,
    };
    const events = BscodeAdapter.toEvents(record);
    const verifierObs = events.filter(
      (e) => e.observation?.source === 'verifier:bscode-build-verifier',
    );
    expect(verifierObs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// beginRun tests
// ---------------------------------------------------------------------------

describe('BscodeAdapter.beginRun', () => {
  it('returns AuditRun with correct identifiers', () => {
    const run = BscodeAdapter.beginRun(BASE_RECORD);
    expect(run.run_id).toBe('rollout-001');
    expect(run.agent_id).toBe('bscode-agent');
    expect(run.source_adapter).toBe('bscode-rollout-v1');
    expect(run.input_format).toBe('rollout-wire/v1');
  });

  it('truncates long task descriptions to 200 characters', () => {
    const longTask = 'a'.repeat(300);
    const record: RolloutWireRecord = { ...BASE_RECORD, task: longTask };
    const run = BscodeAdapter.beginRun(record);
    expect(run.task.description.length).toBe(200);
  });

  it('event_count is 0 on beginRun', () => {
    const run = BscodeAdapter.beginRun(BASE_RECORD);
    expect(run.event_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getProvenance tests
// ---------------------------------------------------------------------------

describe('getProvenance', () => {
  it('extracts provenance fields', () => {
    const prov = getProvenance(BASE_RECORD);
    expect(prov.job_id).toBe('job-001');
    expect(prov.exported_at_ms).toBe(1700000000000);
    expect(prov.objective_status).toBe('pass');
    expect(prov.objective_score).toBe(1);
  });

  it('falls back evidence_source and redaction_version to empty string', () => {
    const record: RolloutWireRecord = {
      ...BASE_RECORD,
      provenance: {
        source: 'bscode',
        session_id: 'session-abc',
        job_id: 'job-001',
        exported_at_ms: 1700000000000,
      },
    };
    const prov = getProvenance(record);
    expect(prov.evidence_source).toBe('');
    expect(prov.redaction_version).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Validation — malformed, incomplete, and unsupported payloads
// ---------------------------------------------------------------------------

describe('BscodeAdapter — validation', () => {
  it('toEvents throws AdapterError with malformed_payload for null input', () => {
    try {
      BscodeAdapter.toEvents(null as unknown as RolloutWireRecord);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('malformed_payload');
    }
  });

  it('toEvents throws AdapterError when rollout_id is missing', () => {
    const bad = { ...BASE_RECORD, rollout_id: '' };
    try {
      BscodeAdapter.toEvents(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
      expect((e as AdapterError).message).toContain('rollout_id');
    }
  });

  it('toEvents throws AdapterError when task is missing', () => {
    const bad = { ...BASE_RECORD, task: '' };
    try {
      BscodeAdapter.toEvents(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
      expect((e as AdapterError).message).toContain('task');
    }
  });

  it('toEvents throws AdapterError when provenance is missing', () => {
    const bad = { ...BASE_RECORD, provenance: undefined };
    try {
      BscodeAdapter.toEvents(bad as unknown as RolloutWireRecord);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
      expect((e as AdapterError).message).toContain('provenance');
    }
  });

  it('toEvents throws AdapterError with unsupported_version for wrong schema_version', () => {
    const bad = {
      ...BASE_RECORD,
      schema_version: 'rollout-wire/v99',
    } as unknown as RolloutWireRecord;
    try {
      BscodeAdapter.toEvents(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('unsupported_version');
      expect((e as AdapterError).message).toContain('unsupported schema_version');
    }
  });

  it('beginRun throws the same AdapterError as toEvents for the same bad input', () => {
    const bad = { ...BASE_RECORD, rollout_id: '' };
    try {
      BscodeAdapter.beginRun(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
    }
  });

  it('AdapterError carries the adapter identifier', () => {
    const bad = { ...BASE_RECORD, rollout_id: '' };
    try {
      BscodeAdapter.toEvents(bad);
    } catch (e) {
      expect((e as AdapterError).adapter).toBe('bscode-rollout-v1');
    }
  });
});

// ---------------------------------------------------------------------------
// Adapter metadata tests
// ---------------------------------------------------------------------------

describe('BscodeAdapter metadata', () => {
  it('has correct id', () => {
    expect(BscodeAdapter.id).toBe('bscode-rollout-v1');
  });

  it('has correct version', () => {
    expect(BscodeAdapter.version).toBe('0.1.0');
  });
});
