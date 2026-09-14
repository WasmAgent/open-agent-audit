import { describe, expect, test } from 'bun:test';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import {
  createRevocationRecord,
  issue,
  renew,
  signPassport,
  verifyPassportLayers,
  verifyRevocation,
  verifySignature,
  verifySignatureOnly,
} from './index.js';
import type { PassportSigner, SignedPassport } from './index.js';

ed.hashes.sha512 = sha512;

const MOCK_REPORT = {
  run_id: 'run-001',
  evidence_admission_score: { score: 85, grade: 'B' },
  findings: [],
  profiles_applied: ['owasp-agentic-top10-2026'],
};

async function createTestSigner(): Promise<{ signer: PassportSigner; publicKey: Uint8Array }> {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const signer: PassportSigner = {
    keyId: 'test-key-001',
    async sign(bytes: Uint8Array): Promise<string> {
      const sig = await ed.signAsync(bytes, privateKey);
      return btoa(String.fromCharCode(...sig));
    },
  };
  return { signer, publicKey };
}

async function signedPassport(): Promise<{ passport: SignedPassport; publicKey: Uint8Array }> {
  const { signer, publicKey } = await createTestSigner();
  const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
  return { passport, publicKey };
}

describe('N2-PP — passport revocation separates from issuance (N2-P1-01)', () => {
  test('PR-01 issued signed passport verifies with active status', async () => {
    const { passport, publicKey } = await signedPassport();
    expect((await verifySignature(passport, publicKey)).valid).toBe(true);

    const layers = await verifyPassportLayers({
      passport,
      publicKey,
      revocationSourceTrusted: true,
    });
    expect(layers.issuance_authenticity).toBe('valid');
    expect(layers.revocation_status).toBe('active');
    expect(layers.revocation_authenticity).toBe('not-present');
  });

  test('PR-02 external revoke does not alter issuance bytes or signature', async () => {
    const { passport, publicKey } = await signedPassport();
    const before = JSON.stringify(passport);

    const revocation = await createRevocationRecord({ passport, reason: 'compromised' });
    expect(revocation.passport_id).toBe(passport.identity.passport_id);

    // The signed passport object is untouched and still verifies.
    expect(JSON.stringify(passport)).toBe(before);
    expect((await verifySignature(passport, publicKey)).valid).toBe(true);
    expect((await verifySignatureOnly(passport, publicKey)).valid).toBe(true);
  });

  test('PR-03 valid signed revocation reports REVOKED', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({
      passport,
      reason: 'issuer-decision',
      signer,
      effectiveAt: new Date().toISOString(),
    });

    const layers = await verifyPassportLayers({ passport, publicKey, revocation });
    expect(layers.issuance_authenticity).toBe('valid');
    expect(layers.revocation_authenticity).toBe('valid');
    expect(layers.revocation_status).toBe('revoked');
    expect(layers.status_freshness).toBe('current');
  });

  test('PR-04 forged revocation is rejected and cannot revoke', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport, reason: 'legit', signer });
    // Tamper after signing.
    revocation.reason = 'forged';

    expect((await verifyRevocation(revocation, publicKey)).valid).toBe(false);
    const layers = await verifyPassportLayers({ passport, publicKey, revocation });
    expect(layers.revocation_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('unknown');
  });

  test('PR-05 revocation bound to a different passport_hash is rejected', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passportA = (await issue({ report: MOCK_REPORT, agentId: 'agent-a', signer })) as SignedPassport;
    const passportB = (await issue({ report: MOCK_REPORT, agentId: 'agent-b', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport: passportA, reason: 'x', signer });

    const layers = await verifyPassportLayers({ passport: passportB, publicKey, revocation });
    expect(layers.revocation_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('unknown');
  });

  test('PR-06 stale sequence / replay is rejected', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport, reason: 'old', signer, sequence: 3 });

    const layers = await verifyPassportLayers({
      passport,
      publicKey,
      revocation,
      expectedSequence: 5,
    });
    expect(layers.revocation_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('unknown');
  });

  test('PR-07 expired issuance is not reported as revoked', async () => {
    const { signer, publicKey } = await createTestSigner();
    const p = await issue({ report: MOCK_REPORT, agentId: 'agent-1' });
    p.validity.expires_at = new Date(Date.now() - 1000).toISOString();
    const passport = (await signPassport(p, signer)) as SignedPassport;

    // Full signature check fails on expiry...
    expect((await verifySignature(passport, publicKey)).valid).toBe(false);
    // ...but issuance authenticity (signature only) and revocation stay separate.
    const layers = await verifyPassportLayers({
      passport,
      publicKey,
      revocationSourceTrusted: true,
    });
    expect(layers.issuance_authenticity).toBe('valid');
    expect(layers.revocation_status).toBe('active');
  });

  test('PR-08 tampered issuance is not reported as revoked', async () => {
    const { passport, publicKey } = await signedPassport();
    passport.identity.agent_name = 'Tampered';

    const layers = await verifyPassportLayers({
      passport,
      publicKey,
      revocationSourceTrusted: true,
    });
    expect(layers.issuance_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('active');
  });

  test('stale revocation record is reported stale, not current', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const revocation = await createRevocationRecord({ passport, reason: 'x', signer, effectiveAt: old });

    const layers = await verifyPassportLayers({ passport, publicKey, revocation });
    expect(layers.status_freshness).toBe('stale');
  });
});

