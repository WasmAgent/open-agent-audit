/**
 * External, signed passport revocation records (N2-P1-01).
 *
 * Issuance is immutable. Revoking a passport must not mutate the signed
 * passport bytes (which would invalidate the issuance signature and make a
 * verifier report "tampered" instead of "authentic issuance, revoked").
 * Instead, revocation is represented as a separate signed status record.
 *
 * Embedded `revocation` on a passport is retained only for parsing historical
 * (legacy) documents — see `revoke()` in lifecycle.ts.
 */
import * as ed from '@noble/ed25519';
import { canonicalize, verifySignatureOnly } from './sign.js';
import type { PassportSigner } from './sign.js';
import type { TrustPassport } from './types.js';

export const PASSPORT_REVOCATION_TYPE = 'TrustPassportRevocation' as const;

export interface TrustPassportRevocation {
  type: typeof PASSPORT_REVOCATION_TYPE;
  passport_id: string;
  /** Hash of the issuance this record revokes, when known. */
  passport_hash?: string;
  status: 'revoked';
  reason?: string;
  effective_at: string;
  /** Monotonic per-passport sequence; guards against replay of older records. */
  sequence: number;
  issuer: string;
  key_id?: string;
  signature?: string;
}

export type RevocationStatus = 'active' | 'revoked' | 'unknown';
export type LayerAuthenticity = 'valid' | 'invalid' | 'not-present';
export type StatusFreshness = 'current' | 'stale' | 'unknown';

/** Layered verification result — never collapse to a single boolean. */
export interface PassportVerificationLayers {
  issuance_authenticity: 'valid' | 'invalid';
  revocation_status: RevocationStatus;
  revocation_authenticity: LayerAuthenticity;
  status_freshness: StatusFreshness;
}

export interface CreateRevocationOptions {
  passport: TrustPassport;
  reason?: string;
  sequence?: number;
  effectiveAt?: string;
  issuer?: string;
  signer?: PassportSigner;
}

type RevocationPayload = Omit<TrustPassportRevocation, 'signature' | 'key_id'>;

/** Strip the signature/key material so only the signed payload is canonicalized. */
export function revocationPayload(record: TrustPassportRevocation): RevocationPayload {
  const { signature, key_id, ...payload } = record;
  return payload;
}

/**
 * Build a revocation record for an issuance. When a signer is supplied the
 * record is signed over the canonical payload; otherwise it is unsigned (the
 * registry itself is the trust anchor).
 */
export async function createRevocationRecord(
  options: CreateRevocationOptions,
): Promise<TrustPassportRevocation> {
  const {
    passport,
    reason,
    sequence = 1,
    effectiveAt = new Date().toISOString(),
    signer,
  } = options;

  const record: TrustPassportRevocation = {
    type: PASSPORT_REVOCATION_TYPE,
    passport_id: passport.identity.passport_id,
    status: 'revoked',
    ...(reason !== undefined ? { reason } : {}),
    effective_at: effectiveAt,
    sequence,
    issuer: options.issuer ?? passport.identity.issuer,
    ...(passport.attestation?.passport_hash !== undefined
      ? { passport_hash: passport.attestation.passport_hash }
      : {}),
  };

  if (!signer) return record;

  const bytes = new TextEncoder().encode(canonicalize(revocationPayload(record)));
  const signature = await signer.sign(bytes);
  return { ...record, key_id: signer.keyId, signature };
}

export interface RevocationVerifyResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify the Ed25519 signature on a revocation record. Does not evaluate
 * freshness or sequence — see {@link verifyPassportLayers}.
 */
