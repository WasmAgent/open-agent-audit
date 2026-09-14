import { describe, expect, it } from 'bun:test';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { classifyD1Error } from '../src/dependency-errors.js';
import { createEnv, seedRun } from './harness.js';

/** D1 fake whose every operation throws the configured error. */
class ThrowingD1 {
  constructor(private readonly error: Error) {}
  prepare(): never {
    throw this.error;
  }
  batch(): never {
    throw this.error;
  }
  exec(): never {
    throw this.error;
  }
}

const QUOTA_ERROR = new Error(
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
);

function envWithBrokenD1(error: Error): WorkerEnv {
  const env = createEnv({ OAA_ENV: 'production', API_KEY: 'smoke-key', TENANT_ID: 'default' });
  seedRun(env, { runId: 'run-a', tenantId: 'default' });
  env.DB = new ThrowingD1(error) as unknown as WorkerEnv['DB'];
  return env;
}

function get(env: WorkerEnv, path: string, key?: string): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${path}`, {
      method: 'GET',
      ...(key !== undefined ? { headers: { authorization: `Bearer ${key}` } } : {}),
    }),
    env,
  );
}

describe('classifyD1Error — conservative signatures', () => {
  it('classifies the observed free-tier quota error', () => {
    const failure = classifyD1Error(QUOTA_ERROR);
    expect(failure?.kind).toBe('quota_exhausted');
    expect(failure?.dependency).toBe('d1');
    expect(failure?.retryable).toBe(true);
  });

  it('classifies unavailable / timeout / rate-limit signals on D1 errors', () => {
    expect(classifyD1Error(new Error('D1_ERROR: service unavailable'))?.kind).toBe('unavailable');
    expect(classifyD1Error(new Error('D1_ERROR: query timed out'))?.kind).toBe('timeout');
    expect(classifyD1Error(new Error('D1_ERROR: rate limit exceeded'))?.kind).toBe('quota_exhausted');
  });

  it('never classifies without a D1 marker, or for SQL/schema defects', () => {
    expect(classifyD1Error(new Error('some other dependency timed out'))).toBeNull();
    expect(classifyD1Error(new Error('D1_ERROR: SQL syntax error near "FROM"'))).toBeNull();
    expect(classifyD1Error(new Error('D1_ERROR: no such column: risk_score'))).toBeNull();
    expect(classifyD1Error(new Error('UNIQUE constraint failed: audit_runs.run_id'))).toBeNull();
    expect(classifyD1Error('plain string with D1_ERROR and timeout')).not.toBeNull();
  });
});

describe('D1-ERR — structured 503 normalization at the worker boundary', () => {
  it('D1-ERR-01 quota exhaustion -> 503 dependency_unavailable, retryable, Retry-After', async () => {
    const response = await get(envWithBrokenD1(QUOTA_ERROR), '/api/v1/runs', 'smoke-key');
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'dependency_unavailable', dependency: 'd1', retryable: true });
  });

  it('D1-ERR-02 provider unavailable -> 503', async () => {
    const response = await get(
      envWithBrokenD1(new Error('D1_ERROR: service unavailable')),
      '/api/v1/runs',
      'smoke-key',
    );
    expect(response.status).toBe(503);
  });

  it('D1-ERR-03 timeout -> 503', async () => {
    const response = await get(
      envWithBrokenD1(new Error('D1_ERROR: query timed out after 30000ms')),
      '/api/v1/runs',
      'smoke-key',
    );
    expect(response.status).toBe(503);
  });

  it('D1-ERR-04 SQL syntax / application bug keeps the 500 path (rethrown, not 503)', async () => {
    const env = envWithBrokenD1(new Error('D1_ERROR: SQL syntax error near "FROM"'));
    expect(get(env, '/api/v1/runs', 'smoke-key')).rejects.toThrow(/SQL syntax/);
  });

  it('D1-ERR-05 schema invariant failure keeps the 500 path', async () => {
    const env = envWithBrokenD1(new Error('D1_ERROR: no such column: risk_score'));
    expect(get(env, '/api/v1/runs', 'smoke-key')).rejects.toThrow(/no such column/);
  });

  it('D1-ERR-06 structured 503 never contains the raw provider error', async () => {
    const response = await get(envWithBrokenD1(QUOTA_ERROR), '/api/v1/runs', 'smoke-key');
    const text = await response.text();
    expect(text).not.toContain('D1_ERROR');
    expect(text).not.toContain('free tier');
    expect(text).not.toContain('Upgrade to a paid plan');
  });

  it('D1-ERR-07 structured 503 contains no credential material', async () => {
    const response = await get(envWithBrokenD1(QUOTA_ERROR), '/api/v1/runs', 'smoke-key');
    const text = await response.text();
    expect(text).not.toContain('smoke-key');
    expect(response.headers.get('authorization')).toBeNull();
  });

  it('D1-ERR-08 auth failure is never masked: wrong key on a protected write stays 401 even with broken D1', async () => {
    const env = envWithBrokenD1(QUOTA_ERROR);
    const response = await worker.fetch(
      new Request('https://example.com/api/v1/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-key', 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );
    expect(response.status).toBe(401);
  });
});
