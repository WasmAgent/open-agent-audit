/**
 * @openagentaudit/core/retention — Evidence retention policies (Milestone 6).
 *
 * Pure, deterministic, Worker-compatible engine that classifies historical
 * audit runs into a lifecycle action (`keep` / `archive` / `prune`) against a
 * configurable {@link RetentionPolicy}. Like the other engines in this package
 * it carries no storage bindings: the Worker reads candidate runs from D1/R2,
 * hands them to {@link planRetention}, and executes the returned plan.
 *
 * Lifecycle enforced by {@link classify}:
 *   - age <  `archive_after_days`  -> keep   (still in the hot, active set)
 *   - age >= `archive_after_days`  -> archive (retain, but move out of the hot set)
 *     and <  `retention_days`
 *   - age >= `retention_days`      -> prune   (permanently delete) - unless
 *                                            {@link RetentionPolicy.prune_expired}
 *                                            is false, in which case the run is
 *                                            archived indefinitely.
 */

/** Milliseconds in one UTC day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Minimum retention period, in days. The EU AI Act Art. 26(6) requires
 * high-risk AI system deployers to retain automatic logging for at least six
 * months; this floor is enforced by {@link resolvePolicy} and cannot be lowered.
 * It mirrors the six-month anchor used by the report engine's retention notice.
 */
export const MIN_RETENTION_DAYS = 180;

/**
 * Configurable evidence retention policy. Historical audit runs older than
 * {@link RetentionPolicy.archive_after_days} are moved out of the active ("hot")
 * set, and runs older than {@link RetentionPolicy.retention_days} are pruned.
 */
export interface RetentionPolicy {
  /** Days a run is retained before it is pruned. Cannot fall below {@link MIN_RETENTION_DAYS}. */
  retention_days: number;
  /** Age (days) after which a completed run is archived out of the hot set. */
  archive_after_days: number;
  /** When true (default), runs past `retention_days` are permanently pruned. */
  prune_expired: boolean;
}

/** Policy with all fields populated and invariants enforced by {@link resolvePolicy}. */
export type ResolvedRetentionPolicy = RetentionPolicy;

/** A historical audit run evaluated against a retention policy. */
export interface RetentionCandidate {
  run_id: string;
  /** ISO-8601 timestamp the run was created (or completed). */
  created_at: string;
}

/** Lifecycle action prescribed for a candidate. */
export type RetentionAction = 'keep' | 'archive' | 'prune';

/** Per-candidate retention verdict. */
export interface RetentionDecision {
  run_id: string;
  action: RetentionAction;
  /** Whole-day age of the run at the plan's reference instant. Negative ages clamp to 0. */
  age_days: number;
  /** ISO date the next lifecycle transition occurs, when one is pending (omitted for `keep` of fresh runs and terminal `prune`). */
  next_transition_at?: string;
}

/** Result of classifying a set of runs against a policy. */
export interface RetentionPlan {
  /** ISO-8601 reference instant the plan was computed at. */
  computed_at: string;
  policy: ResolvedRetentionPolicy;
  /** Decisions sorted by `run_id` for stable, diffable output. */
  decisions: RetentionDecision[];
  counts: { keep: number; archive: number; prune: number };
}

/**
 * Add (possibly fractional) days to an ISO timestamp; returns an ISO string.
 * Used to project when the next lifecycle transition falls.
 */
export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * Whole-day age of `createdAt` relative to `nowIso`. Negative ages clamp to 0,
 * and an unparseable `createdAt` (or `nowIso`) yields 0 rather than `NaN` - so a
 * corrupt timestamp can never produce an inflated age that would trigger a prune.
 */
export function ageDays(createdAt: string, nowIso: string): number {
  const createdMs = new Date(createdAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) return 0;
  const ms = nowMs - createdMs;
  return Math.max(0, Math.floor(ms / MS_PER_DAY));
}

/**
 * Merge a partial policy with defaults and enforce invariants:
 *   - `retention_days` is an integer no smaller than {@link MIN_RETENTION_DAYS};
 *   - `archive_after_days` is a non-negative integer that never exceeds
 *     `retention_days` (defaults to half the retention window);
 *   - `prune_expired` defaults to true.
 *
 * Invalid (non-finite or non-numeric) inputs fall back to the corresponding
 * default rather than throwing, so a partially-misconfigured policy still yields
 * a safe, conservative result.
 */
