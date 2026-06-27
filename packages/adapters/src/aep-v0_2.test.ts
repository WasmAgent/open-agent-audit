import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AepV0_2Adapter, getProvenance } from './aep-v0_2.js';
import type { AEPRecordInput } from './aep-v0_2.js';

// Fixture paths relative to the repo root — both were committed under examples/traces/
const FIXTURES_DIR = join(import.meta.dir, '../../../examples/traces');

function loadFixture(name: string): AEPRecordInput {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as AEPRecordInput;
}

// ---------------------------------------------------------------------------
// wasmagent-js fixture
// ---------------------------------------------------------------------------

describe('aep-v0_2 adapter — wasmagent-js fixture', () => {
  const record = loadFixture('aep-wasmagent-fixture.json');

  it('beginRun returns an AuditRun with correct identifiers', () => {
    const run = AepV0_2Adapter.beginRun(record);
    expect(run.run_id).toBe('run-wasmagent-fixture-001');
    expect(run.model_id).toBe('claude-sonnet-4-6');
    expect(run.source_adapter).toBe('aep-v0.2');
    expect(run.input_format).toBe('aep/v0.2');
  });

  it('toEvents emits two tool_call events (one per action)', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls.length).toBe(2);
    expect(toolCalls[0]?.tool?.name).toBe('bash');
    expect(toolCalls[1]?.tool?.name).toBe('write_file');
  });

  it('toEvents emits one policy_decision event', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const decisions = events.filter((e) => e.type === 'policy_decision');
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.policy?.decision).toBe('allow');
    expect(decisions[0]?.policy?.reason).toBe('policy-allow-tmp');
  });

  it('toEvents emits one observation event for the failed verifier', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const observations = events.filter((e) => e.type === 'observation');
    expect(observations.length).toBe(1);
    expect(observations[0]?.observation?.source).toBe('verifier:taint-fence-v1');
  });

  it('toEvents carries taint labels from write_file action into risk_tags', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const writeFile = events.find((e) => e.tool?.name === 'write_file');
    expect(writeFile?.tool?.risk_tags).toContain('user-supplied');
    expect(writeFile?.tool?.risk_tags).toContain('filesystem');
  });

  it('toEvents wires the ed25519 signature through to every event evidence block', () => {
    const events = AepV0_2Adapter.toEvents(record);
    for (const ev of events) {
      expect(ev.evidence?.signature_algorithm).toBe('ed25519');
      expect(ev.evidence?.signer_key_id).toBe('wasmagent-fixture-key-v1');
      expect(typeof ev.evidence?.signature).toBe('string');
    }
  });

  it('getProvenance extracts all four traceability fields', () => {
    const prov = getProvenance(record);
    expect(prov.repo_commit).toBe('1234567890abcdef1234567890abcdef12345678');
    expect(prov.runtime_version).toBe('wasmagent-js@1.3.4');
    expect(prov.policy_bundle_digest).toBe('a'.repeat(64));
    expect(prov.tool_manifest_digest).toBe('b'.repeat(64));
    expect(prov.model_provider).toBe('anthropic');
  });
});

// ---------------------------------------------------------------------------
// bscode fixture
// ---------------------------------------------------------------------------

describe('aep-v0_2 adapter — bscode fixture', () => {
  const record = loadFixture('aep-bscode-fixture.json');

  it('beginRun returns an AuditRun with correct identifiers', () => {
    const run = AepV0_2Adapter.beginRun(record);
    expect(run.run_id).toBe('run-bscode-fixture-001');
    expect(run.model_id).toBe('claude-sonnet-4-6');
    expect(run.source_adapter).toBe('aep-v0.2');
  });

  it('toEvents emits two tool_call events', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls.length).toBe(2);
    expect(toolCalls[0]?.tool?.name).toBe('str_replace_editor');
    expect(toolCalls[1]?.tool?.name).toBe('bash');
  });

  it('toEvents emits one policy_decision event', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const decisions = events.filter((e) => e.type === 'policy_decision');
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.policy?.decision).toBe('allow');
  });

  it('toEvents emits no observation events (all verifiers passed)', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const observations = events.filter((e) => e.type === 'observation');
    expect(observations.length).toBe(0);
  });

  it('getProvenance extracts bscode run-provenance fields (populated via buildAEPEvidence since 17cf674)', () => {
    const prov = getProvenance(record);
    expect(prov.repo_commit).toBe('abcdef1234567890abcdef1234567890abcdef12');
    expect(prov.runtime_version).toBe('bscode@0.4.2');
    expect(prov.policy_bundle_digest).toBe('e'.repeat(64));
    expect(prov.tool_manifest_digest).toBe('f'.repeat(64));
    expect(prov.model_provider).toBe('anthropic');
  });
});

// ---------------------------------------------------------------------------
// Validation — missing required fields
// ---------------------------------------------------------------------------

describe('aep-v0_2 adapter — validation', () => {
  it('toEvents throws an actionable error when run_id is missing', () => {
    const bad = { schema_version: 'aep/v0.2', created_at_ms: 1700000000000, signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' } } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.toEvents(bad)).toThrow('run_id');
  });

  it('toEvents throws an actionable error when signature block is missing', () => {
    const bad = { schema_version: 'aep/v0.2', run_id: 'r1', created_at_ms: 1700000000000 } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.toEvents(bad)).toThrow('signature');
  });

  it('beginRun throws the same error as toEvents for the same bad input', () => {
    const bad = { schema_version: 'aep/v0.2', created_at_ms: 1700000000000, signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' } } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.beginRun(bad)).toThrow('run_id');
  });

  it('toEvents throws when schema_version is unsupported', () => {
    const bad = { schema_version: 'aep/v99', run_id: 'r1', created_at_ms: 1700000000000, signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' } } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.toEvents(bad)).toThrow('unsupported schema_version');
  });
});

// ---------------------------------------------------------------------------
// getProvenance — edge cases
// ---------------------------------------------------------------------------

describe('getProvenance — edge cases', () => {
  it('returns empty object when no provenance fields are present', () => {
    const minimal: AEPRecordInput = {
      schema_version: 'aep/v0.2',
      run_id: 'r1',
      created_at_ms: 1700000000000,
      signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' },
    };
    const prov = getProvenance(minimal);
    expect(Object.keys(prov).length).toBe(0);
  });

  it('omits null parent_trace_id (does not carry null through)', () => {
    const r: AEPRecordInput = {
      schema_version: 'aep/v0.2',
      run_id: 'r1',
      created_at_ms: 1700000000000,
      parent_trace_id: null,
      signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' },
    };
    const prov = getProvenance(r);
    expect(prov.parent_trace_id).toBeUndefined();
  });
});
