/**
 * Dependency failure classification (Track B — D1 availability normalization).
 *
 * Expected provider availability/resource failures on D1 read paths previously
 * surfaced as raw HTTP 500 Cloudflare error pages (runtime finding R-G-01:
 * "D1_ERROR: Your account has exceeded D1's free tier daily row read limit").
 * Classified failures are normalized to a structured 503 at the worker fetch
 * boundary; everything else keeps the existing 500 behavior so real
 * programming defects are never hidden behind "unavailable".
 *
 * Pure module: no worker-runtime imports, fully unit-testable.
 */

export type DependencyFailureKind =
  | 'quota_exhausted'
  | 'unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'unknown';

export interface DependencyFailure {
  dependency: 'd1';
  kind: DependencyFailureKind;
  retryable: boolean;
  /** Stable public error code; never contains provider error text. */
  publicCode: string;
}

/**
 * Public body for a classified dependency failure. Deliberately generic:
 * `Retry-After` carries a generic courtesy delay (60s) — the provider does not
 * expose an authoritative reset time, so none is claimed.
 */
export interface DependencyUnavailableBody {
  error: 'dependency_unavailable';
  dependency: 'd1';
  retryable: boolean;
}

/**
 * Signals that an error originated from the D1 binding. Requiring the marker
 * keeps classification conservative: an opaque "timeout" from some other
 * dependency is never normalized as a D1 failure.
 */
const D1_MARKER = /\bD1_ERROR\b|\bD1\b|Cloudflare D1/i;

/** Ordered availability signals; first match wins. */
// Evidence-label priority (kind order matters): explicit quota/daily-limit
// signals first, then rate limiting, timeouts, and generic unavailability.
// quota_exhausted is deliberately narrow — a generic "limit exceeded" (which
// also matches "rate limit exceeded") must label as rate_limited so runtime
// artifacts and logs carry the true failure kind.
const KIND_SIGNATURES: Array<{ kind: DependencyFailureKind; pattern: RegExp }> = [
  // Observed in production (R-G-01); free-tier daily read/write limits.
  {
    kind: 'quota_exhausted',
    pattern:
      /daily row (read|write) limit|free tier[^.\n]{0,40}limit|quota (exceeded|exhausted)|exceeded [^.\n]{0,40}quota/i,
  },
  { kind: 'rate_limited', pattern: /\brate[- ]limit(?:ed)?\b|too many requests/i },
  { kind: 'timeout', pattern: /\btimeout\b|timed out/i },
  { kind: 'unavailable', pattern: /service unavailable|temporarily unavailable|backend error|database is (unavailable|overloaded)/i },
];

/**
 * Classify a thrown error from a D1 operation.
 *
 * Returns a {@link DependencyFailure} only for recognized provider
 * availability/resource signals on D1. SQL syntax errors, missing
 * tables/columns, and constraint violations are application/schema defects —
 * they return `null` and keep the 500 path so defects stay visible.
 */
export function classifyD1Error(error: unknown): DependencyFailure | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message === '' || !D1_MARKER.test(message)) return null;

  for (const signature of KIND_SIGNATURES) {
    if (signature.pattern.test(message)) {
      return {
        dependency: 'd1',
        kind: signature.kind,
        retryable: true,
        publicCode: 'dependency_unavailable',
      };
    }
  }
  return null;
}

/** Public JSON body for a classified failure (provider text never included). */
export function dependencyUnavailableBody(failure: DependencyFailure): DependencyUnavailableBody {
  return { error: 'dependency_unavailable', dependency: failure.dependency, retryable: failure.retryable };
}