export async function verifyRevocation(
  record: TrustPassportRevocation,
  publicKey: Uint8Array,
): Promise<RevocationVerifyResult> {
  if (!record.signature) {
    return { valid: false, error: 'Missing signature on revocation record' };
  }
  const payload = canonicalize(revocationPayload(record));
  const bytes = new TextEncoder().encode(payload);
  try {
    const sigBytes = Uint8Array.from(atob(record.signature), (c) => c.charCodeAt(0));
    const valid = await ed.verifyAsync(sigBytes, bytes, publicKey);
    return valid ? { valid: true } : { valid: false, error: 'Revocation signature verification failed' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Verification error: ${message}` };
  }
}

export interface VerifyLayersOptions {
  passport: TrustPassport;
  /** Issuer public key; when absent signatures cannot be checked. */
  publicKey?: Uint8Array;
  /** External revocation/status record, if the registry returned one. */
  revocation?: TrustPassportRevocation | null;
  /** Reject records older than this sequence (replay guard). */
  expectedSequence?: number;
  /** Revocation records older than this are reported `stale`. Default 24h. */
  maxStalenessMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: number;
}

/**
 * Verify a passport across independent layers instead of one boolean:
 * issuance authenticity, revocation status, revocation authenticity and
 * status freshness (N2-P1-01).
 */
export async function verifyPassportLayers(
  options: VerifyLayersOptions,
): Promise<PassportVerificationLayers> {
  const { passport, publicKey, revocation, expectedSequence } = options;
  const maxStalenessMs = options.maxStalenessMs ?? 24 * 60 * 60 * 1000;
  const now = options.now ?? Date.now();

  // Issuance authenticity: signature over the immutable issuance only. Expiry
  // and revocation are deliberately NOT folded in (expired != tampered).
  let issuanceAuthenticity: 'valid' | 'invalid';
  if (passport.attestation?.signing_method === 'ed25519' && publicKey) {
    issuanceAuthenticity = (await verifySignatureOnly(passport, publicKey)).valid
      ? 'valid'
      : 'invalid';
  } else {
    issuanceAuthenticity = 'invalid';
  }

  if (revocation === null || revocation === undefined) {
    return {
      issuance_authenticity: issuanceAuthenticity,
      revocation_status: 'active',
      revocation_authenticity: 'not-present',
      status_freshness: 'unknown',
    };
  }

  // Revocation authenticity.
  let revocationAuthenticity: LayerAuthenticity;
  if (!revocation.signature) {
    revocationAuthenticity = 'not-present';
  } else if (!publicKey) {
    revocationAuthenticity = 'invalid';
  } else {
    revocationAuthenticity = (await verifyRevocation(revocation, publicKey)).valid
      ? 'valid'
      : 'invalid';
  }

  // Bind the record to this issuance when both carry a passport hash.
  const issuedHash = passport.attestation?.passport_hash;
  if (
    revocation.passport_hash !== undefined &&
    issuedHash !== undefined &&
    revocation.passport_hash !== issuedHash
  ) {
    revocationAuthenticity = 'invalid';
  }

  // Replay/sequence guard: an older record must not revoke a newer issuance.
  if (expectedSequence !== undefined && revocation.sequence < expectedSequence) {
    revocationAuthenticity = 'invalid';
  }

  let revocationStatus: RevocationStatus;
  if (revocationAuthenticity === 'invalid') {
    revocationStatus = 'unknown';
  } else if (revocation.status === 'revoked') {
    revocationStatus = 'revoked';
  } else {
    revocationStatus = 'active';
  }

  const age = now - Date.parse(revocation.effective_at);
  const statusFreshness: StatusFreshness = Number.isNaN(age)
    ? 'unknown'
    : age <= maxStalenessMs
      ? 'current'
      : 'stale';

  return {
    issuance_authenticity: issuanceAuthenticity,
    revocation_status: revocationStatus,
    revocation_authenticity: revocationAuthenticity,
    status_freshness: statusFreshness,
  };
}

/** Convenience: the revocation status alone. */
export function statusFromRevocation(
  revocation: TrustPassportRevocation | null | undefined,
  opts: { authenticate?: (record: TrustPassportRevocation) => boolean } = {},
): RevocationStatus {
  if (!revocation) return 'active';
  if (opts.authenticate && !opts.authenticate(revocation)) return 'unknown';
  return revocation.status === 'revoked' ? 'revoked' : 'active';
}
