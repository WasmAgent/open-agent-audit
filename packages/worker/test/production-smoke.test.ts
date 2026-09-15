import { describe, expect, it } from 'bun:test';
import {
  buildSmokeVerdicts,
  containsSecret,
  newCanaryIds,
  operationsPass,
  syntheticTrace,
  type SmokeOperation,
} from '../src/production-smoke.js';
import { createEnv } from './harness.js';

function op(id: string, pass: boolean): SmokeOperation {
  return { id, method: 'GET', path: '/', expected: 'x', actual: pass ? 'x' : 'y', pass, at: '2026-09-14T00:00:00.000Z' };
}

describe('R1 — canary identity', () => {
  it('rt- prefix marks synthetic objects and ids carry a nonce', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    const ids = newCanaryIds(now);
    expect(ids.runId).toMatch(/^rt-\d{8}T\d{6}Z-[0-9a-z]+$/);
    expect(ids.agentId).toMatch(/^rt-canary-[0-9a-z]+$/);
    expect(ids.runId.endsWith(ids.nonce)).toBe(true);
    expect(ids.agentId.endsWith(ids.nonce)).toBe(true);
  });

  it('distinct calls produce distinct canary identities', () => {
    const a = newCanaryIds(new Date('2026-09-14T12:00:00.000Z'));
    const b = newCanaryIds(new Date('2026-09-14T12:00:01.000Z'));
    expect(a.runId).not.toBe(b.runId);
    expect(a.agentId).not.toBe(b.agentId);
  });
});

describe('R1 — synthetic trace', () => {
  it('every line is a valid canonical event with canary ids embedded', () => {
    const ids = newCanaryIds(new Date('2026-09-14T12:00:00.000Z'));
    const lines = syntheticTrace(ids.runId, ids.agentId).split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const event = JSON.parse(line) as Record<string, unknown>;
      expect(event.schema_version).toBe('open-agent-audit/v0.1');
      expect(event.run_id).toBe(ids.runId);
      expect(event.agent_id).toBe(ids.agentId);
      expect(event.model_id).toBe('runtime-canary-model');
      expect(event.event_id).toBeString();
      expect(event.timestamp).toBeString();
      expect(event.type).toBeString();
      expect(event.actor).toBeString();
    }
  });

  it('uploads through the real POST /api/v1/runs pipeline into D1 + R2', async () => {
    // Light integration: the trace must be accepted by the actual ingestion
    // handler (validation, scoring, report rendering, D1 write).
    const { default: worker } = await import('../src/index.js');
    const env = createEnv({ OAA_ENV: 'production', API_KEY: 'k', TENANT_ID: 'default' });
    const ids = newCanaryIds();
    const response = await worker.fetch(
      new Request('https://example.com/api/v1/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
        body: syntheticTrace(ids.runId, ids.agentId),
      }),
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { run_id: string; status: string };
    expect(body.status).toBe('completed');

    const stored = await worker.fetch(
      new Request(`https://example.com/api/v1/runs/${body.run_id}`, {
        headers: { authorization: 'Bearer k' },
      }),
      env,
    );
    expect(stored.status).toBe(200);
    const { run } = (await stored.json()) as { run: { run_id: string; tenant_id: string } };
    expect(run.tenant_id).toBe('default');

    const report = await env.REPORTS.get(`runs/${body.run_id}/report.json`);
    expect(report).not.toBeNull();
  });
});

describe('R1 — verdict aggregation', () => {
  it('all-pass operations yield all-pass verdicts', () => {
    const ops = [op('R1-DEP-01', true), op('R1-RO-01', true), op('R1-TX-01', true), op('R1-D1-01', true)];
    expect(buildSmokeVerdicts(ops, true)).toEqual({
      deployment_identity: 'pass',
      read_only_smoke: 'pass',
      synthetic_transaction: 'pass',
      d1_state_verification: 'pass',
    });
    expect(operationsPass(ops)).toBe(true);
  });

  it('a failing operation fails its phase without failing the others', () => {
    const ops = [op('R1-DEP-01', true), op('R1-RO-01', true), op('R1-RO-02', false), op('R1-TX-01', true)];
    const verdicts = buildSmokeVerdicts(ops, false);
    expect(verdicts.read_only_smoke).toBe('fail');
    expect(verdicts.synthetic_transaction).toBe('pass');
    expect(verdicts.d1_state_verification).toBe('not_run');
  });

  it('d1 verdict is not_run when no D1 database is provided', () => {
    const verdicts = buildSmokeVerdicts([op('R1-DEP-01', true), op('R1-RO-01', true), op('R1-TX-01', true)], false);
    expect(verdicts.d1_state_verification).toBe('not_run');
  });

  it('an empty operation list fails closed', () => {
    const verdicts = buildSmokeVerdicts([], true);
    expect(verdicts.read_only_smoke).toBe('fail');
    expect(verdicts.synthetic_transaction).toBe('fail');
    expect(verdicts.d1_state_verification).toBe('fail');
  });
});

describe('R1 — credential redaction', () => {
  it('detects the API key anywhere in the artifact', () => {
    const base: Parameters<typeof containsSecret>[0] = {
      format: 'wasmagent-runtime-smoke/v1',
      repository: 'r',
      source_sha: 's',
      deployment_target: 't',
      observed: { health_status: null, environment: null, auth_mode: null, build_sha: null },
      synthetic: { tenant: 'default', run_id: null, agent_id: 'a', passport_id: null },
      operations: [],
      verdicts: {
        deployment_identity: 'pass',
        read_only_smoke: 'pass',
        synthetic_transaction: 'pass',
        d1_state_verification: 'not_run',
      },
      observed_at: '2026-09-14T00:00:00.000Z',
    };
    expect(containsSecret(base, ['supersecret'])).toBe(false);
    expect(containsSecret({ ...base, synthetic: { ...base.synthetic, run_id: 'has supersecret inside' } }, ['supersecret'])).toBe(true);
  });
});
