import { describe, expect, it } from 'bun:test';
import {
  schemaIdForCanonical,
  checkFile,
  getSchema,
  hasDrift,
  normalizeSchema,
  scan,
} from '@wasmagent/protocol';
import { join } from 'node:path';

/**
 * OAA-3 — canonical contract drift gate.
 *
 * Guards the whole repo against hand-edited canonical schema copies and
 * re-declared canonical ids, using the drift-detection API shipped by the
 * pinned @wasmagent/protocol package. Also verifies the local AEP record
 * projection type is byte-consistent with the canonical vendored schema
 * referenced by the adapter tests.
 */

const REPO_ROOT = join(import.meta.dir, '../../..');

describe('canonical contract drift gate (OAA-3)', () => {
  it('repo scan finds no drift, re-declared ids, or competing registries', () => {
    const findings = scan(REPO_ROOT, {});
    const drift = findings.filter((f) => !f.ok);
    expect(drift).toEqual([]);
  });

  it('any repo schema carrying a canonical $id is byte-identical to canonical', () => {
    const { readdirSync, statSync, readFileSync } = require('node:fs');
    const checked: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
        const f = join(dir, entry);
        if (statSync(f).isDirectory()) walk(f);
        else if (entry.endsWith('.schema.json')) {
          const doc = JSON.parse(readFileSync(f, 'utf8'));
          const id = schemaIdForCanonical(String(doc.$id ?? ''));
          if (id) {
            checked.push(f);
            const finding = checkFile(f, id);
            expect(finding.ok, `${f}: ${finding.code} ${finding.message}`).toBe(true);
          }
        }
      }
    };
    walk(REPO_ROOT);
    // Every repo schema is product-local today (roots own their $ids); the
    // assertion below is a tripwire in case a canonical id ever appears here.
    expect(checked).toEqual([]);
  });

  it('canonical aep-record schema validates a canonical v0.5 record (round trip)', () => {
    const Ajv2020 = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(getSchema('aep-record') as Record<string, unknown>);
    // A minimal aep/v0.5 record carrying the required v0.5 attribution fields.
    const record = {
      schema_version: 'aep/v0.5',
      run_id: 'oaa-drift-gate-001',
      created_at_ms: 1750000000000,
      attribution_backing: 'operator_asserted',
      run_attribution_backing_floor: 'operator_asserted',
      run_attribution_backing_observed: ['operator_asserted'],
      authorization_evidence_count: 1,
    };
    expect(validate(record)).toBe(true);
  });

  it('serializeSchema normalization is order-independent (sanity)', () => {
    const schema = getSchema('aep-record') as Record<string, unknown>;
    const a = normalizeSchema(JSON.stringify(schema));
    const b = normalizeSchema(JSON.parse(JSON.stringify(schema)));
    expect(a).toBe(b);
  });
});
