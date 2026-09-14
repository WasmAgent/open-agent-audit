import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import type { TrustPassport } from './types.js';

export interface PassportSigner {
  readonly keyId: string;
  sign(bytes: Uint8Array): Promise<string>; // returns base64 sig
}

export interface SignedPassport extends TrustPassport {
  attestation: {
    issuer: string;
    signing_method: 'ed25519';
    key_id: string;
    signature: string; // base64 Ed25519 signature over canonical passport bytes
    signed_at: string; // ISO 8601
    passport_hash?: string;
  };
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

/**
 * Produce a deterministic canonical JSON string.
 * Recursively sorts all object keys at every level.
 */
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalize(item)).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const entries = sorted.map(
    (key) => JSON.stringify(key) + ':' + canonicalize((obj as Record<string, unknown>)[key]),
  );
  return '{' + entries.join(',') + '}';
}

/**
 * The canonical, immutable issuance payload: the passport with its attestation
 * stripped. `signPassport` signs exactly these bytes, so this is the payload a
 * revocation record must bind to (N3-P1-06).
 */
export function issuancePayload(passport: TrustPassport): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { attestation, ...rest } = passport;
  return canonicalize(rest);
}

/**
 * sha256 of the canonical issuance payload. Recomputed by a verifier from the
 * passport alone — it never trusts the mutable `attestation.passport_hash`.
 */
export function issuanceDigest(passport: TrustPassport): string {
  return createHash('sha256').update(issuancePayload(passport)).digest('hex');
}

/**
 * signPassport — sign a passport document with Ed25519.
 *
 * Strips any existing attestation.signature, canonicalizes the remaining fields,
 * signs the canonical bytes, and returns a new passport with attestation filled.
 */
export async function signPassport(
  passport: TrustPassport,
  signer: PassportSigner,
): Promise<SignedPassport> {
  const { attestation } = passport;
  const canonical = issuancePayload(passport);
  const bytes = new TextEncoder().encode(canonical);
  const sig = await signer.sign(bytes);
  return {
    ...passport,
    attestation: {
      ...(attestation ?? { issuer: passport.identity.issuer }),
      signing_method: 'ed25519',
      key_id: signer.keyId,
      signature: sig,
      signed_at: new Date().toISOString(),
    },
  };
}

/**
 * verifySignature — verify the Ed25519 signature on a signed passport.
 *
 * Also returns invalid when the passport has expired. Use
 * {@link verifySignatureOnly} when you need to separate issuance authenticity
 * from validity/expiry (e.g. layered revocation verification).
 */
export async function verifySignature(
  passport: TrustPassport,
  publicKey: Uint8Array,
): Promise<VerifyResult> {
  const att = passport.attestation;
  if (!att || att.signing_method !== 'ed25519') {
    return { valid: false, error: 'Passport is not signed with ed25519' };
  }

  if (!att.signature) {
    return { valid: false, error: 'Missing signature in attestation' };
  }

  // Check expiry
  if (passport.validity?.expires_at) {
    const expiresAt = new Date(passport.validity.expires_at);
    if (expiresAt.getTime() < Date.now()) {
      return { valid: false, error: 'Passport has expired' };
    }
  }

  return verifySignatureOnly(passport, publicKey);
}

/**
 * verifySignatureOnly — verify the Ed25519 signature over the immutable
 * issuance payload, **ignoring expiry and revocation**. This isolates signature
 * authenticity so a caller can report "authentic issuance, subsequently
 * revoked" instead of collapsing everything to one boolean (N2-P1-01).
 */
export async function verifySignatureOnly(
  passport: TrustPassport,
  publicKey: Uint8Array,
): Promise<VerifyResult> {
  const att = passport.attestation;
  if (!att || att.signing_method !== 'ed25519') {
    return { valid: false, error: 'Passport is not signed with ed25519' };
  }

  if (!att.signature) {
    return { valid: false, error: 'Missing signature in attestation' };
  }

  // Strip attestation, canonicalize
  const canonical = issuancePayload(passport);
  const bytes = new TextEncoder().encode(canonical);

  try {
    // Decode base64 signature inside the try: a malformed/foreign-alphabet
    // signature makes atob throw, and callers rely on VerifyResult rather
    // than catching.
    const sigBytes = Uint8Array.from(atob(att.signature), (c) => c.charCodeAt(0));
    const valid = await ed.verifyAsync(sigBytes, bytes, publicKey);
    if (!valid) {
      return { valid: false, error: 'Signature verification failed' };
    }
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Verification error: ${message}` };
  }
}
