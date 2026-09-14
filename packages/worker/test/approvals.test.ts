import { describe, expect, it } from 'bun:test';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { createEnv } from './harness.js';

const AUTH = { Authorization: 'Bearer secret' };

function call(
  env: WorkerEnv,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = AUTH,
): Promise<Response> {
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...headers, 'content-type': 'application/json' };
  }
  return worker.fetch(new Request(`https://example.com${path}`, init), env);
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function authedEnv(): WorkerEnv {
  return createEnv({ API_KEY: 'secret', TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
}

async function createApproval(env: WorkerEnv): Promise<string> {
  const res = await call(env, 'POST', '/api/v1/approvals', {
    agentId: 'agent-1',
    toolName: 'shell.exec',
    input: { cmd: 'ls' },
  });
  expect(res.status).toBe(201);
  const body = await json<{ id: string; status: string }>(res);
  expect(body.status).toBe('pending');
  return body.id;
}

describe('N2-AP — approval atomicity', () => {
  it('AP-01 concurrent approve vs deny yields exactly one winner', async () => {
    const env = authedEnv();
    const id = await createApproval(env);

    const [a, b] = await Promise.all([
      call(env, 'POST', `/api/v1/approvals/${id}/decision`, { decision: 'approved' }),
      call(env, 'POST', `/api/v1/approvals/${id}/decision`, { decision: 'denied' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('AP-02 100-way race yields exactly one winner', async () => {
    const env = authedEnv();
    const id = await createApproval(env);

    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        call(env, 'POST', `/api/v1/approvals/${id}/decision`, {
          decision: i % 2 === 0 ? 'approved' : 'denied',
        }),
      ),
    );
    const winners = responses.filter((r) => r.status === 200);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(99);
  });

  it('AP-03 persisted state matches the winner', async () => {
    const env = authedEnv();
    const id = await createApproval(env);

    const [winner] = await Promise.all([
      call(env, 'POST', `/api/v1/approvals/${id}/decision`, { decision: 'approved' }),
      call(env, 'POST', `/api/v1/approvals/${id}/decision`, { decision: 'denied' }),
    ]);
    const winnerBody = await json<{ status: string }>(winner);
    expect(winner.status).toBe(200);

    const fetched = await json<{ status: string; decidedAt?: string }>(
      await call(env, 'GET', `/api/v1/approvals/${id}`),
    );
    expect(fetched.status).toBe(winnerBody.status);
    expect(fetched.status).toBe('approved');
    expect(fetched.decidedAt).toBeDefined();
  });

  it('AP-04 retry is a deterministic 409 and does not change state', async () => {
    const env = authedEnv();
    const id = await createApproval(env);

    const first = await call(env, 'POST', `/api/v1/approvals/${id}/decision`, {
      decision: 'denied',
      reason: 'first',
    });
    expect(first.status).toBe(200);

    const retry = await call(env, 'POST', `/api/v1/approvals/${id}/decision`, {
      decision: 'approved',
      reason: 'retry',
    });
    expect(retry.status).toBe(409);

    const fetched = await json<{ status: string; reason?: string }>(
      await call(env, 'GET', `/api/v1/approvals/${id}`),
    );
    expect(fetched.status).toBe('denied');
    expect(fetched.reason).toBe('first');
  });

  it('AP-05 duplicate ids in a batch transition only once', async () => {
    const env = authedEnv();
    const id = await createApproval(env);

    const res = await call(env, 'POST', '/api/v1/approvals/batch', {
      decisions: [
        { id, decision: 'approved' },
        { id, decision: 'denied' },
      ],
    });
    expect(res.status).toBe(207);
    const body = await json<{ results: Array<{ id: string; status: number }> }>(res);
    expect(body.results.map((r) => r.status)).toEqual([200, 409]);
  });

  it('AP unknown id returns 404', async () => {
    const env = authedEnv();
    const res = await call(env, 'POST', '/api/v1/approvals/does-not-exist/decision', {
      decision: 'approved',
    });
    expect(res.status).toBe(404);
  });

  it('AP approvals are tenant-bound', async () => {
    const env = createEnv({
      OAA_ENV: 'production',
      TENANT_API_KEYS: JSON.stringify({ 'key-a': 'tenant-a', 'key-b': 'tenant-b' }),
    });

    const created = await worker.fetch(
      new Request('https://example.com/api/v1/approvals', {
        method: 'POST',
        headers: { Authorization: 'Bearer key-a', 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: 'agent-a', toolName: 'shell.exec' }),
      }),
      env,
    );
    const { id } = (await created.json()) as { id: string };

    // tenant-b cannot see or decide tenant-a's approval.
    const getB = await worker.fetch(
      new Request(`https://example.com/api/v1/approvals/${id}`, {
        headers: { Authorization: 'Bearer key-b' },
      }),
      env,
    );
    expect(getB.status).toBe(404);

    const decideB = await worker.fetch(
      new Request(`https://example.com/api/v1/approvals/${id}/decision`, {
        method: 'POST',
        headers: { Authorization: 'Bearer key-b', 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
      env,
    );
    expect(decideB.status).toBe(404);

    const listB = await worker.fetch(
      new Request('https://example.com/api/v1/approvals', {
        headers: { Authorization: 'Bearer key-b' },
      }),
      env,
    );
    expect(await json<{ approvals: unknown[] }>(listB).then((b) => b.approvals)).toHaveLength(0);
  });
});
