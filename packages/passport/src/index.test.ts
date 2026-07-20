import { describe, expect, test } from 'bun:test';
import {
  issue,
  renew,
  revoke,
  status,
  validateTrustPassport,
  isExpired,
  hashEvidence,
  addFact,
  inspectTrustPassport,
  signPassport,
  verifySignature,
} from './index.js';
import type { TrustPassport, PassportSigner } from './index.js';
import * as ed from '@noble/ed25519';

// Use sha512 for ed25519 in Node/Bun environment
import { sha512 } from '@noble/hashes/sha512';
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const MOCK_REPORT = {
  run_id: 'run-001',
  evidence_admission_score: { score: 85, grade: 'B' },
  findings: [
    { severity: 'medium', title: 'test' },
    { severity: 'low', title: 'test2' },
  ],
  profiles_applied: ['owasp-agentic-top10-2026'],
};

async function createTestSigner(): Promise<{ signer: PassportSigner; publicKey: Uint8Array }> {
  const privateKey = ed.utils.randomPrivateKey();
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

describe('passport/issue', () => {
  test('produces a valid passport', async () => {
    const p = await issue({
      report: MOCK_REPORT,
      agentId: 'agent-123',
      agentName: 'TestAgent',
    });
    expect(p.passport_version).toBe('0.1');
    expect(p.identity.agent_id).toBe('agent-123');
    expect(p.identity.agent_name).toBe('TestAgent');
    expect(p.identity.passport_id).toStartWith('tp-');
    expect(p.identity.issuer).toBe('trustavo.com');
    expect(p.validity.issued_at).toBeTruthy();
    expect(p.validity.expires_at).toBeTruthy();
    expect(p.revocation.revoked).toBe(false);
    expect(p.attestation.signing_method).toBe('none');
  });

  test('derives evidence quality from EAS score', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(p.evidence_summary?.evidence_quality).toBe('medium');
  });

  test('derives risk summary from findings', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(p.risk_summary?.medium).toBe(1);
    expect(p.risk_summary?.low).toBe(1);
    expect(p.risk_summary?.critical).toBe(0);
  });

  test('includes agentbom_ref when provided', async () => {
    const p = await issue({
      report: MOCK_REPORT,
      agentId: 'a',
      agentbom: { agentbom_id: 'bom-1', tools: ['search'] },
    });
    expect(p.agentbom_ref?.agentbom_id).toBe('bom-1');
    expect(p.agentbom_ref?.agentbom_hash).toBeTruthy();
  });

  test('includes posture_ref when provided', async () => {
    const p = await issue({
      report: MOCK_REPORT,
      agentId: 'a',
      posture: { snapshot_id: 'snap-1' },
    });
    expect(p.posture_ref?.snapshot_id).toBe('snap-1');
  });

  test('respects custom validity days', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a', validityDays: 30 });
    const issued = new Date(p.validity.issued_at);
    const expires = new Date(p.validity.expires_at);
    const diffDays = Math.round((expires.getTime() - issued.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  test('with signer produces signed passport', async () => {
    const { signer, publicKey } = await createTestSigner();
    const passport = await issue({
      report: MOCK_REPORT,
      agentId: 'agent-001',
      agentName: 'Test Agent',
      signer,
    });

    expect(passport.attestation.signing_method).toBe('ed25519');
    expect(passport.attestation.key_id).toBe('test-key-001');
    expect(passport.attestation.signature).toBeDefined();

    // Verify the signature
    const result = await verifySignature(passport, publicKey);
    expect(result.valid).toBe(true);
  });

  test('without signer still works (backward compat)', async () => {
    const passport = await issue({
      report: MOCK_REPORT,
      agentId: 'agent-002',
      agentName: 'Test Agent 2',
    });

    expect(passport.attestation.signing_method).toBe('none');
    expect(passport.attestation.signature).toBeUndefined();
    expect(passport.identity.agent_id).toBe('agent-002');
  });
});

describe('passport/status', () => {
  test('returns valid for fresh passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(status(p)).toBe('valid');
  });

  test('returns expired for past expiry', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    p.validity.expires_at = '2020-01-01T00:00:00.000Z';
    expect(status(p)).toBe('expired');
  });

  test('returns revoked when revoked', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const revoked = revoke({ passport: p, reason: 'critical-finding' });
    expect(status(revoked)).toBe('revoked');
  });
});

