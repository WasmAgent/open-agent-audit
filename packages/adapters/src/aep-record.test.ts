import { describe, expect, test } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020.js';
// Published contract: validate reconstructed records against the authoritative
// aep-record schema shipped in @wasmagent/protocol (not the local mirror).
import aepRecordSchema from '@wasmagent/protocol/schemas/aep/aep-record.schema.json';
import type { CanonicalEvent } from '@openagentaudit/schema';
import { fromCanonicalEvents } from './aep-record.js';
import { AepV0_2Adapter, type AEPRecordInput } from './aep-v0_2.js';

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
    timestamp: new Date(1_700_000_000_000).toISOString(),
    actor: 'agent',
    ...overrides,
  };
}

// The published schema targets draft 2020-12 — requires Ajv's 2020 entrypoint.
const ajv = new Ajv2020({ strict: false });
const validate = ajv.compile(aepRecordSchema);
function conforms(record: unknown): boolean {
  validate(record);
  return validate.errors === null;
}

// ---------------------------------------------------------------------------
// Adapter checklist tests (required by CI)
// ---------------------------------------------------------------------------
describe('aep-record adapter', () => {
  test('maps required fields', () => {
    const result = fromCanonicalEvents([makeEvent({ type: 'tool_call', tool_name: 'bash' })]);
    expect(result.schema_version).toBeDefined();
    expect(result.run_id).toBe('run-test');
    expect(result.created_at_ms).toBeGreaterThan(0);
  });

  test('rejects invalid input', () => {
    expect(() => fromCanonicalEvents(null as any)).toThrow();
    expect(() => fromCanonicalEvents([])).toThrow();
    expect(() =>
      fromCanonicalEvents([
        makeEvent({ type: 'tool_call' }),
        makeEvent({ type: 'tool_call', run_id: 'other-run' }),
      ]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Mapping contract
// ---------------------------------------------------------------------------
describe('aep-record mapping', () => {
  test('maps tool_call events to actions with derived state and taint labels', () => {
    const result = fromCanonicalEvents([
      makeEvent({
        type: 'tool_call',
        tool_name: 'bash',
        tool: { name: 'bash', risk_tags: ['input_tainted', 'side_effect_class:mutate-external'] },
      }),
    ]);
    expect(result.actions).toHaveLength(1);
    const action = result.actions![0]!;
    expect(action.tool_name).toBe('bash');
    expect(action.state_changing).toBe(true);
    expect(action.timestamp_ms).toBe(1_700_000_000_000);
    expect(action.input_taint_labels).toEqual(['input_tainted']);
    expect(action.side_effect_class).toBe('mutate-external');
  });

  test('maps policy_decision events to capability_decisions', () => {
    const result = fromCanonicalEvents([
      makeEvent({
        type: 'policy_decision',
        actor: 'system',
        policy: { decision: 'deny', reason: 'not-allowed' },
      }),
    ]);
    expect(result.capability_decisions).toEqual([
      { capability: '', subject: 'agent-test', resource: '', decision: 'deny', reason_code: 'not-allowed' },
    ]);
  });

  test('maps failed-verifier observations to verifier_results and carries the signature', () => {
    const result = fromCanonicalEvents([
      makeEvent({
        type: 'tool_call',
        evidence: { signature: 'c2ln', signature_algorithm: 'ed25519', signer_key_id: 'key-1' },
      }),
      makeEvent({
        type: 'observation',
        actor: 'system',
        observation: { source: 'verifier:output-schema' },
      }),
    ]);
    expect(result.verifier_results).toEqual([
      { verifier_id: 'output-schema', passed: false },
    ]);
    expect(result.signature).toMatchObject({ alg: 'ed25519', key_id: 'key-1', sig: 'c2ln' });
  });
});

// ---------------------------------------------------------------------------
// Conformance against the published @wasmagent/protocol schema
// ---------------------------------------------------------------------------
describe('aep-record conformance (published aep-record schema)', () => {
  test('reconstructed record from canonical events validates', () => {
    const record = fromCanonicalEvents([
      makeEvent({
        type: 'tool_call',
        tool_name: 'bash',
        tool: { name: 'bash', capability: 'shell.exec', risk_tags: ['side_effect_class:mutate-local'] },
        evidence: { signature: 'c2ln', signature_algorithm: 'ed25519', signer_key_id: 'key-1' },
        recording_mode: 'full',
      }),
      makeEvent({
        type: 'policy_decision',
        actor: 'system',
        policy: { decision: 'allow', reason: 'gated' },
      }),
      makeEvent({
        type: 'observation',
        actor: 'system',
        observation: { source: 'verifier:output-schema' },
      }),
    ]);
    expect(record.actions).toHaveLength(1);
    expect(record.capability_decisions).toHaveLength(1);
    expect(record.verifier_results).toHaveLength(1);
    expect(conforms(record)).toBe(true);
  });

  test('sample-AEP round trip: AEPRecord → canonical events → AEPRecord still conforms', () => {
    const sample: AEPRecordInput = {
      schema_version: 'aep/v0.2',
      run_id: 'aep-run-42',
      model_id: 'claude-sonnet-4',
      created_at_ms: 1_700_000_000_000,
      capability_decisions: [
        {
          capability: 'shell.exec',
          subject: 'agent-1',
          resource: '/tmp/out.txt',
          decision: 'allow',
          reason_code: 'policy-default',
        },
      ],
      actions: [
        {
          action_id: 'act-1',
          tool_name: 'bash',
          state_changing: true,
          timestamp_ms: 1_700_000_000_500,
          capability_decision: {
            capability: 'shell.exec',
            subject: 'agent-1',
            resource: '/tmp/out.txt',
            decision: 'allow',
          },
          input_taint_labels: ['user-input'],
        },
      ],
      verifier_results: [{ verifier_id: 'schema-check', passed: true }],
      signature: { alg: 'ed25519', key_id: 'key-1', sig: 'c2ln' },
    };
    const events = AepV0_2Adapter.toEvents(sample);
    const reconstructed = fromCanonicalEvents(events);
    expect(reconstructed.run_id).toBe('aep-run-42');
    expect(conforms(reconstructed)).toBe(true);
  });

  test('negative control: non-conformant record is rejected by the schema', () => {
    const record = fromCanonicalEvents([makeEvent({ type: 'tool_call' })]) as any;
    record.created_at_ms = 'not-a-number';
    expect(conforms(record)).toBe(false);
  });
});
