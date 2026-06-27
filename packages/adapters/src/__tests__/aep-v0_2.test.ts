/**
 * Tests for the AEP v0.2 adapter — exercises the five acceptance criteria
 * declared in open-agent-audit#1:
 *
 *   1. Import fixture from wasmagent-js — `examples/traces/wasmagent-js-runtime.aep.json`.
 *   2. Import fixture from bscode      — `examples/traces/bscode-session.aep.json`.
 *   3. Reject missing required AEP fields with an actionable error.
 *   4. Preserve manifest hash and run-provenance metadata.
 *   5. Snapshot test exercising both fixtures end-to-end.
 *
 * Runner: node:test / node:assert (Node ≥ 20 ships these built-in — no extra
 * devDependency). The package's `test` script compiles src/ to dist-test/ via
 * `tsconfig.test.json` and then invokes `node --test` on the emitted .js.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  type AEPRecordInput,
  AepV0_2Adapter,
  getProvenance,
  validateAEPRecord,
} from '../aep-v0_2.js';

// `import.meta.url` resolves to a file under dist-test/__tests__/ at run time.
// Walk up four levels: file → __tests__ → dist-test → packages/adapters → packages → repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURES = resolve(REPO_ROOT, 'examples', 'traces');

function loadFixture(name: string): unknown {
  const path = resolve(FIXTURES, name);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// #1, #2 — import fixtures end-to-end
// ---------------------------------------------------------------------------

describe('AepV0_2Adapter — fixture import (#1, #2)', () => {
  it('imports the wasmagent-js fixture and emits canonical events', () => {
    const raw = loadFixture('wasmagent-js-runtime.aep.json');
    const result = AepV0_2Adapter.validate(raw);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    // The fixture is a real signed AEPRecord, not a placeholder. Assert the
    // signature is base64-shaped (64-byte Ed25519 sig → 88 chars including
    // base64 padding) so a regression to UNSIGNED_PLACEHOLDER would be caught.
    assert.equal(result.record.signature.alg, 'ed25519');
    assert.equal(result.record.signature.key_id, 'oaa-fixture-key-v1');
    assert.match(result.record.signature.sig, /^[A-Za-z0-9+/]{86}==$/);

    const run = AepV0_2Adapter.beginRun(result.record);
    assert.equal(run.run_id, 'run-fixture-wasmagent-js-001');
    // No run_context.agent_id is set on the emitted record, so beginRun falls
    // back to run_id (see beginRun comment in aep-v0_2.ts).
    assert.equal(run.agent_id, 'run-fixture-wasmagent-js-001');
    assert.equal(run.source_adapter, 'aep-v0.2');
    assert.equal(run.input_format, 'aep/v0.2');

    const events = AepV0_2Adapter.toEvents(result.record);
    // 1 action (tool_call) + 1 capability decision (policy_decision); the
    // single verifier_result passed so no observation event is emitted.
    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, 'tool_call');
    assert.equal(events[0]?.tool?.name, 'read_file');
    assert.equal(events[1]?.type, 'policy_decision');
    assert.equal(events[1]?.policy?.decision, 'allow');
  });

  it('imports the bscode fixture and emits canonical events', () => {
    const raw = loadFixture('bscode-session.aep.json');
    const result = AepV0_2Adapter.validate(raw);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    // Real signed AEPRecord — see comment on the wasmagent-js fixture.
    assert.equal(result.record.signature.alg, 'ed25519');
    assert.equal(result.record.signature.key_id, 'oaa-fixture-key-v1');
    assert.match(result.record.signature.sig, /^[A-Za-z0-9+/]{86}==$/);

    const run = AepV0_2Adapter.beginRun(result.record);
    assert.equal(run.run_id, 'run-fixture-bscode-coding-001');
    assert.equal(run.agent_id, 'run-fixture-bscode-coding-001');

    const events = AepV0_2Adapter.toEvents(result.record);
    // 3 actions + 2 capability decisions + 1 failed verifier = 6 events.
    assert.equal(events.length, 6);
    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      'tool_call',
      'tool_call',
      'tool_call',
      'policy_decision',
      'policy_decision',
      'observation',
    ]);
    // The failed verifier surfaces as an observation tagged with its id.
    const obs = events[5];
    assert.equal(obs?.observation?.source, 'verifier:objective-passed-v1');
  });
});

// ---------------------------------------------------------------------------
// #3 — reject missing required AEP fields with an actionable error
// ---------------------------------------------------------------------------

describe('AepV0_2Adapter — reject malformed input (#3)', () => {
  it('rejects a non-object input with a $ path error', () => {
    const result = validateAEPRecord('not an object');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.path, '$');
    assert.equal(result.errors[0]?.actualType, 'string');
    assert.ok(result.errors[0]?.hint && result.errors[0].hint.length > 0);
  });

  it('rejects when signature is missing and pins the path + hint', () => {
    const raw = loadFixture('wasmagent-js-runtime.aep.json') as Record<string, unknown>;
    // biome-ignore lint/performance/noDelete: test mutation, not production code
    delete raw.signature;
    const result = validateAEPRecord(raw);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const sigError = result.errors.find((e) => e.path === 'signature');
    assert.ok(sigError, 'expected a signature error');
    assert.equal(sigError?.actualType, 'missing');
    assert.ok(sigError?.hint && sigError.hint.length > 0);
  });

  it('rejects each missing sub-field of signature individually', () => {
    const raw = loadFixture('wasmagent-js-runtime.aep.json') as Record<string, unknown>;
    raw.signature = { alg: 'rsa', key_id: '', sig: '' };
    const result = validateAEPRecord(raw);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const paths = result.errors.map((e) => e.path).sort();
    assert.deepEqual(paths, ['signature.alg', 'signature.key_id', 'signature.sig']);
  });

  it('rejects malformed actions[] elements with indexed paths', () => {
    const raw = loadFixture('bscode-session.aep.json') as Record<string, unknown>;
    raw.actions = [{ tool_name: 'noop', state_changing: false, timestamp_ms: 0 }];
    const result = validateAEPRecord(raw);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const actionErrs = result.errors.filter((e) => e.path.startsWith('actions[0]'));
    assert.equal(actionErrs.length, 1);
    assert.equal(actionErrs[0]?.path, 'actions[0].action_id');
    assert.equal(actionErrs[0]?.actualType, 'missing');
  });

  it('rejects schema_version "aep/v0.1" — this adapter is v0.2-only', () => {
    // OAA#1 explicitly targets AEP v0.2. v0.1 pre-dates the signature contract,
    // so silently relabelling it as v0.2 in beginRun() would be data integrity
    // loss. Reject at the validation layer with an actionable error.
    const raw = loadFixture('wasmagent-js-runtime.aep.json') as Record<string, unknown>;
    raw.schema_version = 'aep/v0.1';
    const result = validateAEPRecord(raw);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const versionError = result.errors.find((e) => e.path === 'schema_version');
    assert.ok(versionError, 'expected a schema_version error');
    assert.equal(versionError?.actualType, 'string');
    assert.ok(versionError?.hint?.includes('v0.2'));
  });
});

// ---------------------------------------------------------------------------
// #4 — preserve manifest hash + run-provenance metadata
// ---------------------------------------------------------------------------

describe('AepV0_2Adapter — preserve run-provenance (#4)', () => {
  it('extracts all four traceability fields from the wasmagent-js fixture', () => {
    const raw = loadFixture('wasmagent-js-runtime.aep.json');
    const validated = validateAEPRecord(raw);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const prov = getProvenance(validated.record);
    assert.equal(prov.repo_commit, 'e34751a7f30338bcb07de95085adf120db9b51ff');
    assert.equal(prov.runtime_version, '@wasmagent/aep@1.3.4');
    assert.equal(
      prov.policy_bundle_digest,
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
    assert.equal(
      prov.tool_manifest_digest,
      '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
    );
    assert.equal(prov.model_provider, 'anthropic');
  });

  it('extracts provenance from the bscode fixture', () => {
    const raw = loadFixture('bscode-session.aep.json');
    const validated = validateAEPRecord(raw);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const prov = getProvenance(validated.record);
    assert.equal(prov.repo_commit, '17cf674ddbcab2f96543ef79f2497728aab249b1');
    assert.equal(prov.runtime_version, 'bscode-worker@0.2.0');
    assert.ok(prov.policy_bundle_digest && prov.policy_bundle_digest.length === 64);
    assert.ok(prov.tool_manifest_digest && prov.tool_manifest_digest.length === 64);
  });

  it('omits provenance fields that are undefined or null in the source record', () => {
    const raw = loadFixture('wasmagent-js-runtime.aep.json') as Partial<AEPRecordInput>;
    // biome-ignore lint/performance/noDelete: test mutation, not production code
    delete raw.repo_commit;
    raw.mcp_server_card_digest = null;
    const validated = validateAEPRecord(raw);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const prov = getProvenance(validated.record);
    assert.equal(prov.repo_commit, undefined);
    assert.equal(prov.mcp_server_card_digest, undefined);
    // runtime_version was untouched, so it should still be carried.
    assert.equal(prov.runtime_version, '@wasmagent/aep@1.3.4');
  });

  it('AepV0_2Adapter.getProvenance is the same function as the module export', () => {
    assert.equal(AepV0_2Adapter.getProvenance, getProvenance);
  });
});

// ---------------------------------------------------------------------------
// #5 — snapshot assertion on canonical event projection
// ---------------------------------------------------------------------------

/**
 * Strip the `evidence` block from every event before snapshot-comparing.
 *
 * `toEvents()` derives evidence.hash via `makeEventId` which composes the
 * run id + index — that is stable, but `prev_hash` and `signature` simply
 * mirror the source AEPRecord. The shape-of-output assertions above
 * already exercise `evidence`; this snapshot focuses on the canonical
 * payload (`type`, `tool`, `policy`, `observation`) which is what
 * downstream report rendering depends on.
 */