describe('passport/renew', () => {
  test('produces a new passport with new ID', async () => {
    const original = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const renewed = renew({ passport: original, report: MOCK_REPORT });
    expect(renewed.identity.passport_id).not.toBe(original.identity.passport_id);
    expect(renewed.identity.agent_id).toBe('a');
    expect(renewed.revocation.revoked).toBe(false);
  });

  test('resets revocation state', async () => {
    const original = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const revoked = revoke({ passport: original, reason: 'test' });
    const renewed = renew({ passport: revoked, report: MOCK_REPORT });
    expect(renewed.revocation.revoked).toBe(false);
  });
});

describe('passport/revoke', () => {
  test('sets revoked flag and reason', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const revoked = revoke({ passport: p, reason: 'critical-finding' });
    expect(revoked.revocation.revoked).toBe(true);
    expect(revoked.revocation.revocation_reason).toBe('critical-finding');
    expect(revoked.revocation.revoked_at).toBeTruthy();
  });
});

// ---------- validateTrustPassport ----------

describe('passport/validateTrustPassport', () => {
  function makeValidPassport(): Record<string, unknown> {
    return {
      passport_version: '0.1',
      identity: { passport_id: 'tp-1', agent_id: 'a', issuer: 'trustavo.com' },
      validity: {
        issued_at: '2025-01-01T00:00:00Z',
        expires_at: '2025-04-01T00:00:00Z',
      },
      revocation: { revoked: false },
      attestation: { issuer: 'trustavo.com', signing_method: 'none' },
    };
  }

  test('valid passport passes', () => {
    const result = validateTrustPassport(makeValidPassport());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('missing required fields', () => {
    const result = validateTrustPassport({ passport_version: '0.1' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('identity'))).toBe(true);
    expect(result.errors.some((e) => e.includes('validity'))).toBe(true);
    expect(result.errors.some((e) => e.includes('revocation'))).toBe(true);
    expect(result.errors.some((e) => e.includes('attestation'))).toBe(true);
  });

  test('wrong passport_version', () => {
    const data = makeValidPassport();
    data['passport_version'] = '0.2';
    const result = validateTrustPassport(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('passport_version'))).toBe(true);
  });

  test('non-UTC timestamps rejected', () => {
    const data = makeValidPassport();
    (data['validity'] as Record<string, unknown>)['issued_at'] = '2025-01-01T00:00:00+05:00';
    const result = validateTrustPassport(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('issued_at'))).toBe(true);
  });

  test('invalid coverage enum rejected', () => {
    const data = makeValidPassport();
    data['evidence_summary'] = {
      framework_mappings: [{ framework: 'test', coverage: 'full' }],
    };
    const result = validateTrustPassport(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('coverage'))).toBe(true);
  });

  test('prototype-pollution attempt rejected', () => {
    const data = makeValidPassport();
    Object.defineProperty(data, '__proto__', {
      value: { admin: true },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    // hasPollutionKeys checks getOwnPropertyNames
    const evil = Object.create(null) as Record<string, unknown>;
    evil['__proto__'] = { admin: true };
    evil['passport_version'] = '0.1';
    evil['identity'] = { passport_id: 'tp-1', agent_id: 'a', issuer: 'x' };
    evil['validity'] = { issued_at: '2025-01-01T00:00:00Z', expires_at: '2025-04-01T00:00:00Z' };
    evil['revocation'] = { revoked: false };
    evil['attestation'] = { issuer: 'x' };
    const result = validateTrustPassport(evil);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('prototype-pollution'))).toBe(true);
  });

  test('nested prototype-pollution key rejected', () => {
    const data = makeValidPassport();
    (data['identity'] as Record<string, unknown>)['constructor'] = {};
    const result = validateTrustPassport(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('prototype-pollution'))).toBe(true);
  });

  test('revocation_triggers must be array', () => {
    const data = makeValidPassport();
    (data['revocation'] as Record<string, unknown>)['revocation_triggers'] = 'not-array';
    const result = validateTrustPassport(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('revocation_triggers'))).toBe(true);
  });
});