describe('N3-PP — canonical issuance binding + authenticity semantics', () => {
  test('N3-PP-09 revoke A then verify against B is invalid/unknown', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passportA = (await issue({ report: MOCK_REPORT, agentId: 'agent-a', signer })) as SignedPassport;
    const passportB = (await issue({ report: MOCK_REPORT, agentId: 'agent-b', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport: passportA, reason: 'x', signer });

    const layers = await verifyPassportLayers({ passport: passportB, publicKey, revocation });
    expect(layers.revocation_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('unknown');
  });

  test('N3-PP-10 mutating B.attestation.passport_hash cannot bind A revocation to B', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passportA = (await issue({ report: MOCK_REPORT, agentId: 'agent-a', signer })) as SignedPassport;
    const passportB = (await issue({ report: MOCK_REPORT, agentId: 'agent-b', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport: passportA, reason: 'x', signer });

    // The attestation object is NOT part of the signed issuance payload, so an
    // attacker can rewrite it freely — the verifier must recompute the digest.
    if (revocation.passport_hash !== undefined) {
      passportB.attestation.passport_hash = revocation.passport_hash;
    }

    const layers = await verifyPassportLayers({ passport: passportB, publicKey, revocation });
    expect(layers.revocation_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('unknown');
  });

  test('N3-PP-11 signed revocation without canonical issuance digest fails closed', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport, reason: 'x', signer });
    const revocationNoHash = { ...revocation } as Record<string, unknown>;
    delete revocationNoHash.passport_hash;

    const layers = await verifyPassportLayers({
      passport,
      publicKey,
      revocation: revocationNoHash as unknown as typeof revocation,
    });
    expect(layers.revocation_authenticity).toBe('invalid');
    expect(layers.revocation_status).toBe('unknown');
  });

  test('N3-P1-07 unsigned issuance authenticity is not-present, not invalid', async () => {
    const passport = await issue({ report: MOCK_REPORT, agentId: 'agent-1' });
    const layers = await verifyPassportLayers({ passport });
    expect(layers.issuance_authenticity).toBe('not-present');
  });

  test('N3-P1-07 unsigned revocation is unknown unless the registry is trusted', async () => {
    const { passport, publicKey } = await signedPassport();
    const revocation = await createRevocationRecord({ passport, reason: 'x' });

    const untrusted = await verifyPassportLayers({ passport, publicKey, revocation });
    expect(untrusted.revocation_authenticity).toBe('not-present');
    expect(untrusted.revocation_status).toBe('unknown');

    const trusted = await verifyPassportLayers({
      passport,
      publicKey,
      revocation,
      revocationSourceTrusted: true,
    });
    expect(trusted.revocation_status).toBe('revoked');
  });

  test('N3-P1-08 signed renewal mints a new signed issuance and refuses downgrade', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;

    const renewed = (await renew({ passport, report: MOCK_REPORT, signer })) as SignedPassport;
    expect(renewed.identity.passport_id).not.toBe(passport.identity.passport_id);
    expect(renewed.identity.renewed_from).toBe(passport.identity.passport_id);
    expect((await verifySignature(renewed, publicKey)).valid).toBe(true);

    // The original signed issuance is untouched and still verifies.
    expect((await verifySignature(passport, publicKey)).valid).toBe(true);

    await expect(renew({ passport, report: MOCK_REPORT })).rejects.toThrow(/signed/);
  });
});

