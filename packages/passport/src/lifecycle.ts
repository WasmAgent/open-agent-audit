import { createHash, randomUUID } from 'node:crypto';
import { issuanceDigest, signPassport } from './sign.js';
import type { SignedPassport } from './sign.js';
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

/**
 * Renew a passport into a **new immutable issuance** (N3-P1-08).
 *
 * Renewal never mutates the signed issuance in place: it mints a new passport
 * id, records `identity.renewed_from` lineage, fresh validity and a fresh
 * attestation. A signed source passport requires a signer (so the new issuance
 * is signed too); an unsigned source may be renewed unsigned. Callers must
 * `await` this function.
 */
export async function renew(options: RenewOptions): Promise<TrustPassport | SignedPassport> {
  const { passport, report, agentbom, posture, validityDays = 90, signer } = options;

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

  // Never silently downgrade a signed issuance to an unsigned one.
  if (passport.attestation?.signing_method === 'ed25519' && !signer) {
    throw new Error(
      `passport renew: passport ${passport.identity.passport_id} is signed (ed25519) ` +
        'but no signer was provided — refusing to re-issue an unsigned renewal.',
    );
  }

  const now = new Date();
  if (!Number.isFinite(validityDays) || validityDays <= 0) {
    throw new Error(
      `passport renew: validityDays must be a positive finite number (got ${validityDays}).`,
    );
  }
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const newPassportId = `tp-${randomUUID()}`;

  const renewed: TrustPassport = {
    ...passport,
    identity: {
      ...passport.identity,
      passport_id: newPassportId,
      renewed_from: passport.identity.passport_id,
    },
    ...(report !== undefined
      ? {
          audit_ref: {
            report_id:
              ((typeof report === 'object' && report !== null
                ? (report as Record<string, unknown>).run_id
                : undefined) as string | undefined) ?? newPassportId,
            report_hash: sha256(JSON.stringify(report)),
            generated_at: now.toISOString(),
          },
        }
      : {}),
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
      issuer: passport.attestation?.issuer ?? passport.identity.issuer,
      signing_method: 'none',
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

  renewed.attestation.passport_hash = issuanceDigest(renewed);

  if (signer) {
    return signPassport(renewed, signer);
  }
  return renewed;
}

/**
 * @deprecated Mutating a passport to record revocation invalidates its
 * issuance signature (the `revocation` field is part of the signed payload), so
 * a verifier reports "tampered" instead of "authentic, revoked" (N2-P1-01).
 *
 * Use `createRevocationRecord` + `verifyPassportLayers` from `./revocation.js`
 * to record revocation externally. This function is retained only for parsing
 * and producing the historical embedded-revocation format.
 */
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
