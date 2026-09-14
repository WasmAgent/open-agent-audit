/**
 * Test harness for the Worker: an in-memory SQLite D1 adapter plus minimal
 * KV / R2 / DO / ASSETS fakes. Lets the hostile tests exercise real SQL and
 * real route code without Miniflare or a Cloudflare account.
 */
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkerEnv } from '../src/index.js';

// ---------------------------------------------------------------------------
// D1 (SQLite)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export class SqliteStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(this.db, this.sql, params);
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true }> {
    const rows = this.db.query(this.sql).all(...(this.params as never[])) as T[];
    return { results: rows, success: true };
  }

  async first<T = Row>(): Promise<T | null> {
    const row = this.db.query(this.sql).get(...(this.params as never[])) as T | undefined;
    return row ?? null;
  }

  async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
    this.db.run(this.sql, ...(this.params as never[]));
    return { success: true, meta: {} };
  }

  /** Exposed for tests that need the raw SQLite result of a RETURNING clause. */
  allSync<T = Row>(): T[] {
    return this.db.query(this.sql).all(...(this.params as never[])) as T[];
  }
}

export class SqliteD1 {
  readonly db: Database;

  constructor(schemaSql?: string) {
    this.db = new Database(':memory:');
    this.db.run('PRAGMA foreign_keys = ON');
    if (schemaSql !== undefined && schemaSql.trim() !== '') this.db.run(schemaSql);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.db, sql);
  }

  async batch(
    statements: SqliteStatement[],
  ): Promise<Array<{ success: true; meta: Record<string, unknown> }>> {
    const out: Array<{ success: true; meta: Record<string, unknown> }> = [];
    for (const stmt of statements) out.push(await stmt.run());
    return out;
  }

  async exec(sql: string): Promise<void> {
    this.db.run(sql);
  }

  /** Convenience for seeding test fixtures. */
  seed(sql: string, params: unknown[] = []): void {
    this.db.run(sql, ...(params as never[]));
  }
}

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

interface KvListKey {
  name: string;
}

export class MemoryKV {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(opts: { prefix?: string; cursor?: string } = {}): Promise<{
    keys: KvListKey[];
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = opts.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

export class MemoryR2 {
  private readonly store = new Map<string, Uint8Array>();

  async put(key: string, value: string | Uint8Array): Promise<void> {
    this.store.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value);
  }

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    const bytes = this.store.get(key);
    if (bytes === undefined) return null;
    return { body: bytes };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Durable Object namespace / queues / assets
// ---------------------------------------------------------------------------

export function makeDoNamespace(
  handler: (request: Request) => Promise<Response> = async () =>
    new Response(JSON.stringify({ allowed: true, remaining: 100, reset_at: 0, count: 0 }), {
      headers: { 'content-type': 'application/json' },
    }),
): unknown {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch: handler }),
  };
}

function makeQueue(): unknown {
  return { send: async () => undefined };
}

// ---------------------------------------------------------------------------
// Env factory + schema loader
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

export function readExampleSchema(): string {
  return readFileSync(join(REPO_ROOT, 'examples', 'cloudflare', 'd1-schema.sql'), 'utf8');
}

/** Base schema = authoritative example schema + migration 0003 columns. */
export function baseSchemaSql(): string {
  const base = readExampleSchema();
  const extended = `
ALTER TABLE findings ADD COLUMN description        TEXT;
ALTER TABLE findings ADD COLUMN event_id           TEXT;
ALTER TABLE findings ADD COLUMN confidence         TEXT;
ALTER TABLE findings ADD COLUMN false_positive_likelihood REAL;
ALTER TABLE findings ADD COLUMN first_seen         TEXT;
ALTER TABLE findings ADD COLUMN last_seen          TEXT;
ALTER TABLE findings ADD COLUMN occurrence_count   INTEGER;
ALTER TABLE findings ADD COLUMN suppressed         INTEGER;
ALTER TABLE findings ADD COLUMN suppression_reason TEXT;
`;
  return `${base}\n${extended}`;
}

