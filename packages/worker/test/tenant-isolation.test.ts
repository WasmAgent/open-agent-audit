import { describe, expect, it } from 'bun:test';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { createEnv, seedFinding, seedRun } from './harness.js';

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://example.com${path}`, init);
}

function get(env: WorkerEnv, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(req(path, { method: 'GET', headers }), env);
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Seeds tenant A plus a fully-populated decoy tenant B. */
function seedTwoTenants(env: WorkerEnv): void {
  seedRun(env, { runId: 'run-a', tenantId: 'tenant-a', riskScore: 10, eas: 90, findingCount: 1 });
  seedFinding(env, { findingId: 'find-a', runId: 'run-a', tenantId: 'tenant-a', severity: 'high' });
  seedRun(env, { runId: 'run-b', tenantId: 'tenant-b', riskScore: 99, eas: 20, findingCount: 1 });
  seedFinding(env, { findingId: 'find-b', runId: 'run-b', tenantId: 'tenant-b', severity: 'critical' });
}

describe('N2-TI — tenant isolation', () => {
  it('TI-06 single-tenant read lists only the deployment tenant', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
    seedTwoTenants(env);

    const res = await get(env, '/api/v1/runs');
    expect(res.status).toBe(200);
    const body = await json<{ runs: Array<{ run_id: string; tenant_id: string }> }>(res);
    expect(body.runs.map((r) => r.run_id)).toEqual(['run-a']);
    expect(body.runs.every((r) => r.tenant_id === 'tenant-a')).toBe(true);
  });

  it('TI-02 cross-tenant run id is not disclosed (404)', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
    seedTwoTenants(env);

    const own = await get(env, '/api/v1/runs/run-a');
    expect(own.status).toBe(200);

    const cross = await get(env, '/api/v1/runs/run-b');
    expect(cross.status).toBe(404);
  });

  it('TI-03 cross-tenant findings are not disclosed (404)', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
    seedTwoTenants(env);

    expect((await get(env, '/api/v1/runs/run-a/findings')).status).toBe(200);
    expect((await get(env, '/api/v1/runs/run-b/findings')).status).toBe(404);
  });

  it('TI-04 cross-tenant report is not disclosed (404)', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
    seedTwoTenants(env);
    await env.REPORTS.put('runs/run-b/report.md', '# secret tenant-b report');

    expect((await get(env, '/api/v1/runs/run-b/report?format=md')).status).toBe(404);
    expect((await get(env, '/api/v1/runs/run-a/report?format=md')).status).toBe(404); // no artifact

    await env.REPORTS.put('runs/run-a/report.md', '# tenant-a report');
    const ok = await get(env, '/api/v1/runs/run-a/report?format=md');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('tenant-a report');
  });

  it('TI-06 finding trends are tenant-scoped', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
    seedTwoTenants(env);

    const body = await json<{ current_open_by_severity: Record<string, number> }>(
      await get(env, '/api/v1/dashboard/finding-trends'),
    );
    expect(body.current_open_by_severity).toEqual({ high: 1 });
  });

  it('org risk rollup only aggregates the deployment tenant', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
    seedTwoTenants(env);

    const res = await get(env, '/api/v1/dashboard/org-risk-rollup');
    expect(res.status).toBe(200);
    const body = await json<{ total_runs: number; projects: Array<{ project_id: string }> }>(res);
    expect(body.total_runs).toBe(1);
    expect(body.projects).toHaveLength(1);
  });

  it('TI-05 production without auth material fails closed on every tenant surface', async () => {
    const env = createEnv({ OAA_ENV: 'production', TENANT_ID: 'tenant-a' });
    seedTwoTenants(env);

    expect((await get(env, '/api/v1/runs')).status).toBe(401);
    expect((await get(env, '/api/v1/runs/run-a')).status).toBe(401);
    expect((await get(env, '/api/v1/runs/run-a/findings')).status).toBe(401);
    expect((await get(env, '/api/v1/runs/run-a/report')).status).toBe(401);
    expect((await get(env, '/api/v1/dashboard/risk-trends')).status).toBe(401);
    expect((await get(env, '/api/v1/dashboard/finding-trends')).status).toBe(401);
    expect((await get(env, '/api/v1/dashboard/org-risk-rollup')).status).toBe(401);

    const health = await json<{ auth_mode: string }>(await get(env, '/health'));
    expect(health.auth_mode).toBe('fail_closed');
  });

  it('TI-05b production with API_KEY keeps SPA reads public but protects the rollup', async () => {
    const env = createEnv({ OAA_ENV: 'production', API_KEY: 'secret', TENANT_ID: 'tenant-a' });
    seedTwoTenants(env);

    // Reads stay public (documented) and are scoped to the deployment tenant.
    expect((await get(env, '/api/v1/runs')).status).toBe(200);
    // Cross-tenant rollup requires auth even in production with a key set.
    expect((await get(env, '/api/v1/dashboard/org-risk-rollup')).status).toBe(401);
    expect(
      (await get(env, '/api/v1/dashboard/org-risk-rollup', { Authorization: 'Bearer wrong' }))
        .status,
    ).toBe(401);
    const authed = await get(env, '/api/v1/dashboard/org-risk-rollup', {
      Authorization: 'Bearer secret',
    });
    expect(authed.status).toBe(200);
  });

  it('TI-06 multi-tenant reads require a key and bind to that key tenant', async () => {
    const env = createEnv({
      OAA_ENV: 'production',
      TENANT_API_KEYS: JSON.stringify({ 'key-a': 'tenant-a', 'key-b': 'tenant-b' }),
    });
    seedTwoTenants(env);

    expect((await get(env, '/api/v1/runs')).status).toBe(401);

    const a = await get(env, '/api/v1/runs', { Authorization: 'Bearer key-a' });
    expect(a.status).toBe(200);
    const aBody = await json<{ runs: Array<{ run_id: string }> }>(a);
    expect(aBody.runs.map((r) => r.run_id)).toEqual(['run-a']);

    const b = await get(env, '/api/v1/runs', { Authorization: 'Bearer key-b' });
    expect((await json<{ runs: Array<{ run_id: string }> }>(b)).runs.map((r) => r.run_id)).toEqual([
      'run-b',
    ]);
  });

  it('TI-08 forged tenant header cannot cross the tenant boundary', async () => {
    const env = createEnv({
      OAA_ENV: 'production',
      TENANT_API_KEYS: JSON.stringify({ 'key-a': 'tenant-a', 'key-b': 'tenant-b' }),
    });
    seedTwoTenants(env);

    // Authenticated as tenant-a, but claiming tenant-b via header.
    const cross = await get(env, '/api/v1/runs/run-b', {
      Authorization: 'Bearer key-a',
      'X-Tenant-Id': 'tenant-b',
    });
    expect(cross.status).toBe(404);

    const list = await get(env, '/api/v1/runs', {
      Authorization: 'Bearer key-a',
      'X-Tenant-Id': 'tenant-b',
    });
    expect((await json<{ runs: Array<{ tenant_id: string }> }>(list)).runs.every((r) => r.tenant_id === 'tenant-a')).toBe(true);
  });

  it('TI-05 multi-tenant rollup is scoped to the key tenant', async () => {
    const env = createEnv({
      OAA_ENV: 'production',
      TENANT_API_KEYS: JSON.stringify({ 'key-a': 'tenant-a', 'key-b': 'tenant-b' }),
    });
    seedTwoTenants(env);

    const a = await json<{ total_runs: number }>(
      await get(env, '/api/v1/dashboard/org-risk-rollup', { Authorization: 'Bearer key-a' }),
    );
    const b = await json<{ total_runs: number }>(
      await get(env, '/api/v1/dashboard/org-risk-rollup', { Authorization: 'Bearer key-b' }),
    );
    expect(a.total_runs).toBe(1);
    expect(b.total_runs).toBe(1);
  });

  it('TI-09 malformed multi-tenant key config fails closed', async () => {
    const env = createEnv({ OAA_ENV: 'production', TENANT_API_KEYS: '{not json' });
    seedTwoTenants(env);

    expect((await get(env, '/api/v1/runs')).status).toBe(401);
    expect((await get(env, '/api/v1/dashboard/org-risk-rollup')).status).toBe(401);
  });

  it('N3-TI-10..14 multi-tenant short link requires a key and binds to the key tenant', async () => {
    const env = createEnv({
      OAA_ENV: 'production',
      TENANT_API_KEYS: JSON.stringify({ 'key-a': 'tenant-a', 'key-b': 'tenant-b' }),
    });
    seedTwoTenants(env);
    await env.REPORTS.put('runs/run-a/report.html', 'tenant-a report');
    await env.REPORTS.put('runs/run-b/report.html', 'tenant-b secret report');

    // N3-TI-12 unauthenticated multi-tenant short link is refused.
    expect((await get(env, '/r/run-a')).status).toBe(401);

    // N3-TI-10 tenant A may read its own short link.
    const own = await get(env, '/r/run-a', { Authorization: 'Bearer key-a' });
    expect(own.status).toBe(200);
    expect(await own.text()).toContain('tenant-a report');

    // N3-TI-11 tenant A cannot read tenant B's short link.
    expect((await get(env, '/r/run-b', { Authorization: 'Bearer key-a' })).status).toBe(404);
    expect((await get(env, '/r/run-a', { Authorization: 'Bearer key-b' })).status).toBe(404);

    // N3-TI-14 a forged tenant header cannot widen the short-link scope.
    expect(
      (
        await get(env, '/r/run-b', {
          Authorization: 'Bearer key-a',
          'X-Tenant-Id': 'tenant-b',
        })
      ).status,
    ).toBe(404);
  });

  it('N3-TI-13 single-tenant public short link stays public', async () => {
    const env = createEnv({ TENANT_ID: 'tenant-a', OAA_ENV: 'production', API_KEY: 'secret' });
    seedTwoTenants(env);
    await env.REPORTS.put('runs/run-a/report.html', 'single-tenant report');

    const res = await get(env, '/r/run-a');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('single-tenant report');
  });
});