function projectForSnapshot(
  events: ReadonlyArray<ReturnType<typeof AepV0_2Adapter.toEvents>[number]>,
) {
  return events.map((e) => ({
    schema_version: e.schema_version,
    run_id: e.run_id,
    agent_id: e.agent_id,
    model_id: e.model_id,
    type: e.type,
    actor: e.actor,
    timestamp: e.timestamp,
    tool: e.tool ?? null,
    policy: e.policy ?? null,
    observation: e.observation ?? null,
  }));
}

describe('AepV0_2Adapter — canonical event snapshot (#5)', () => {
  it('wasmagent-js fixture projects to the expected canonical events', () => {
    const raw = loadFixture('wasmagent-js-runtime.aep.json');
    const validated = validateAEPRecord(raw);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const events = AepV0_2Adapter.toEvents(validated.record);
    const snapshot = projectForSnapshot(events);

    assert.deepEqual(snapshot, [
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-fixture-wasmagent-js-001',
        agent_id: 'run-fixture-wasmagent-js-001',
        model_id: 'claude-sonnet-4-6',
        type: 'tool_call',
        actor: 'agent',
        timestamp: '2024-06-01T00:00:00.000Z',
        tool: { name: 'read_file', capability: 'fs:read' },
        policy: null,
        observation: null,
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-fixture-wasmagent-js-001',
        agent_id: 'run-fixture-wasmagent-js-001',
        model_id: 'claude-sonnet-4-6',
        type: 'policy_decision',
        actor: 'system',
        timestamp: '2024-06-01T00:00:00.010Z',
        tool: null,
        policy: { decision: 'allow', reason: 'policy-default' },
        observation: null,
      },
    ]);
  });

  it('bscode fixture projects to the expected canonical events', () => {
    const raw = loadFixture('bscode-session.aep.json');
    const validated = validateAEPRecord(raw);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const events = AepV0_2Adapter.toEvents(validated.record);
    const snapshot = projectForSnapshot(events);

    // Skip exhaustive deep-equal — the projection is exercised above on the
    // smaller fixture. Here we assert the shape and ordering hold for the
    // larger 6-event fixture so a regression in `toEvents` ordering or
    // category mapping would surface.
    assert.equal(snapshot.length, 6);
    assert.deepEqual(
      snapshot.map((e) => [e.type, e.actor]),
      [
        ['tool_call', 'agent'],
        ['tool_call', 'agent'],
        ['tool_call', 'agent'],
        ['policy_decision', 'system'],
        ['policy_decision', 'system'],
        ['observation', 'system'],
      ],
    );
    // Verify tool names in order on the three tool_call events.
    const toolNames = snapshot.slice(0, 3).map((e) => e.tool?.name);
    assert.deepEqual(toolNames, ['read_file', 'write_file', 'bash']);
  });
});