// ---------- isExpired ----------

describe('passport/isExpired', () => {
  test('returns true for expired passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    p.validity.expires_at = '2020-01-01T00:00:00.000Z';
    expect(isExpired(p)).toBe(true);
  });

  test('returns false for non-expired passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(isExpired(p)).toBe(false);
  });

  test('returns false when expires_at is absent', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    // Delete the field to simulate absence
    delete (p.validity as Partial<Pick<typeof p.validity, 'expires_at'>>).expires_at;
    expect(isExpired(p)).toBe(false);
  });
});

// ---------- hashEvidence ----------

describe('passport/hashEvidence', () => {
  test('deterministic for same string', () => {
    const a = hashEvidence('hello');
    const b = hashEvidence('hello');
    expect(a).toBe(b);
    expect(a).toStartWith('sha256:');
  });

  test('non-string content is JSON.stringified', () => {
    const obj = { foo: 'bar' };
    const hash = hashEvidence(obj);
    expect(hash).toStartWith('sha256:');
    // Should equal hashing the stringified form
    expect(hash).toBe(hashEvidence(JSON.stringify(obj)));
  });
});

// ---------- addFact ----------

describe('passport/addFact', () => {
  test('adds a fact to passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const result = addFact(p, 'fact-1', 'evidence content');
    expect(result.evidence_facts['fact-1']).toBeDefined();
    expect(result.evidence_facts['fact-1']!.content_hash).toStartWith('sha256:');
  });

  test('recorded_at is ISO 8601 UTC', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const result = addFact(p, 'fact-2', { data: 123 });
    const recorded = result.evidence_facts['fact-2']!.recorded_at;
    expect(recorded).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  test('multiple facts coexist', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    addFact(p, 'a', 'x');
    addFact(p, 'b', 'y');
    expect(Object.keys(p.evidence_facts!)).toHaveLength(2);
  });
});

// ---------- inspectTrustPassport ----------

describe('passport/inspectTrustPassport', () => {
  test('returns formatted string with key fields', async () => {
    const p = await issue({
      report: MOCK_REPORT,
      agentId: 'agent-inspect-001',
      agentName: 'InspectTestAgent',
    });
    const output = inspectTrustPassport(p);

    expect(output).toContain('Trust Passport');
    expect(output).toContain('agent-inspect-001');
    expect(output).toContain('InspectTestAgent');
    expect(output).toContain('trustavo.com');
    expect(output).toContain('VALID');
    expect(output).toContain('medium');
    expect(output).toContain('none');
  });

  test('shows EXPIRED status for expired passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    p.validity.expires_at = new Date(Date.now() - 1000).toISOString();
    const output = inspectTrustPassport(p);
    expect(output).toContain('EXPIRED');
  });

  test('shows REVOKED status for revoked passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const revoked = revoke({ passport: p, reason: 'test' });
    const output = inspectTrustPassport(revoked);
    expect(output).toContain('REVOKED');
  });

  test('verbose mode shows evidence facts', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    addFact(p, 'fact-1', 'content');
    const output = inspectTrustPassport(p, { verbose: true });
    expect(output).toContain('Evidence Facts');
    expect(output).toContain('fact-1');
    expect(output).toContain('sha256:');
  });
});

// ---------- signPassport / verifySignature ----------

describe('passport/signPassport', () => {
  test('produces valid signature', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const { signer } = await createTestSigner();
    const signed = await signPassport(p, signer);

    expect(signed.attestation.signing_method).toBe('ed25519');
    expect(signed.attestation.key_id).toBe('test-key-001');
    expect(signed.attestation.signature).toBeDefined();
    expect(signed.attestation.signed_at).toBeDefined();
  });
});

