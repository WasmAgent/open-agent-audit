/**
 * R1 production smoke runner (WasmAgent runtime assurance).
 *
 * Executes the read-only smoke and the synthetic Passport transaction against
 * the LIVE production deployment, verifies the D1-visible state transitions,
 * and writes the `runtime-smoke.json` artifact.
 *
 * Fail-closed contract: the artifact is ALWAYS written (also on failing
 * operations, so a failed smoke leaves machine-readable evidence), the smoke
 * credential never enters the artifact (hard scan before write), and the
 * process exits non-zero on any failing verdict. Run by deploy.yml after the
 * R0 identity verification passes.
 *
 * Usage (bun):
 *   OAA_SMOKE_API_KEY=... bun packages/worker/scripts/production-smoke.ts \
 *     --base-url https://trustavo.com \
 *     --expect-sha "$GITHUB_SHA" \
 *     --expect-repository "$GITHUB_REPOSITORY" \
 *     --d1-database oaa-meta \
 *     --d1-bin ./node_modules/.bin/wrangler \
 *     --out runtime-smoke.json
 *
 * The credential is read from the OAA_SMOKE_API_KEY environment variable —
 * never from argv, so it stays out of process listings and logs.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  buildSmokeVerdicts,
  containsSecret,
  newCanaryIds,
  syntheticTrace,
  type RuntimeSmokeArtifact,
  type SmokeOperation,
} from '../src/production-smoke.js';

interface CliArgs {
  baseUrl: string;
  expectSha: string;
  expectRepository: string;
  expectTenant: string;
  d1Database: string | null;
  d1Bin: string;
  out: string;
}

const USAGE = `Usage: OAA_SMOKE_API_KEY=... bun production-smoke.ts \\
  --base-url https://trustavo.com --expect-sha <sha> --expect-repository <owner/repo> \\
  [--expect-tenant default] [--d1-database oaa-meta] [--d1-bin ./node_modules/.bin/wrangler] \\
  --out runtime-smoke.json`;

function parseArgs(argv: string[]): CliArgs | null {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !flag.startsWith('--')) return null;
    args[flag.slice(2)] = value;
  }
  if (
    args['base-url'] === undefined ||
    args['expect-sha'] === undefined ||
    args['expect-repository'] === undefined ||
    args.out === undefined
  ) {
    return null;
  }
  return {
    baseUrl: args['base-url'].replace(/\/$/, ''),
    expectSha: args['expect-sha'],
    expectRepository: args['expect-repository'],
    expectTenant: args['expect-tenant'] ?? process.env.OAA_SMOKE_TENANT ?? 'default',
    d1Database: args['d1-database'] ?? null,
    d1Bin: args['d1-bin'] ?? './node_modules/.bin/wrangler',
    out: args.out,
  };
}

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

class Smoke {
  readonly operations: SmokeOperation[] = [];

  record(
    id: string,
    method: string,
    path: string,
    expected: string,
    actual: string,
    pass: boolean,
    detail?: string,
  ): void {
    const operation: SmokeOperation = {
      id,
      method,
      path,
      expected,
      actual,
      pass,
      at: new Date().toISOString(),
    };
    if (detail !== undefined) operation.detail = detail;
    this.operations.push(operation);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${method} ${path} — expected ${expected}, got ${actual}${detail ? ` (${detail})` : ''}`);
  }
}

/** One authenticated (or deliberately unauthenticated) HTTP operation. */
async function call(
  baseUrl: string,
  op: Smoke,
  id: string,
  method: string,
  path: string,
  expectedStatus: number,
  options: { key?: 'none' | 'invalid' | 'valid'; body?: string } = {},
): Promise<{ status: number; body: string } | null> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = process.env.OAA_SMOKE_API_KEY ?? '';
  if (options.key === 'valid') headers.authorization = `Bearer ${key}`;
  if (options.key === 'invalid') headers.authorization = 'Bearer rt-invalid-smoke-key';

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    const status = response.status;
    op.record(id, method, path, String(expectedStatus), String(status), status === expectedStatus, snippet(body));
    return { status, body };
  } catch (error) {
    op.record(id, method, path, String(expectedStatus), 'network_error', false, String(error));
    return null;
  }
}

