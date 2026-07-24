import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AepV0_2Adapter,
  SUPPORTED_AEP_VERSIONS,
  getProvenance,
  toEventsBatch,
} from './aep-v0_2.js';
import type { AEPRecordInput } from './aep-v0_2.js';
import { AdapterError } from './errors.js';

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

  it('tool_call events have top-level tool_name alias (#58)', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls[0]?.tool_name).toBe('bash');
    expect(toolCalls[1]?.tool_name).toBe('write_file');
    // Confirm it matches tool.name
    for (const tc of toolCalls) {
      expect(tc.tool_name).toBe(tc.tool?.name);
    }
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
    expect(prov.runtime_version).toBe('wasmagent-js@1.4.0');
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
  it('toEvents throws an AdapterError when run_id is missing', () => {
    const bad = {
      schema_version: 'aep/v0.2',
      created_at_ms: 1700000000000,
      signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' },
    } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.toEvents(bad)).toThrow('run_id');
    try {
      AepV0_2Adapter.toEvents(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
      expect((e as AdapterError).adapter).toBe('aep-v0.2');
    }
  });

  it('toEvents throws an AdapterError when signature block is missing', () => {
    const bad = {
      schema_version: 'aep/v0.2',
      run_id: 'r1',
      created_at_ms: 1700000000000,
    } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.toEvents(bad)).toThrow('signature');
    try {
      AepV0_2Adapter.toEvents(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
    }
  });

  it('beginRun throws the same AdapterError as toEvents for the same bad input', () => {
    const bad = {
      schema_version: 'aep/v0.2',
      created_at_ms: 1700000000000,
      signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' },
    } as unknown as AEPRecordInput;
    try {
      AepV0_2Adapter.beginRun(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('missing_required_field');
      expect((e as AdapterError).message).toContain('run_id');
    }
  });

  it('toEvents throws AdapterError with unsupported_version when schema_version is unsupported', () => {
    const bad = {
      schema_version: 'aep/v99',
      run_id: 'r1',
      created_at_ms: 1700000000000,
      signature: { alg: 'ed25519', key_id: 'k1', sig: 'sig' },
    } as unknown as AEPRecordInput;
    expect(() => AepV0_2Adapter.toEvents(bad)).toThrow('unsupported schema_version');
    try {
      AepV0_2Adapter.toEvents(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as AdapterError).code).toBe('unsupported_version');
    }
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

// ---------------------------------------------------------------------------
// AEP v0.3 support (Issue #25 & #26)
// ---------------------------------------------------------------------------

describe('aep-v0_2 adapter — aep/v0.3 support', () => {
  const record = loadFixture('aep-v0.3-fixture.json');

  it('SUPPORTED_AEP_VERSIONS includes aep/v0.3', () => {
    expect(SUPPORTED_AEP_VERSIONS).toContain('aep/v0.3');
  });

  it('beginRun accepts aep/v0.3 schema_version without throwing', () => {
    const run = AepV0_2Adapter.beginRun(record);
    expect(run.run_id).toBe('run-v03-fixture-001');
    expect(run.agent_id).toBe('v03-agent');
    expect(run.model_id).toBe('claude-sonnet-4-6');
    expect(run.source_adapter).toBe('aep-v0.2');
  });

  it('toEvents accepts aep/v0.3 schema_version without throwing', () => {
    const events = AepV0_2Adapter.toEvents(record);
    expect(events.length).toBeGreaterThan(0);
  });

  it('toEvents maps side_effect_class into risk_tags', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const httpAction = events.find((e) => e.tool?.name === 'http_request');
    expect(httpAction?.tool?.risk_tags).toContain('side_effect_class:network-write');
  });

  it('toEvents maps argument_drift into risk_tags', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const httpAction = events.find((e) => e.tool?.name === 'http_request');
    expect(httpAction?.tool?.risk_tags).toContain('argument_drift:low');
  });

  it('toEvents maps approval_mode into risk_tags', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const httpAction = events.find((e) => e.tool?.name === 'http_request');
    expect(httpAction?.tool?.risk_tags).toContain('approval_mode:auto');
  });

  it('toEvents does not add v0.3 risk_tags when fields are absent', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const readAction = events.find((e) => e.tool?.name === 'read_file');
    // read_file has no taint labels and no v0.3 fields, so risk_tags should be absent
    expect(readAction?.tool?.risk_tags).toBeUndefined();
  });

  it('toEvents preserves existing taint labels alongside v0.3 fields', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const httpAction = events.find((e) => e.tool?.name === 'http_request');
    // Should contain both taint labels AND v0.3 tags
    expect(httpAction?.tool?.risk_tags).toContain('user-supplied');
    expect(httpAction?.tool?.risk_tags).toContain('network');
    expect(httpAction?.tool?.risk_tags).toContain('side_effect_class:network-write');
  });

  it('toEventsBatch works with a mix of v0.2 and v0.3 records', () => {
    const v02Record = loadFixture('aep-wasmagent-fixture.json');
    const events = toEventsBatch([v02Record, record]);
    // Should produce events from both records without error
    expect(events.length).toBeGreaterThan(3);
    // Verify hash chain continuity
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.evidence?.prev_hash).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// AEP v0.4 support (Issues #85 & #86)
// ---------------------------------------------------------------------------

describe('aep-v0_2 adapter — aep/v0.4 support', () => {
  const record = loadFixture('aep-v0.4-fixture.json');

  it('SUPPORTED_AEP_VERSIONS includes aep/v0.4', () => {
    expect(SUPPORTED_AEP_VERSIONS).toContain('aep/v0.4');
  });

  it('beginRun accepts aep/v0.4 schema_version without throwing', () => {
    const run = AepV0_2Adapter.beginRun(record);
    expect(run.run_id).toBe('run-v04-fixture-001');
    expect(run.agent_id).toBe('v04-agent');
    expect(run.model_id).toBe('claude-sonnet-4-6');
    expect(run.source_adapter).toBe('aep-v0.2');
  });

  it('toEvents accepts aep/v0.4 schema_version without throwing', () => {
    const events = AepV0_2Adapter.toEvents(record);
    expect(events.length).toBeGreaterThan(0);
  });

  it('toEvents extracts signature from dsse_envelope.signatures[0].sig', () => {
    const events = AepV0_2Adapter.toEvents(record);
    for (const ev of events) {
      // Should use the DSSE envelope signature, not the legacy record.signature.sig
      expect(ev.evidence?.signature).toBe('ZHNzZS1zaWduYXR1cmUtZm9yLXYwNC1maXh0dXJl');
    }
  });

  it('toEvents uses dsse_envelope.signatures[0].keyid as signer_key_id', () => {
    const events = AepV0_2Adapter.toEvents(record);
    for (const ev of events) {
      expect(ev.evidence?.signer_key_id).toBe('wasmagent-dsse-key-v1');
    }
  });

  it('toEvents sets attestation_format to dsse when dsse_envelope present', () => {
    const events = AepV0_2Adapter.toEvents(record);
    for (const ev of events) {
      expect(ev.evidence?.attestation_format).toBe('dsse');
    }
  });

  it('toEvents sets dsse_pre_verified to true when dsse_envelope present', () => {
    const events = AepV0_2Adapter.toEvents(record);
    for (const ev of events) {
      expect(ev.evidence?.dsse_pre_verified).toBe(true);
    }
  });

  it('toEvents maps recording_mode from actions to events', () => {
    const events = AepV0_2Adapter.toEvents(record);
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls[0]?.recording_mode).toBe('full');
    expect(toolCalls[1]?.recording_mode).toBe('delta');
    expect(toolCalls[2]?.recording_mode).toBe('validation');
  });

  it('toEvents does not set recording_mode when absent in action', () => {
    // Use the v0.3 fixture which has no recording_mode
    const v03 = loadFixture('aep-v0.3-fixture.json');
    const events = AepV0_2Adapter.toEvents(v03);
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    for (const tc of toolCalls) {
      expect(tc.recording_mode).toBeUndefined();
    }
  });

  it('toEvents does not set attestation_format when no dsse_envelope', () => {
    const v03 = loadFixture('aep-v0.3-fixture.json');
    const events = AepV0_2Adapter.toEvents(v03);
    for (const ev of events) {
      expect(ev.evidence?.attestation_format).toBeUndefined();
    }
  });

  it('toEventsBatch works with a mix of v0.3 and v0.4 records', () => {
    const v03Record = loadFixture('aep-v0.3-fixture.json');
    const events = toEventsBatch([v03Record, record]);
    expect(events.length).toBeGreaterThan(3);
    // Verify hash chain continuity
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.evidence?.prev_hash).toBeDefined();
    }
    // Verify that only v0.4 events have DSSE attestation
    const v03Events = AepV0_2Adapter.toEvents(v03Record);
    const v04Events = events.slice(v03Events.length);
    for (const ev of v04Events) {
      expect(ev.evidence?.attestation_format).toBe('dsse');
    }
  });

  it('backward compatibility: v0.2 records still work unchanged', () => {
    const v02Record = loadFixture('aep-wasmagent-fixture.json');
    const events = AepV0_2Adapter.toEvents(v02Record);
    expect(events.length).toBeGreaterThan(0);
    // No DSSE fields
    for (const ev of events) {
      expect(ev.evidence?.attestation_format).toBeUndefined();
      expect(ev.evidence?.dsse_pre_verified).toBeUndefined();
    }
  });
});