describe('N4-PP — assurance-truth precision (N4-P1-04, N4-P2-01, N4-P2-02)', () => {
  test('N4-P1-04 missing record without an authoritative lookup is UNKNOWN, not ACTIVE', async () => {
    const { passport, publicKey } = await signedPassport();

    const noLookup = await verifyPassportLayers({ passport, publicKey });
    expect(noLookup.revocation_status).toBe('unknown');
    expect(noLookup.revocation_authenticity).toBe('not-present');

    const lookedUp = await verifyPassportLayers({
      passport,
      publicKey,
      revocationSourceTrusted: true,
    });
    expect(lookedUp.revocation_status).toBe('active');
  });

  test('N4-P2-01 signed but unverifiable is UNVERIFIED, never INVALID', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const revocation = await createRevocationRecord({ passport, reason: 'x', signer });

    // Verifier lacks the issuer key: cannot check the signature.
    const noKey = await verifyPassportLayers({ passport, revocation });
    expect(noKey.issuance_authenticity).toBe('unverified');
    expect(noKey.revocation_authenticity).toBe('unverified');
    expect(noKey.revocation_status).toBe('unknown');

    // With a trusted registry the assertion is authoritative despite no local key.
    const trusted = await verifyPassportLayers({
      passport,
      revocation,
      revocationSourceTrusted: true,
    });
    expect(trusted.revocation_authenticity).toBe('unverified');
    expect(trusted.revocation_status).toBe('revoked');

    // A wrong key is a checked-and-failed signature: INVALID.
    const wrongKey = await createTestSigner();
    const failed = await verifyPassportLayers({ passport, revocation, publicKey: wrongKey.publicKey });
    expect(failed.revocation_authenticity).toBe('invalid');
    void publicKey;
  });

  test('N4-P2-02 future effective_at beyond clock skew fails closed', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = (await issue({ report: MOCK_REPORT, agentId: 'agent-1', signer })) as SignedPassport;
    const now = Date.now();
    const future = new Date(now + 60 * 60 * 1000).toISOString();
    const revocation = await createRevocationRecord({ passport, reason: 'future', signer, effectiveAt: future });

    const layers = await verifyPassportLayers({ passport, publicKey, revocation, now });
    expect(layers.revocation_authenticity).toBe('valid');
    expect(layers.revocation_status).toBe('unknown');
    expect(layers.status_freshness).toBe('unknown');

    // Within tolerated skew the record is treated as effective now.
    const soon = new Date(now + 1000).toISOString();
    const withinSkew = await createRevocationRecord({
      passport,
      reason: 'skew',
      signer,
      effectiveAt: soon,
    });
    const skewLayers = await verifyPassportLayers({ passport, publicKey, revocation: withinSkew, now });
    expect(skewLayers.revocation_status).toBe('revoked');
    expect(skewLayers.status_freshness).toBe('current');
  });

  test('N4-P2-03 administrative extension carries the original evidence time', async () => {
    const { signer } = await createTestSigner();
    const passport = (await issue({
      report: MOCK_REPORT,
      agentId: 'agent-1',
      signer,
      validityDays: 30,
    })) as SignedPassport;
    const originalEvidence = passport.audit_ref?.generated_at ?? passport.validity.issued_at;

    const extended = (await renew({ passport, validityDays: 30, signer })) as SignedPassport;
    expect(extended.validity.renewal_basis).toBe('administrative_extension');
    expect(extended.validity.evidence_as_of).toBe(originalEvidence);
    // The declared evidence time is the original evidence, never a fresh one.
    expect(extended.audit_ref?.generated_at).toBe(originalEvidence);

    const reaudited = (await renew({
      passport,
      report: MOCK_REPORT,
      validityDays: 30,
      signer,
    })) as SignedPassport;
    expect(reaudited.validity.renewal_basis).toBe('reaudit');
    expect(reaudited.validity.evidence_as_of).toBe(reaudited.validity.issued_at);

    // Optional cap fails closed when the original evidence is too old.
    const stale: SignedPassport = {
      ...passport,
      audit_ref: { ...passport.audit_ref, generated_at: new Date(Date.now() - 100 * 864e5).toISOString() },
    };
    await expect(
      renew({ passport: stale, validityDays: 30, signer, maxEvidenceAgeDays: 30 }),
    ).rejects.toThrow(/administrative extension refused/);
  });
});