describe('passport/verifySignature', () => {
  test('verifies correctly', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const { signer, publicKey } = await createTestSigner();
    const signed = await signPassport(p, signer);
    const result = await verifySignature(signed, publicKey);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('rejects tampered passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a', agentName: 'Original' });
    const { signer, publicKey } = await createTestSigner();
    const signed = await signPassport(p, signer);

    // Tamper with the passport
    signed.identity.agent_name = 'Tampered Agent';

    const result = await verifySignature(signed, publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('rejects expired passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    p.validity.expires_at = new Date(Date.now() - 1000).toISOString();
    const { signer, publicKey } = await createTestSigner();
    const signed = await signPassport(p, signer);
    const result = await verifySignature(signed, publicKey);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('rejects unsigned passport', async () => {
    const p = await issue({ report: MOCK_REPORT, agentId: 'a' });
    const { publicKey } = await createTestSigner();
    const result = await verifySignature(p, publicKey);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('not signed with ed25519');
  });
});

// ---------- structuredErrors (#60) ----------

describe('passport/validateTrustPassport — structuredErrors (#60)', () => {
  function makeValidPassport(): Record<string, unknown> {
    return {
      passport_version: '0.1',
      identity: { passport_id: 'tp-1', agent_id: 'a', issuer: 'trustavo.com' },
      validity: {
        issued_at: '2025-01-01T00:00:00Z',
        expires_at: '2025-04-01T00:00:00Z',
      },
      revocation: { revoked: false },
      attestation: { issuer: 'trustavo.com', signing_method: 'none' },
    };
  }

  test('valid passport has empty structuredErrors array', () => {
    const result = validateTrustPassport(makeValidPassport());
    expect(result.valid).toBe(true);
    expect(result.structuredErrors).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('structuredErrors includes field paths for missing sections', () => {
    const result = validateTrustPassport({ passport_version: '0.1' });
    expect(result.valid).toBe(false);
    expect(result.structuredErrors.length).toBeGreaterThan(0);

    const fields = result.structuredErrors.map((e) => e.field);
    expect(fields).toContain('identity');
    expect(fields).toContain('validity');
    expect(fields).toContain('revocation');
    expect(fields).toContain('attestation');

    // All required-field errors use 'required' errorCode
    const requiredErrors = result.structuredErrors.filter((e) => e.errorCode === 'required');
    expect(requiredErrors.length).toBe(4);
  });

  test('structuredErrors includes field path for invalid timestamp', () => {
    const data = makeValidPassport();
    (data['validity'] as Record<string, unknown>)['issued_at'] = '2025-01-01T00:00:00+05:00';
    const result = validateTrustPassport(data);
    expect(result.valid).toBe(false);

    const tsError = result.structuredErrors.find((e) => e.field === 'validity.issued_at');
    expect(tsError).toBeDefined();
    expect(tsError!.errorCode).toBe('invalid_format');
    expect(tsError!.received).toBe('2025-01-01T00:00:00+05:00');
  });

  test('structuredErrors uses prototype_pollution errorCode', () => {
    const evil = Object.create(null) as Record<string, unknown>;
    evil['__proto__'] = { admin: true };
    evil['passport_version'] = '0.1';
    evil['identity'] = { passport_id: 'tp-1', agent_id: 'a', issuer: 'x' };
    evil['validity'] = { issued_at: '2025-01-01T00:00:00Z', expires_at: '2025-04-01T00:00:00Z' };
    evil['revocation'] = { revoked: false };
    evil['attestation'] = { issuer: 'x' };
    const result = validateTrustPassport(evil);
    expect(result.valid).toBe(false);

    const pollError = result.structuredErrors.find((e) => e.errorCode === 'prototype_pollution');
    expect(pollError).toBeDefined();
    expect(pollError!.field).toBe('data');
  });

  test('errors and structuredErrors stay in sync', () => {
    const data = makeValidPassport();
    (data['validity'] as Record<string, unknown>)['issued_at'] = 'bad-date';
    (data['validity'] as Record<string, unknown>)['expires_at'] = 'bad-date-2';
    const result = validateTrustPassport(data);

    expect(result.errors.length).toBe(result.structuredErrors.length);
    for (let i = 0; i < result.errors.length; i++) {
      expect(result.errors[i]).toBe(result.structuredErrors[i]!.message);
    }
  });

  test('non-object data returns invalid_type errorCode', () => {
    const result = validateTrustPassport('not an object');
    expect(result.valid).toBe(false);
    expect(result.structuredErrors[0]!.errorCode).toBe('invalid_type');
    expect(result.structuredErrors[0]!.field).toBe('data');
  });
});
