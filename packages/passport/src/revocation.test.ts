import { describe, expect, test } from 'bun:test';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import {
  createRevocationRecord,
  issue,
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

    const layers = await verifyPassportLayers({ passport, publicKey });
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
    const layers = await verifyPassportLayers({ passport, publicKey });
    expect(layers.issuance_authenticity).toBe('valid');
    expect(layers.revocation_status).toBe('active');
  });

  test('PR-08 tampered issuance is not reported as revoked', async () => {
    const { passport, publicKey } = await signedPassport();
    passport.identity.agent_name = 'Tampered';

    const layers = await verifyPassportLayers({ passport, publicKey });
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
