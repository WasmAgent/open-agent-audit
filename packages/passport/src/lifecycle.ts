import { createHash, randomUUID } from 'node:crypto';
import type { PassportStatus, RenewOptions, RevokeOptions, TrustPassport } from './types.js';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function status(passport: TrustPassport): PassportStatus {
  if (passport.revocation?.revoked) {
    return 'revoked';
  }
  const expiresAt = new Date(passport.validity.expires_at);
  // A missing/unparseable expiry must not read as "valid forever".
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return 'expired';
  }
  return 'valid';
}

export function renew(options: RenewOptions): TrustPassport {
  const { passport, report, agentbom, posture, validityDays = 90 } = options;

  // Revocation is a terminal issuer decision: renewing must never resurrect a
  // revoked passport (which would silently mint a valid identity from a
  // revoked file).
  if (passport.revocation?.revoked) {
    throw new Error(
      `passport renew: passport ${passport.identity.passport_id} is revoked` +
        (passport.revocation.revocation_reason
          ? ` (reason: ${passport.revocation.revocation_reason})`
          : '') +
        ' — revoked passports cannot be renewed; issue a new passport instead.',
    );
  }

  const now = new Date();
  if (!Number.isFinite(validityDays) || validityDays <= 0) {
    throw new Error(
      `passport renew: validityDays must be a positive finite number (got ${validityDays}).`,
    );
  }
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const reportJson = JSON.stringify(report);
  const reportHash = sha256(reportJson);
  const newPassportId = `tp-${randomUUID()}`;
  const reportObj = (typeof report === 'object' && report !== null ? report : {}) as Record<
    string,
    unknown
  >;

  const renewed: TrustPassport = {
    ...passport,
    identity: {
      ...passport.identity,
      passport_id: newPassportId,
    },
    audit_ref: {
      report_id: (reportObj.run_id as string | undefined) ?? newPassportId,
      report_hash: reportHash,
      generated_at: now.toISOString(),
    },
    // Carry forward evidence_facts from the original passport (#77)
    ...(passport.evidence_facts !== undefined
      ? { evidence_facts: { ...passport.evidence_facts } }
      : {}),
    validity: {
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ...(passport.validity.renewal_triggers !== undefined
        ? { renewal_triggers: passport.validity.renewal_triggers }
        : {}),
      renewed_at: now.toISOString(),
      renewal_count: (passport.validity.renewal_count ?? 0) + 1,
    },
    revocation: {
      revoked: false,
    },
    attestation: {
      issuer: passport.attestation.issuer,
      signing_method: 'none',
      passport_hash: sha256(
        JSON.stringify({
          passport_version: '0.1',
          identity: { passport_id: newPassportId, agent_id: passport.identity.agent_id },
          validity: { issued_at: now.toISOString(), expires_at: expiresAt.toISOString() },
        }),
      ),
    },
  };

  if (agentbom) {
    const bomObj = agentbom as Record<string, unknown>;
    renewed.agentbom_ref = {
      agentbom_id: (bomObj.agentbom_id as string | undefined) ?? `bom-${newPassportId}`,
      agentbom_hash: sha256(JSON.stringify(agentbom)),
      captured_at: now.toISOString(),
    };
  }

  if (posture) {
    const postureObj = posture as Record<string, unknown>;
    renewed.posture_ref = {
      snapshot_id: (postureObj.snapshot_id as string | undefined) ?? `pos-${newPassportId}`,
      snapshot_hash: sha256(JSON.stringify(posture)),
      captured_at: now.toISOString(),
    };
  }

  return renewed;
}

export function revoke(options: RevokeOptions): TrustPassport {
  const { passport, reason } = options;
  return {
    ...passport,
    revocation: {
      revoked: true,
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
      ...(passport.validity.renewal_triggers !== undefined
        ? { revocation_triggers: passport.validity.renewal_triggers }
        : {}),
    },
  };
}
