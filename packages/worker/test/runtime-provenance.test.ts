import { describe, expect, it } from 'bun:test';
import {
  completeProvenanceExample,
  validateRuntimeProvenance,
  type ProvenanceCheck,
  type ProvenanceValidation,
} from '../src/runtime-provenance.js';

function withMutation(mutate: (artifact: Record<string, unknown>) => void): unknown {
  const artifact = completeProvenanceExample() as Record<string, unknown>;
  mutate(artifact);
  return artifact;
}

function checkOf(result: ProvenanceValidation, id: string): ProvenanceCheck {
  const check = result.checks.find((c) => c.id === id);
  if (check === undefined) throw new Error(`missing check ${id}`);
  return check;
}

describe('R4 — runtime release provenance validator', () => {
  it('R4-SCHEMA-06 a valid complete artifact passes', () => {
    const result = validateRuntimeProvenance(completeProvenanceExample());
    expect(result.ok).toBe(true);
    expect(checkOf(result, 'R4-SCHEMA-06').pass).toBe(true);
  });

  it('R4-SCHEMA-01 missing source SHA fails', () => {
    const result = validateRuntimeProvenance(
      withMutation((a) => {
        (a.source as Record<string, unknown>).sha = '';
      }),
    );
    expect(checkOf(result, 'R4-SCHEMA-01').pass).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('R4-SCHEMA-02 live SHA != source SHA fails', () => {
    const result = validateRuntimeProvenance(
      withMutation((a) => {
        (a.runtime as Record<string, unknown>).observed_live_sha = 'b4bdada530757e7442bb35aa60cc84d03cb5c21e';
      }),
    );
    expect(checkOf(result, 'R4-SCHEMA-02').pass).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('R4-SCHEMA-03 missing R0 artifact digest fails', () => {
    const result = validateRuntimeProvenance(
      withMutation((a) => {
        delete (a.runtime as Record<string, unknown>).r0_artifact_sha256;
      }),
    );
    expect(checkOf(result, 'R4-SCHEMA-03').pass).toBe(false);
  });

  it('R4-SCHEMA-04 a pass verdict with a non-passing R1 smoke is rejected', () => {
    for (const r1 of ['fail', 'partial', 'not_run']) {
      const result = validateRuntimeProvenance(
        withMutation((a) => {
          (a.runtime as Record<string, unknown>).r1_verdict = r1;
        }),
      );
      expect(checkOf(result, 'R4-SCHEMA-04').pass).toBe(false);
      expect(result.ok).toBe(false);
    }
  });

  it('R4-SCHEMA-04b a fail verdict with a failing R1 is internally consistent (fails only on honest reporting)', () => {
    const result = validateRuntimeProvenance(
      withMutation((a) => {
        (a.runtime as Record<string, unknown>).r1_verdict = 'fail';
        a.verdict = 'fail';
      }),
    );
    expect(checkOf(result, 'R4-SCHEMA-04').pass).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('R4-SCHEMA-05 malformed Cloudflare version id fails', () => {
    const result = validateRuntimeProvenance(
      withMutation((a) => {
        (a.deployment as Record<string, unknown>).version_id = 'not-a-uuid';
      }),
    );
    expect(checkOf(result, 'R4-SCHEMA-05').pass).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('broken envelope (missing sections / bad format / bad timestamp) fails closed', () => {
    expect(validateRuntimeProvenance(null).ok).toBe(false);
    expect(validateRuntimeProvenance({ format: 'wrong' }).ok).toBe(false);
    expect(
      validateRuntimeProvenance(
        withMutation((a) => {
          a.observed_at = 'yesterday';
        }),
      ).ok,
    ).toBe(false);
  });
});