interface D1Row {
  results: Array<Record<string, unknown>>;
}

/** Query the remote D1 database through the local/CI wrangler binary. */
function d1Query(bin: string, database: string, sql: string): D1Row[] | null {
  try {
    const output = execFileSync(bin, ['d1', 'execute', database, '--remote', '--json', '--command', sql], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start === -1 || end === -1) return null;
    return JSON.parse(output.slice(start, end + 1)) as D1Row[];
  } catch (error) {
    console.log(`D1 query failed: ${String(error)}`);
    return null;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OAA_SMOKE_API_KEY ?? '';
  if (args === null || apiKey === '') {
    console.error(USAGE);
    return 2;
  }
  const smoke = new Smoke();
  const canary = newCanaryIds();
  const unknownId = crypto.randomUUID();
  let passportId: string | null = null;
  console.log(`R1 smoke: canary run ${canary.runId}, agent ${canary.agentId}`);

  // --- Deployment identity (R1-DEP) — the revision under test must be known ---
  const health = await call(args.baseUrl, smoke, 'R1-DEP-01', 'GET', '/health', 200, { key: 'none' });
  let healthBody: Record<string, unknown> = {};
  if (health !== null) {
    try {
      healthBody = JSON.parse(health.body) as Record<string, unknown>;
    } catch {
      /* malformed health → identity verdict fails via the checks below */
    }
  }
  const build = (healthBody.build ?? {}) as Record<string, unknown>;
  smoke.record(
    'R1-DEP-02', 'GET', '/health', 'status=ok,env=production',
    `status=${String(healthBody.status)},env=${String(healthBody.env)}`,
    healthBody.status === 'ok' && healthBody.env === 'production',
  );
  smoke.record(
    'R1-DEP-03', 'GET', '/health', `build.sha=${args.expectSha}`,
    `build.sha=${String(build.sha)}`, build.sha === args.expectSha,
  );
  const authMode = String(healthBody.auth_mode);
  smoke.record('R1-DEP-04', 'GET', '/health', 'auth_mode!=open', `auth_mode=${authMode}`, authMode !== 'open' && authMode !== 'undefined');

  // --- Read-only smoke (R1-RO) ---
  //
  // Documented read matrix (TI-05b): keyed single-tenant deployments serve
  // public SPA reads scoped to the deployment tenant; multi-tenant deployments
  // require a key on every read. Writes and the cross-project rollup are
  // protected in every mode. Expectations below are derived from the live
  // auth_mode so the smoke states the contract it is asserting.
  const multiTenant = authMode === 'multi_tenant';
  const publicReadExpected = multiTenant ? 401 : 200;
  const publicReadNote = multiTenant
    ? 'multi-tenant: reads require a key'
    : 'single-tenant documented public SPA read (TI-05b)';

  await call(args.baseUrl, smoke, 'R1-RO-01', 'GET', '/api/v1/runs', publicReadExpected, { key: 'none' });
  await call(args.baseUrl, smoke, 'R1-RO-02', 'GET', '/api/v1/dashboard/org-risk-rollup', 401, { key: 'none' });
  const runs = await call(args.baseUrl, smoke, 'R1-RO-03', 'GET', '/api/v1/runs', 200, { key: 'valid' });
  if (runs !== null && runs.status === 200) {
    const parsed = JSON.parse(runs.body) as { runs?: unknown[] };
    smoke.record('R1-RO-03b', 'GET', '/api/v1/runs', 'runs array', Array.isArray(parsed.runs) ? `array(${parsed.runs.length})` : 'missing', Array.isArray(parsed.runs));
  }
  await call(args.baseUrl, smoke, 'R1-RO-04', 'GET', '/api/v1/dashboard/org-risk-rollup', 401, { key: 'invalid' });
  await call(args.baseUrl, smoke, 'R1-RO-05', 'POST', '/api/v1/runs', 401, { key: 'none', body: 'x' });
  await call(args.baseUrl, smoke, 'R1-RO-06', 'GET', `/api/v1/runs/${unknownId}`, 404, { key: 'valid' });
  await call(args.baseUrl, smoke, 'R1-RO-07', 'POST', `/passport/${unknownId}/revoke`, 401, { key: 'none', body: '{"reason":"rt-canary"}' });
  await call(args.baseUrl, smoke, 'R1-RO-08', 'POST', `/passport/${unknownId}/renew`, 401, { key: 'none' });
  await call(args.baseUrl, smoke, 'R1-RO-09', 'GET', `/passport/${unknownId}/status`, 404, { key: 'none' });
  console.log(`R1-RO-01 expectation: ${publicReadNote}`);

  // --- Synthetic transaction (R1-TX): canary run → Passport → revoke ---
  const created = await call(args.baseUrl, smoke, 'R1-TX-01', 'POST', '/api/v1/runs', 201, {
    key: 'valid',
    body: syntheticTrace(canary.runId, canary.agentId),
  });
  let runId: string | null = null;
  if (created !== null && created.status === 201) {
    try {
      runId = (JSON.parse(created.body) as { run_id?: string }).run_id ?? null;
    } catch {
      /* handled below */
    }
  }
  smoke.record('R1-TX-01b', 'POST', '/api/v1/runs', 'run_id issued', runId ?? 'missing', runId !== null);

  if (runId === null) {
    smoke.record('R1-TX-02', 'GET', '/api/v1/runs/:id', 'skipped: no run', 'skipped', false);
    smoke.record('R1-TX-03', 'POST', '/passport/issue', 'skipped: no run', 'skipped', false);
  } else {
    const stored = await call(args.baseUrl, smoke, 'R1-TX-02', 'GET', `/api/v1/runs/${runId}`, 200, { key: 'valid' });
    if (stored !== null && stored.status === 200) {
      const row = (JSON.parse(stored.body) as { run?: { status?: string } }).run;
      smoke.record('R1-TX-02b', 'GET', `/api/v1/runs/${runId}`, 'status=completed', `status=${String(row?.status)}`, row?.status === 'completed');
    }

    const issued = await call(args.baseUrl, smoke, 'R1-TX-03', 'POST', '/passport/issue', 201, {
      key: 'valid',
      body: JSON.stringify({ runId, agentId: canary.agentId, agentName: 'Runtime Canary', validityDays: 30 }),
    });
    let issuedId: string | null = null;
    if (issued !== null && issued.status === 201) {
      try {
        issuedId = (JSON.parse(issued.body) as { identity?: { passport_id?: string } }).identity?.passport_id ?? null;
      } catch {
        /* handled below */
      }
    }
    passportId = issuedId;
    smoke.record('R1-TX-03b', 'POST', '/passport/issue', 'passport_id issued', passportId ?? 'missing', passportId !== null);

    if (passportId !== null) {
      await call(args.baseUrl, smoke, 'R1-TX-04', 'GET', `/passport/${passportId}`, 200, { key: 'none' });
      const active = await call(args.baseUrl, smoke, 'R1-TX-05', 'GET', `/passport/${passportId}/status`, 200, { key: 'none' });
      if (active !== null && active.status === 200) {
        const status = (JSON.parse(active.body) as { status?: string }).status;
        // 'valid' is the deployment's ACTIVE summary for an unrevoked passport.
        smoke.record('R1-TX-05b', 'GET', `/passport/${passportId}/status`, 'status=valid (ACTIVE)', `status=${String(status)}`, status === 'valid');
      }

      await call(args.baseUrl, smoke, 'R1-TX-06', 'POST', `/passport/${passportId}/revoke`, 200, {
        key: 'valid',
        body: '{"reason":"runtime-canary revoke"}',
      });

      const revoked = await call(args.baseUrl, smoke, 'R1-TX-07', 'GET', `/passport/${passportId}/status`, 200, { key: 'none' });
      if (revoked !== null && revoked.status === 200) {
        const status = (JSON.parse(revoked.body) as { status?: string }).status;
        smoke.record('R1-TX-07b', 'GET', `/passport/${passportId}/status`, 'status=revoked', `status=${String(status)}`, status === 'revoked');
      }

      // Authoritative state must block renewal and re-revocation even for the
      // legitimate key holder (single-tenant stand-in for "foreign tenant").
      await call(args.baseUrl, smoke, 'R1-TX-08', 'POST', `/passport/${passportId}/renew`, 409, { key: 'valid' });
      await call(args.baseUrl, smoke, 'R1-TX-09', 'POST', `/passport/${passportId}/revoke`, 409, { key: 'valid', body: '{"reason":"rt-canary double revoke"}' });

      // --- D1-visible state transitions (R1-D1) ---
      if (args.d1Database !== null) {
        const issuance = d1Query(args.d1Bin, args.d1Database, `SELECT tenant_id FROM passport_issuances WHERE passport_id = '${passportId}'`);
        const ownerTenant = issuance?.[0]?.results?.[0]?.tenant_id;
        smoke.record('R1-D1-01', '-', 'd1:passport_issuances', `tenant=${args.expectTenant}`, `tenant=${String(ownerTenant)}`, ownerTenant === args.expectTenant);

        const revocation = d1Query(args.d1Bin, args.d1Database, `SELECT record FROM passport_revocations WHERE passport_id = '${passportId}'`);
        const revocationRow = revocation?.[0]?.results?.[0]?.record;
        let revocationOk = false;
        if (typeof revocationRow === 'string') {
          try {
            revocationOk = (JSON.parse(revocationRow) as { passport_id?: string }).passport_id === passportId;
          } catch {
            revocationOk = false;
          }
        }
        smoke.record('R1-D1-02', '-', 'd1:passport_revocations', 'authoritative row present', revocationOk ? 'present' : 'missing', revocationOk);
      }

      console.log(`canary passport ${passportId} left REVOKED as terminal evidence (rt- tagged, excluded from customer data)`);
    }
  }

  const d1Enabled = args.d1Database !== null;
  const verdicts = buildSmokeVerdicts(smoke.operations, d1Enabled);
  const ok = Object.values(verdicts).every((verdict) => verdict === 'pass');

  const artifact: RuntimeSmokeArtifact = {
    format: 'wasmagent-runtime-smoke/v1',
    repository: args.expectRepository,
    source_sha: args.expectSha,
    deployment_target: args.baseUrl.replace(/^https?:\/\//, ''),
    observed: {
      health_status: typeof healthBody.status === 'string' ? healthBody.status : null,
      environment: typeof healthBody.env === 'string' ? healthBody.env : null,
      auth_mode: typeof healthBody.auth_mode === 'string' ? healthBody.auth_mode : null,
      build_sha: typeof build.sha === 'string' ? build.sha : null,
    },
    synthetic: {
      tenant: args.expectTenant,
      run_id: runId,
      agent_id: canary.agentId,
      passport_id: passportId,
    },
    operations: smoke.operations,
    verdicts,
    observed_at: new Date().toISOString(),
  };

  // The artifact must never carry the smoke credential.
  if (containsSecret(artifact, [apiKey])) {
    console.error('FATAL: smoke artifact would contain the API key — refusing to write');
    return 2;
  }

  writeFileSync(args.out, `${JSON.stringify(artifact, null, 2)}\n`);
  for (const [verdict, outcome] of Object.entries(verdicts)) {
    console.log(`${verdict}: ${outcome}`);
  }
  console.log(`smoke artifact written to ${args.out}`);
  console.log(ok ? 'R1 production smoke: PASS' : 'R1 production smoke: FAIL (job fails closed)');
  return ok ? 0 : 1;
}

process.exit(await main());
