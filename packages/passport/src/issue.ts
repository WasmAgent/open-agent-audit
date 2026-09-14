import { createHash, randomUUID } from 'node:crypto';
import { issuanceDigest, signPassport } from './sign.js';
import type { SignedPassport } from './sign.js';
import type { FrameworkMapping, IssueOptions, TrustPassport } from './types.js';
import { KNOWN_FRAMEWORK_PROFILES } from './types.js';

/**
 * Evidence quality thresholds used by {@link deriveEvidenceQuality}.
 *
 * Maps EAS (Evidence Admission Score) numeric values to quality levels:
 * - high:         score >= 90
 * - medium:       score >= 60
 * - low:          score >= 30
 * - insufficient: score < 30 (or missing)
 */
export const EVIDENCE_QUALITY_THRESHOLDS = {
  high: 90,
  medium: 60,
  low: 30,
} as const;

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Resolve the Evidence Admission Score from an OAA report.
 *
 * The direct issuance API accepts EAS at the top level
 * (`report.evidence_admission_score`). The report engine's persisted JSON
 * bundle nests it under `risk_score.evidence_admission_score` (see
 * `buildJson`). Accept both so a server-audited issuance built from the stored
 * report bundle derives the same evidence quality as a direct issuance.
 */
function resolveEas(
  report: Record<string, unknown>,
): { score?: number; grade?: string } | undefined {
  const direct = report.evidence_admission_score;
  if (direct !== null && typeof direct === 'object') {
    return direct as { score?: number; grade?: string };
  }
  const nested = report.risk_score;
  if (nested !== null && typeof nested === 'object') {
    const eas = (nested as Record<string, unknown>).evidence_admission_score;
    if (eas !== null && typeof eas === 'object') {
      return eas as { score?: number; grade?: string };
    }
  }
  return undefined;
}

/**
 * Derive a qualitative evidence quality level from the report's EAS score.
 *
 * Evidence quality thresholds:
 * - high:         score >= 90
 * - medium:       score >= 60
 * - low:          score >= 30
 * - insufficient: score < 30 (or missing)
 *
 * @see EVIDENCE_QUALITY_THRESHOLDS — exported constants for programmatic access
 */
function deriveEvidenceQuality(
  report: Record<string, unknown>,
): 'high' | 'medium' | 'low' | 'insufficient' {
  const score = resolveEas(report)?.score;
  if (!score) return 'insufficient';
  if (score >= EVIDENCE_QUALITY_THRESHOLDS.high) return 'high';
  if (score >= EVIDENCE_QUALITY_THRESHOLDS.medium) return 'medium';
  if (score >= EVIDENCE_QUALITY_THRESHOLDS.low) return 'low';
  return 'insufficient';
}

function deriveFrameworkMappings(report: Record<string, unknown>): FrameworkMapping[] {
  const mappings: FrameworkMapping[] = [];
  const meta = report.meta as Record<string, unknown> | undefined;
  const profilesApplied = (report.profiles_applied ?? meta?.profiles_applied ?? []) as string[];

  const KNOWN_FRAMEWORKS: Record<string, string> = {
    'owasp-agentic-top10-2026': 'OWASP Agentic Top 10 (2026)',
    'nist-ai-rmf-1.0': 'NIST AI RMF 1.0',
    'eu-ai-act-2024': 'EU AI Act (2024)',
    'iso-42001': 'ISO 42001',
  };

  for (const profile of profilesApplied) {
    if (!KNOWN_FRAMEWORK_PROFILES.has(profile)) {
      console.warn(
        `[OpenAgentAudit] Unrecognized profile "${profile}" in profiles_applied. Custom strings are allowed but verify spelling.`,
      );
    }
    const framework = KNOWN_FRAMEWORKS[profile] ?? profile;
    mappings.push({
      framework,
      coverage: 'selected_technical_evidence',
    });
  }

  if (mappings.length === 0) {
    mappings.push({
      framework: 'OWASP Agentic Top 10 (2026)',
      coverage: 'selected_technical_evidence',
      note: 'Default profile applied',
    });
  }

  return mappings;
}