export interface TestEnvOptions extends Partial<WorkerEnv> {
  /** Extra schema executed after the base schema (e.g. federation tables). */
  schemaSql?: string;
}

export function createEnv(options: TestEnvOptions = {}): WorkerEnv {
  const { schemaSql, ...overrides } = options;
  const d1 = new SqliteD1(baseSchemaSql() + (schemaSql ?? ''));
  return {
    RAW_TRACES: new MemoryR2() as unknown as R2Bucket,
    ARTIFACTS: new MemoryR2() as unknown as R2Bucket,
    REPORTS: new MemoryR2() as unknown as R2Bucket,
    PASSPORTS: new MemoryKV() as unknown as KVNamespace,
    APPROVALS: new MemoryKV() as unknown as KVNamespace,
    DB: d1 as unknown as D1Database,
    AUDIT_JOBS: makeQueue() as unknown as Queue<never>,
    CHUNK_JOBS: makeQueue() as unknown as Queue<never>,
    REPORT_JOBS: makeQueue() as unknown as Queue<never>,
    AUDIT_RUN_COORDINATOR: makeDoNamespace() as unknown as DurableObjectNamespace,
    TENANT_LIMITER: makeDoNamespace() as unknown as DurableObjectNamespace,
    OAA_ENV: 'test',
    MAX_UPLOAD_MB: '100',
    DEFAULT_PROFILES: 'default',
    ASSETS: {
      fetch: async () => new Response('Not found', { status: 404 }),
    } as unknown as Fetcher,
    ISSUER_NAME: 'Test Issuer',
    ISSUER_EMAIL: 'test@example.com',
    PUBLIC_URL: 'https://example.com',
    ...overrides,
  };
}

export function dbOf(env: WorkerEnv): SqliteD1 {
  return env.DB as unknown as SqliteD1;
}

export interface SeedRunOptions {
  runId: string;
  tenantId: string;
  projectId?: string;
  riskScore?: number;
  eas?: number;
  findingCount?: number;
  createdAt?: string;
  completedAt?: string;
}

export function seedRun(env: WorkerEnv, options: SeedRunOptions): void {
  const {
    runId,
    tenantId,
    projectId = 'default',
    riskScore = 50,
    eas = 70,
    findingCount = 0,
    createdAt = '2026-09-01T00:00:00.000Z',
    completedAt = '2026-09-01T00:00:01.000Z',
  } = options;
  const d1 = dbOf(env);
  d1.seed('INSERT OR IGNORE INTO tenants (tenant_id, name, plan, created_at) VALUES (?,?,?,?)', [
    tenantId,
    tenantId,
    'pilot',
    createdAt,
  ]);
  d1.seed(
    'INSERT OR IGNORE INTO projects (project_id, tenant_id, name, created_at) VALUES (?,?,?,?)',
    [projectId, tenantId, projectId, createdAt],
  );
  d1.seed(
    `INSERT INTO audit_runs
       (run_id, tenant_id, project_id, status, input_format, schema_version,
        profile_ids, raw_r2_key, event_count, finding_count, risk_score,
        evidence_admission_score, created_at, updated_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      runId,
      tenantId,
      projectId,
      'completed',
      'jsonl',
      'open-agent-audit/v0.1',
      '[]',
      `runs/${runId}/raw.jsonl`,
      1,
      findingCount,
      riskScore,
      eas,
      createdAt,
      createdAt,
      completedAt,
    ],
  );
}

export function seedFinding(
  env: WorkerEnv,
  options: { findingId: string; runId: string; tenantId: string; severity?: string },
): void {
  const { findingId, runId, tenantId, severity = 'high' } = options;
  dbOf(env).seed(
    `INSERT INTO findings
       (finding_id, run_id, tenant_id, severity, category, title, evidence_ids, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [findingId, runId, tenantId, severity, 'test', findingId, '[]', '2026-09-01T00:00:00.000Z'],
  );
}
