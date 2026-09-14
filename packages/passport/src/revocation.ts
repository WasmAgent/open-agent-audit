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
import { canonicalize, issuanceDigest, verifySignatureOnly } from './sign.js';
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
/**
 * Signal authenticity. `unverified` means an assertion exists but the verifier
 * lacks the key/material to check it — it is NOT the same as `invalid`
 * (an assertion that was checked and failed) and NOT `not-present` (no
 * assertion at all). Collapsing `unverified` into `invalid` overclaims
 * certainty (N4-P2-01).
 */
export type LayerAuthenticity = 'valid' | 'invalid' | 'not-present' | 'unverified';
export type StatusFreshness = 'current' | 'stale' | 'unknown';

/** Layered verification result — never collapse to a single boolean. */
export interface PassportVerificationLayers {
  issuance_authenticity: LayerAuthenticity;
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
    // Bind the record to the *canonical issuance payload* recomputed from the
    // passport, never to the mutable attestation hash (N3-P1-06).
    passport_hash: issuanceDigest(passport),
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
  /**
   * Mark the revocation/status source as a trusted registry, meaning an
   * authoritative lookup was performed and its answer (including "no record")
   * may be treated as registry state. An unsigned revocation record is only
   * authoritative when this is set; otherwise its status is `unknown`
   * (N3-P1-07). This flag also gates the "no record supplied" case: absence is
   * only `active` when a trusted lookup succeeded, never merely because no
   * record was handed to the verifier (N4-P1-04).
   */
  revocationSourceTrusted?: boolean;
  /** Revocation records older than this are reported `stale`. Default 24h. */
  maxStalenessMs?: number;
  /**
   * Maximum tolerated clock skew for a future `effective_at`. A record whose
   * `effective_at` is further ahead than this is not yet effective and must not
   * be reported as current; the status fails closed to `unknown` (N4-P2-02).
   * Default 5 minutes.
   */
  maxClockSkewMs?: number;
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
  const revocationSourceTrusted = options.revocationSourceTrusted === true;
  const maxStalenessMs = options.maxStalenessMs ?? 24 * 60 * 60 * 1000;
  const maxClockSkewMs = options.maxClockSkewMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now();

  // Issuance authenticity: signature over the immutable issuance only. Expiry
  // and revocation are deliberately NOT folded in (expired != tampered).
  // Absent signing is reported as `not-present`, never as `invalid`, so "no
  // assertion" is not conflated with "assertion present but wrong" (N3-P1-07).
  // A signature we cannot check (no public key) is `unverified`, not `invalid`
  // (N4-P2-01).
  let issuanceAuthenticity: LayerAuthenticity;
  if (passport.attestation?.signing_method === 'ed25519' && passport.attestation.signature) {
    if (!publicKey) {
      issuanceAuthenticity = 'unverified';
    } else {
      issuanceAuthenticity = (await verifySignatureOnly(passport, publicKey)).valid
        ? 'valid'
        : 'invalid';
    }
  } else {
    issuanceAuthenticity = 'not-present';
  }

  if (revocation === null || revocation === undefined) {
    // Absence is authoritative registry state ONLY when the caller attests that
    // an authoritative lookup was performed. "No record supplied" alone must
    // not become ACTIVE (N4-P1-04).
    return {
      issuance_authenticity: issuanceAuthenticity,
      revocation_status: revocationSourceTrusted ? 'active' : 'unknown',
      revocation_authenticity: 'not-present',
      status_freshness: 'unknown',
    };
  }

  // Revocation authenticity. A signed record we cannot check (no public key) is
  // `unverified`, not `invalid` (N4-P2-01).
  let revocationAuthenticity: LayerAuthenticity;
  if (!revocation.signature) {
    revocationAuthenticity = 'not-present';
  } else if (!publicKey) {
    revocationAuthenticity = 'unverified';
  } else {
    revocationAuthenticity = (await verifyRevocation(revocation, publicKey)).valid
      ? 'valid'
      : 'invalid';
  }

  // Identity binding: the record must revoke *this* passport.
  if (revocation.passport_id !== passport.identity.passport_id) {
    revocationAuthenticity = 'invalid';
  }

  // Canonical issuance-digest binding: recompute the digest from the passport
  // (attestation is mutable and unsigned) and require the record to match it.
  const digest = issuanceDigest(passport);
  const hasDigest = revocation.passport_hash !== undefined;
  if (hasDigest && revocation.passport_hash !== digest) {
    revocationAuthenticity = 'invalid';
  }
  // A signed status record must carry the canonical issuance digest; otherwise
  // it is not bound to the issuance and must fail closed (N3-PP-11).
  if (revocation.signature && !hasDigest) {
    revocationAuthenticity = 'invalid';
  }

  // Replay/sequence guard: an older record must not revoke a newer issuance.
  if (expectedSequence !== undefined && revocation.sequence < expectedSequence) {
    revocationAuthenticity = 'invalid';
  }

  // A record that is not authenticated (no signature, or a signature we cannot
  // check) is only authoritative when the caller marks the source as trusted;
  // otherwise the status is unknown (N3-P1-07, N4-P2-01).
  const unauthenticated =
    revocationAuthenticity === 'not-present' || revocationAuthenticity === 'unverified';

  let revocationStatus: RevocationStatus;
  if (revocationAuthenticity === 'invalid') {
    revocationStatus = 'unknown';
  } else if (unauthenticated && !revocationSourceTrusted) {
    revocationStatus = 'unknown';
  } else if (revocation.status === 'revoked') {
    revocationStatus = 'revoked';
  } else {
    revocationStatus = 'active';
  }

  // Explicit temporal rule (N4-P2-02): a revocation cannot take effect in the
  // future beyond tolerated clock skew. Such a record is not yet in force and
  // must fail closed instead of reporting a state (or a negative age that would
  // masquerade as fresh).
  const effectiveMs = Date.parse(revocation.effective_at);
  const futureBeyondSkew = !Number.isNaN(effectiveMs) && effectiveMs > now + maxClockSkewMs;
  if (futureBeyondSkew) {
    revocationStatus = 'unknown';
  }

  let statusFreshness: StatusFreshness;
  if (futureBeyondSkew || Number.isNaN(effectiveMs)) {
    statusFreshness = 'unknown';
  } else if (now - effectiveMs > maxStalenessMs) {
    statusFreshness = 'stale';
  } else {
    statusFreshness = 'current';
  }

  return {
    issuance_authenticity: issuanceAuthenticity,
    revocation_status: revocationStatus,
    revocation_authenticity: revocationAuthenticity,
    status_freshness: statusFreshness,
  };
}

/**
 * Convenience: the revocation status alone. Absence is only `active` when the
 * caller declares an authoritative lookup succeeded (`revocationSourceTrusted`)
 * — otherwise it is `unknown` (N4-P1-04).
 */
export function statusFromRevocation(
  revocation: TrustPassportRevocation | null | undefined,
  opts: {
    authenticate?: (record: TrustPassportRevocation) => boolean;
    revocationSourceTrusted?: boolean;
  } = {},
): RevocationStatus {
  if (!revocation) return opts.revocationSourceTrusted === true ? 'active' : 'unknown';
  if (opts.authenticate && !opts.authenticate(revocation)) return 'unknown';
  return revocation.status === 'revoked' ? 'revoked' : 'active';
}
