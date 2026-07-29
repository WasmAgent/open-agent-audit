import { describe, expect, it } from 'bun:test';
import {
  MIN_RETENTION_DAYS,
  addDays,
  ageDays,
  parseRetentionPolicy,
  planRetention,
  resolvePolicy,
} from './index.js';
import type { RetentionAction, RetentionCandidate, RetentionDecision } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2026-07-29T00:00:00.000Z';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a candidate whose `created_at` is `ageDaysArg` before the fixed reference
 * instant `NOW`. Keeps every assertion in this suite deterministic.
 */
function aged(runId: string, ageDaysArg: number): RetentionCandidate {
  const created = new Date(new Date(NOW).getTime() - ageDaysArg * MS_PER_DAY).toISOString();
  return { run_id: runId, created_at: created };
}

function actionsOf(plan: ReturnType<typeof planRetention>): Record<string, RetentionAction> {
  const out: Record<string, RetentionAction> = {};
  for (const d of plan.decisions) out[d.run_id] = d.action;
  return out;
}

// ---------------------------------------------------------------------------
// addDays / ageDays
// ---------------------------------------------------------------------------

describe('addDays', () => {
  it('shifts a timestamp forward by whole days', () => {
    expect(addDays('2026-01-01T00:00:00.000Z', 30)).toBe('2026-01-31T00:00:00.000Z');
  });

  it('handles fractional days', () => {
    expect(addDays('2026-01-01T00:00:00.000Z', 1.5)).toBe('2026-01-02T12:00:00.000Z');
  });

  it('supports negative offsets', () => {
    expect(addDays('2026-01-31T00:00:00.000Z', -30)).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('ageDays', () => {
  it('returns whole-day age relative to now', () => {
    expect(ageDays('2026-07-19T00:00:00.000Z', NOW)).toBe(10);
  });

  it('floors fractional ages', () => {
    expect(ageDays('2026-07-28T20:00:00.000Z', NOW)).toBe(0);
  });

  it('clamps future timestamps to zero (never a negative age)', () => {
    expect(ageDays('2026-08-05T00:00:00.000Z', NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolvePolicy
// ---------------------------------------------------------------------------

describe('resolvePolicy', () => {
  it('applies conservative defaults when nothing is provided', () => {
    const p = resolvePolicy();
    expect(p.retention_days).toBe(MIN_RETENTION_DAYS); // 180 - EU AI Act Art. 26(6) floor
    expect(p.archive_after_days).toBe(90); // half the retention window
    expect(p.prune_expired).toBe(true);
  });

  it('honours an explicit longer retention window', () => {
    const p = resolvePolicy({ retention_days: 365, archive_after_days: 200 });
    expect(p.retention_days).toBe(365);
    expect(p.archive_after_days).toBe(200);
  });

  it('clamps retention_days up to the regulatory floor', () => {
    // A value below the 6-month floor is illegal under EU AI Act Art. 26(6).
    expect(resolvePolicy({ retention_days: 30 }).retention_days).toBe(MIN_RETENTION_DAYS);
    expect(resolvePolicy({ retention_days: 179 }).retention_days).toBe(MIN_RETENTION_DAYS);
  });

  it('keeps exactly the floor when requested at the boundary', () => {
    expect(resolvePolicy({ retention_days: 180 }).retention_days).toBe(180);
  });

  it('clamps archive_after_days to [0, retention_days]', () => {
    expect(resolvePolicy({ retention_days: 365, archive_after_days: 999 }).archive_after_days).toBe(
      365,
    );
    expect(resolvePolicy({ archive_after_days: -5 }).archive_after_days).toBe(0);
  });

  it('falls back to defaults on non-finite input instead of throwing', () => {
    const p = resolvePolicy({
      retention_days: Number.NaN,
      archive_after_days: 'oops' as unknown as number,
    });
    expect(p.retention_days).toBe(MIN_RETENTION_DAYS);
    expect(p.archive_after_days).toBe(90);
  });

  it('respects an explicit prune_expired=false', () => {
    expect(resolvePolicy({ prune_expired: false }).prune_expired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// planRetention - classification
// ---------------------------------------------------------------------------

describe('planRetention', () => {
  it('keeps fresh runs and archives/prunes old ones by default policy', () => {
    const plan = planRetention(
      [
        aged('run-fresh', 10), // < 90  -> keep
        aged('run-archival', 100), // >= 90, < 180 -> archive
        aged('run-expired', 200), // >= 180 -> prune
      ],
      undefined,
      NOW,
    );

    expect(actionsOf(plan)).toEqual({
      'run-fresh': 'keep',
      'run-archival': 'archive',
      'run-expired': 'prune',
    });
    expect(plan.counts).toEqual({ keep: 1, archive: 1, prune: 1 });
  });

  it('treats archive_after_days as an inclusive lower bound', () => {
    const plan = planRetention([aged('run', 90)], undefined, NOW);
    expect(plan.decisions[0]?.action).toBe('archive');
  });

  it('prunes a run that has exactly reached the retention horizon', () => {
    const plan = planRetention([aged('run', 180)], undefined, NOW);
    expect(plan.decisions[0]?.action).toBe('prune');
  });

  it('archives instead of pruning when prune_expired is false', () => {
    const plan = planRetention(
      [aged('run-expired', 400)],
      { retention_days: 365, archive_after_days: 180, prune_expired: false },
      NOW,
    );
    expect(plan.decisions[0]?.action).toBe('archive');
    expect(plan.counts.prune).toBe(0);
  });

  it('projects the next transition date for kept and archived runs', () => {
    const plan = planRetention([aged('run-fresh', 10), aged('run-archival', 100)], undefined, NOW);
    const fresh = plan.decisions.find((d) => d.run_id === 'run-fresh') as RetentionDecision;
    const archival = plan.decisions.find((d) => d.run_id === 'run-archival') as RetentionDecision;

    // Fresh run: created + 90 days (archive threshold).
    expect(new Date(fresh.next_transition_at as string).getTime()).toBe(
      new Date(NOW).getTime() - 10 * MS_PER_DAY + 90 * MS_PER_DAY,
    );
    // Archived run: created + 180 days (retention horizon).
    expect(new Date(archival.next_transition_at as string).getTime()).toBe(
      new Date(NOW).getTime() - 100 * MS_PER_DAY + 180 * MS_PER_DAY,
    );
  });

  it('omits next_transition_at for a pruned (terminal) run', () => {
    const plan = planRetention([aged('run', 200)], undefined, NOW);
    expect(plan.decisions[0]?.next_transition_at).toBeUndefined();
  });

  it('reports the resolved policy and reference instant on the plan', () => {
    const plan = planRetention([], { retention_days: 365 }, NOW);
    expect(plan.computed_at).toBe(NOW);
    expect(plan.policy.retention_days).toBe(365);
    expect(plan.decisions).toEqual([]);
    expect(plan.counts).toEqual({ keep: 0, archive: 0, prune: 0 });
  });

  it('sorts decisions by run_id for stable output', () => {
    const plan = planRetention(
      [aged('zeta', 200), aged('alpha', 200), aged('mid', 200)],
      undefined,
      NOW,
    );
    expect(plan.decisions.map((d) => d.run_id)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('classifies a run with a bad timestamp as fresh rather than pruning it', () => {
    const plan = planRetention([{ run_id: 'bad', created_at: 'not-a-date' }], undefined, NOW);
    // Date('not-a-date') is Invalid -> age clamps to 0 -> keep. Never a destructive prune.
    expect(plan.decisions[0]?.action).toBe('keep');
    expect(plan.decisions[0]?.age_days).toBe(0);
  });

  it('respects a custom archive_after_days window', () => {
    const plan = planRetention(
      [aged('a', 20), aged('b', 60)],
      { retention_days: 365, archive_after_days: 30 },
      NOW,
    );
    expect(actionsOf(plan)).toEqual({ a: 'keep', b: 'archive' });
  });
});

// ---------------------------------------------------------------------------
// parseRetentionPolicy (Worker env-var parsing)
// ---------------------------------------------------------------------------

describe('parseRetentionPolicy', () => {
  it('returns the default policy for absent or blank input', () => {
    expect(parseRetentionPolicy(undefined)).toEqual(resolvePolicy());
    expect(parseRetentionPolicy('   ')).toEqual(resolvePolicy());
  });

  it('parses a valid JSON policy object and enforces invariants', () => {
    const p = parseRetentionPolicy('{"retention_days":400,"archive_after_days":150}');
    expect(p.retention_days).toBe(400);
    expect(p.archive_after_days).toBe(150);
    expect(p.prune_expired).toBe(true);
  });

  it('clamps a sub-floor retention_days up to the minimum', () => {
    expect(parseRetentionPolicy('{"retention_days":10}').retention_days).toBe(MIN_RETENTION_DAYS);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseRetentionPolicy('{not json')).toThrow();
  });

  it('throws on a non-object value', () => {
    expect(() => parseRetentionPolicy('180')).toThrow(/JSON object/);
    expect(() => parseRetentionPolicy('["180"]')).toThrow(/JSON object/);
    expect(() => parseRetentionPolicy('null')).toThrow(/JSON object/);
  });
});
