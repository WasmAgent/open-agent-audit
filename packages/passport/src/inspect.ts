import { status } from './lifecycle.js';
import type { TrustPassport } from './types.js';

export interface InspectOptions {
  /** Include evidence facts detail. Default: false */
  verbose?: boolean;
}

/**
 * inspectTrustPassport — returns a formatted multi-line string showing:
 * - Agent identity (id, name, version)
 * - Issuer
 * - Validity window (issued_at -> expires_at)
 * - Status: ACTIVE / EXPIRED / REVOKED
 * - Evidence quality level
 * - Risk summary (if present)
 * - Signing method
 */
export function inspectTrustPassport(passport: TrustPassport, opts?: InspectOptions): string {
  const lines: string[] = [];

  lines.push('=== Trust Passport ===');
  lines.push(`Passport ID : ${passport.identity.passport_id}`);
  lines.push(`Agent ID    : ${passport.identity.agent_id}`);
  if (passport.identity.agent_name) {
    lines.push(`Agent Name  : ${passport.identity.agent_name}`);
  }
  lines.push(`Issuer      : ${passport.identity.issuer}`);
  lines.push('');

  // Validity
  const currentStatus = status(passport);
  const statusLabel = currentStatus.toUpperCase();
  lines.push(`Status      : ${statusLabel}`);
  lines.push(`Issued At   : ${passport.validity.issued_at}`);
  lines.push(`Expires At  : ${passport.validity.expires_at}`);
  if (passport.validity.renewed_at) {
    lines.push(`Renewed At  : ${passport.validity.renewed_at}`);
  }
  if (passport.validity.renewal_count) {
    lines.push(`Renewals    : ${passport.validity.renewal_count}`);
  }
  lines.push('');

  // Evidence quality
  if (passport.evidence_summary?.evidence_quality) {
    lines.push(`Evidence    : ${passport.evidence_summary.evidence_quality}`);
  }

  // Risk summary
  if (passport.risk_summary) {
    const rs = passport.risk_summary;
    lines.push(
      `Risk        : C=${rs.critical ?? 0} H=${rs.high ?? 0} M=${rs.medium ?? 0} L=${rs.low ?? 0} (open=${rs.open_findings ?? 0})`,
    );
  }
  lines.push('');

  // Signing method
  const sigMethod = passport.attestation?.signing_method ?? 'none';
  lines.push(`Signing     : ${sigMethod}`);
  if (passport.attestation?.key_id) {
    lines.push(`Key ID      : ${passport.attestation.key_id}`);
  }

  // Verbose: evidence facts
  if (opts?.verbose && passport.evidence_facts) {
    lines.push('');
    lines.push('--- Evidence Facts ---');
    for (const [factId, fact] of Object.entries(passport.evidence_facts)) {
      lines.push(`  ${factId}: ${fact.content_hash} (${fact.recorded_at})`);
    }
  }

  return lines.join('\n');
}