export function resolvePolicy(policy?: Partial<RetentionPolicy>): ResolvedRetentionPolicy {
  const requestedRetention = Number(policy?.retention_days);
  const retention_days = Number.isFinite(requestedRetention)
    ? Math.max(MIN_RETENTION_DAYS, Math.floor(requestedRetention))
    : MIN_RETENTION_DAYS;

  const requestedArchive = Number(policy?.archive_after_days);
  const defaultArchive = Math.floor(retention_days / 2);
  const archive_after_days = Number.isFinite(requestedArchive)
    ? Math.min(retention_days, Math.max(0, Math.floor(requestedArchive)))
    : defaultArchive;

  const prune_expired = policy?.prune_expired ?? true;
  return { retention_days, archive_after_days, prune_expired };
}

/**
 * Classify a single candidate against `policy` at reference instant `nowIso`.
 *
 * Boundary note: a run whose age is *exactly* `archive_after_days` is archived,
 * and one whose age is *exactly* `retention_days` is pruned - i.e. thresholds
 * are inclusive (`>=`). This keeps a run that has reached its retention horizon
 * from lingering one extra day.
 */
function classify(
  candidate: RetentionCandidate,
  policy: ResolvedRetentionPolicy,
  nowIso: string,
): RetentionDecision {
  const age_days = ageDays(candidate.created_at, nowIso);
  const createdMs = new Date(candidate.created_at).getTime();
  const createdAtValid = Number.isFinite(createdMs);

  let action: RetentionAction;
  let next_transition_at: string | undefined;

  if (age_days >= policy.retention_days) {
    // Past the retention horizon: prune (or, if pruning is disabled, archive indefinitely).
    action = policy.prune_expired ? 'prune' : 'archive';
    next_transition_at = undefined;
  } else if (age_days >= policy.archive_after_days) {
    action = 'archive';
    next_transition_at = createdAtValid
      ? addDays(candidate.created_at, policy.retention_days)
      : undefined;
  } else {
    action = 'keep';
    next_transition_at = createdAtValid
      ? addDays(candidate.created_at, policy.archive_after_days)
      : undefined;
  }

  const decision: RetentionDecision = { run_id: candidate.run_id, action, age_days };
  if (next_transition_at !== undefined) {
    decision.next_transition_at = next_transition_at;
  }
  return decision;
}

/**
 * Classify a set of historical audit runs against `policy`.
 *
 * Pure and deterministic: pass an explicit `now` (ISO) to make the outcome
 * reproducible across calls and in tests. Candidates with unparseable
 * `created_at` values are classified as fresh (`age_days = 0`, action `keep`)
 * rather than dropping them, so a bad timestamp never silently causes a prune.
 */
export function planRetention(
  candidates: RetentionCandidate[],
  policy?: Partial<RetentionPolicy>,
  now?: string,
): RetentionPlan {
  const resolved = resolvePolicy(policy);
  const computed_at = now ?? new Date().toISOString();

  const decisions = candidates
    .map((c) => classify(c, resolved, computed_at))
    .sort((a, b) => a.run_id.localeCompare(b.run_id));

  const counts = { keep: 0, archive: 0, prune: 0 };
  for (const d of decisions) {
    counts[d.action] += 1;
  }

  return { computed_at, policy: resolved, decisions, counts };
}

/**
 * Parse a JSON-encoded {@link RetentionPolicy} (e.g. the Worker
 * `RETENTION_POLICY` env var). Returns the {@link resolvePolicy|default policy}
 * when the value is absent or blank. Throws on malformed JSON or a non-object
 * value so misconfiguration is surfaced by the caller rather than silently
 * disabling retention.
 */
export function parseRetentionPolicy(raw: string | undefined): ResolvedRetentionPolicy {
  if (raw === undefined || raw.trim() === '') return resolvePolicy();
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RETENTION_POLICY must be a JSON object of RetentionPolicy');
  }
  return resolvePolicy(parsed as Partial<RetentionPolicy>);
}