function deriveRiskSummary(report: Record<string, unknown>): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  open_findings: number;
} {
  const findings = (report.findings ?? []) as Array<{ severity?: string }>;
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const f of findings) {
    switch (f.severity) {
      case 'critical':
        critical++;
        break;
      case 'high':
        high++;
        break;
      case 'medium':
        medium++;
        break;
      case 'low':
        low++;
        break;
    }
  }

  return { critical, high, medium, low, open_findings: critical + high + medium + low };
}

/**
 * Issue a new TrustPassport from an audit report.
 *
 * **Breaking change (pre-1.0):** This function became `async` in v0.4.0.
 * Callers must `await` the result. The change was required to support
 * async signing via {@link PassportSigner}. Since the package is pre-1.0
 * (semver minor = breaking), no major version bump is needed.
 *
 * @since 0.4.0 — changed from synchronous to async
 */
export async function issue(options: IssueOptions): Promise<TrustPassport | SignedPassport> {
  const {
    report,
    agentId,
    agentName,
    agentbom,
    posture,
    validityDays = 90,
    issuer = 'trustavo.com',
    issuanceContext = 'self-issued',
    signer,
  } = options;

  const reportJson = JSON.stringify(report);
  const reportHash = sha256(reportJson);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const passportId = `tp-${randomUUID()}`;
  const reportObj = (typeof report === 'object' && report !== null ? report : {}) as Record<
    string,
    unknown
  >;

  const easData = resolveEas(reportObj);

  // Detect DSSE attestation format from report metadata
  const reportMeta = reportObj.meta as Record<string, unknown> | undefined;
  const reportEvents = (reportObj.events ?? []) as Array<{ evidence?: { attestation_format?: string } }>;
  const hasDsseAttestation = reportEvents.some(
    (e) => e.evidence?.attestation_format === 'dsse',
  ) || (reportMeta?.attestation_format === 'dsse');

  const passport: TrustPassport = {
    passport_version: '0.1',
    identity: {
      passport_id: passportId,
      agent_id: agentId,
      ...(agentName !== undefined ? { agent_name: agentName } : {}),
      issuer,
      issuance_context: issuanceContext,
    },
    audit_ref: {
      report_id: (reportObj.run_id ?? reportObj.report_id ?? passportId) as string,
      report_hash: reportHash,
      generated_at: now.toISOString(),
    },
    evidence_summary: {
      evidence_quality: deriveEvidenceQuality(reportObj),
      ...(easData?.score !== undefined ? { eas_score: easData.score } : {}),
      framework_mappings: deriveFrameworkMappings(reportObj),
      ...(hasDsseAttestation ? { attestation_format: 'dsse' as const } : {}),
    },
    risk_summary: deriveRiskSummary(reportObj),
    validity: {
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      renewal_triggers: [
        'agentbom_changed',
        'critical_finding_discovered',
        'posture_drift_detected',
        'deployment_context_changed',
      ],
    },
    revocation: {
      revoked: false,
    },
    attestation: {
      issuer,
      signing_method: 'none',
    },
  };

  if (agentbom) {
    const bomJson = JSON.stringify(agentbom);
    const bomObj = agentbom as Record<string, unknown>;
    passport.agentbom_ref = {
      agentbom_id: (bomObj.agentbom_id as string | undefined) ?? `bom-${passportId}`,
      agentbom_hash: sha256(bomJson),
      captured_at: now.toISOString(),
    };
  }

  if (posture) {
    const postureJson = JSON.stringify(posture);
    const postureObj = posture as Record<string, unknown>;
    passport.posture_ref = {
      snapshot_id: (postureObj.snapshot_id as string | undefined) ?? `pos-${passportId}`,
      snapshot_hash: sha256(postureJson),
      captured_at: now.toISOString(),
    };
  }

  // The attestation hash binds the issuance: it is the sha256 of the canonical
  // issuance payload (passport minus attestation), recomputable by any verifier
  // and used to bind external revocation records (N3-P1-06).
  passport.attestation.passport_hash = issuanceDigest(passport);

  if (signer) {
    return signPassport(passport, signer);
  }

  return passport;
}
