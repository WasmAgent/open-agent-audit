import type { TrustPassport } from './types.js';
import * as ed from '@noble/ed25519';

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
function canonicalize(obj: unknown): string {
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
 * signPassport — sign a passport document with Ed25519.
 *
 * Strips any existing attestation.signature, canonicalizes the remaining fields,
 * signs the canonical bytes, and returns a new passport with attestation filled.
 */
export async function signPassport(passport: TrustPassport, signer: PassportSigner): Promise<SignedPassport> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { attestation, ...rest } = passport;
  const canonical = canonicalize(rest);
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
 */
export async function verifySignature(passport: TrustPassport, publicKey: Uint8Array): Promise<VerifyResult> {
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

  // Strip attestation, canonicalize
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { attestation, ...rest } = passport;
  const canonical = canonicalize(rest);
  const bytes = new TextEncoder().encode(canonical);

  // Decode base64 signature
  const sigBytes = Uint8Array.from(atob(att.signature), (c) => c.charCodeAt(0));

  try {
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
