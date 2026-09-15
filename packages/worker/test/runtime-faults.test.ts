import { describe, expect, it } from 'bun:test';
import { R2_FAULT_LEDGER } from '../src/runtime-faults.js';
import { SCENARIOS, r2D101, r2D102 } from './runtime-fault-scenarios.js';

describe('R2 local fault-injection harness', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id} completes with a passing verdict`, async () => {
      const artifact = await scenario.run();
      expect(artifact.format).toBe('wasmagent-runtime-fault/v1');
      expect(artifact.mode).toBe('local');
      expect(artifact.verdict).toBe('pass');
    });
  }

  it('R2-Q-01 duplicate audit delivery converges on the same D1 row (upsert idempotency)', async () => {
    const artifact = await SCENARIOS.find((s) => s.id === 'R2-Q-01')!.run();
    expect(artifact.observed.first_delivery).toEqual({ acked: 1, retried: 0 });
    expect(artifact.observed.duplicate_delivery).toEqual({ acked: 1, retried: 0 });
  });

  it('every ledger entry is explicitly categorized (no fake closure)', () => {
    for (const entry of R2_FAULT_LEDGER) {
      expect(['pending_harness', 'covered_elsewhere', 'observed_failing']).toContain(entry.status);
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });

  it('spot-check: D1 ownership-write failure rolls everything back (R2-D1-01)', async () => {
    const artifact = await r2D101();
    expect(artifact.observed.issue_status).toBe(503);
    expect(artifact.observed.ownership_rows).toBe(0);
    expect(artifact.observed.kv_documents_after).toBe(artifact.observed.kv_documents_before);
  });

  it('spot-check: unavailable status lookup reports UNKNOWN, never ACTIVE (R2-D1-02)', async () => {
    const artifact = await r2D102();
    expect(artifact.observed.status_summary).toBe('unknown');
  });
});
