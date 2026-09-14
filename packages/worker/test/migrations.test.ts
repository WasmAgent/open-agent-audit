import type { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultProjectId } from '../src/index.js';
import { readExampleSchema, SqliteD1 } from './harness.js';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

/** Apply every migration in filename order to a fresh database. */
function applyAllMigrations(): SqliteD1 {
  const d1 = new SqliteD1();
  for (const file of migrationFiles()) d1.db.exec(readMigration(file));
  return d1;
}

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function tableInfo(db: Database, table: string): TableInfoRow[] {
  return db
    .query('SELECT name, type, "notnull", pk FROM pragma_table_info(?) ORDER BY cid')
    .all(table) as TableInfoRow[];
}

function objectNames(db: Database): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
}

describe('N2-MG — migration chain', () => {
  it('MG-01 empty DB + all migrations rebuilds the base schema', () => {
    const d1 = applyAllMigrations();
    const names = objectNames(d1.db);
    for (const expected of [
      'tenants',
      'projects',
      'audit_runs',
      'findings',
      'evidence_index',
      'reports',
      'registered_passports',
      'status_lists',
      'idx_audit_runs_tenant',
      'idx_findings_tenant',
      'idx_projects_tenant_name',
    ]) {
      expect(names).toContain(expected);
    }
    // 0003 extended columns survived into the rebuilt schema.
    const findingCols = tableInfo(d1.db, 'findings').map((c) => c.name);
    expect(findingCols).toContain('description');
    expect(findingCols).toContain('suppression_reason');
  });

  it('MG-01b FK enforcement rejects an orphan audit_run', () => {
    const d1 = applyAllMigrations();
    d1.seed('INSERT INTO tenants (tenant_id, name, plan, created_at) VALUES (?,?,?,?)', [
      'tenant-a',
      'A',
      'pilot',
      '2026-09-01T00:00:00.000Z',
    ]);
    expect(() =>
      d1.seed(
        `INSERT INTO audit_runs
           (run_id, tenant_id, project_id, status, input_format, schema_version, profile_ids,
            created_at, updated_at)
         VALUES ('run-x','tenant-a','does-not-exist','completed','jsonl','v','[]','t','t')`,
      ),
    ).toThrow();
  });

  it('MG-01c two tenants can each own a project named "default"', () => {
    const d1 = applyAllMigrations();
    for (const tenant of ['tenant-a', 'tenant-b']) {
      d1.seed('INSERT INTO tenants (tenant_id, name, plan, created_at) VALUES (?,?,?,?)', [
        tenant,
        tenant,
        'pilot',
        't',
      ]);
      d1.seed('INSERT INTO projects (project_id, tenant_id, name, created_at) VALUES (?,?,?,?)', [
        defaultProjectId(tenant),
        tenant,
        'default',
        't',
      ]);
    }
    const rows = d1.db
      .query("SELECT project_id, tenant_id FROM projects WHERE name = 'default' ORDER BY tenant_id")
      .all() as Array<{ project_id: string; tenant_id: string }>;
    expect(rows).toEqual([
      { project_id: 'tenant-a:default', tenant_id: 'tenant-a' },
      { project_id: 'tenant-b:default', tenant_id: 'tenant-b' },
    ]);
  });

  it('MG-01d a duplicate (tenant_id, name) slug is rejected', () => {
    const d1 = applyAllMigrations();
    d1.seed('INSERT INTO tenants (tenant_id, name, plan, created_at) VALUES (?,?,?,?)', [
      'tenant-a',
      'A',
      'pilot',
      't',
    ]);
    d1.seed('INSERT INTO projects (project_id, tenant_id, name, created_at) VALUES (?,?,?,?)', [
      'tenant-a:default',
      'tenant-a',
      'default',
      't',
    ]);
    expect(() =>
      d1.seed('INSERT INTO projects (project_id, tenant_id, name, created_at) VALUES (?,?,?,?)', [
        'tenant-a:default-2',
        'tenant-a',
        'default',
        't',
      ]),
    ).toThrow();
  });

  it('MG-03 guarded baseline repair is idempotent', () => {
    const d1 = applyAllMigrations();
    expect(() => d1.db.exec(readMigration('0004_schema_baseline_repair.sql'))).not.toThrow();
  });

  it('MG-02 upgrading an old schema (no tenant-slug constraint) adds it safely', () => {
    // Simulate a pre-fix production database: projects has no UNIQUE(tenant_id,
    // name) and holds a single global "default" row.
    const old = new SqliteD1();
    old.db.exec(`
      CREATE TABLE tenants (tenant_id TEXT PRIMARY KEY, name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'pilot', created_at TEXT NOT NULL);
      CREATE TABLE projects (project_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
        name TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    old.seed('INSERT INTO tenants (tenant_id, name, plan, created_at) VALUES (?,?,?,?)', [
      'legacy',
      'Legacy',
      'pilot',
      't',
    ]);
    old.seed('INSERT INTO projects (project_id, tenant_id, name, created_at) VALUES (?,?,?,?)', [
      'default',
      'legacy',
      'default',
      't',
    ]);

    // Repair migration brings the schema up to date without touching data.
    old.db.exec(readMigration('0004_schema_baseline_repair.sql'));

    const legacy = old.db
      .query("SELECT project_id FROM projects WHERE project_id = 'default'")
      .get() as { project_id: string } | undefined;
    expect(legacy?.project_id).toBe('default');

    // The new uniqueness guard is now enforced.
    expect(() =>
      old.seed('INSERT INTO projects (project_id, tenant_id, name, created_at) VALUES (?,?,?,?)', [
        'legacy:default',
        'legacy',
        'default',
        't',
      ]),
    ).toThrow();
  });

  it('MG-04 example schema does not drift from migration 0001', () => {
    const fromMigration = new SqliteD1();
    fromMigration.db.exec(readMigration('0001_init.sql'));
    const fromExample = new SqliteD1();
    fromExample.db.exec(readExampleSchema());

    expect(objectNames(fromMigration.db)).toEqual(objectNames(fromExample.db));

    for (const table of ['tenants', 'projects', 'audit_runs', 'findings', 'evidence_index', 'reports']) {
      expect(tableInfo(fromMigration.db, table)).toEqual(tableInfo(fromExample.db, table));
    }
  });
});
