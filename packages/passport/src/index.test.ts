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
} from './index.js';
import type { TrustPassport, ValidationError } from './index.js';

const MOCK_REPORT = {
  run_id: 'run-001',
  evidence_admission_score: { score: 85, grade: 'B' },
  findings: [
    { severity: 'medium', title: 'test' },
    { severity: 'low', title: 'test2' },
  ],
  profiles_applied: ['owasp-agentic-top10-2026'],
};

describe('passport/issue', () => {
  test('produces a valid passport', () => {
    const p = issue({
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

  test('derives evidence quality from EAS score', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(p.evidence_summary?.evidence_quality).toBe('medium');
  });

  test('derives risk summary from findings', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(p.risk_summary?.medium).toBe(1);
    expect(p.risk_summary?.low).toBe(1);
    expect(p.risk_summary?.critical).toBe(0);
  });

  test('includes agentbom_ref when provided', () => {
    const p = issue({
      report: MOCK_REPORT,
      agentId: 'a',
      agentbom: { agentbom_id: 'bom-1', tools: ['search'] },
    });
    expect(p.agentbom_ref?.agentbom_id).toBe('bom-1');
    expect(p.agentbom_ref?.agentbom_hash).toBeTruthy();
  });

  test('includes posture_ref when provided', () => {
    const p = issue({
      report: MOCK_REPORT,
      agentId: 'a',
      posture: { snapshot_id: 'snap-1' },
    });
    expect(p.posture_ref?.snapshot_id).toBe('snap-1');
  });

  test('respects custom validity days', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a', validityDays: 30 });
    const issued = new Date(p.validity.issued_at);
    const expires = new Date(p.validity.expires_at);
    const diffDays = Math.round((expires.getTime() - issued.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });
});

describe('passport/status', () => {
  test('returns valid for fresh passport', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(status(p)).toBe('valid');
  });

  test('returns expired for past expiry', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    p.validity.expires_at = '2020-01-01T00:00:00.000Z';
    expect(status(p)).toBe('expired');
  });

  test('returns revoked when revoked', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    const revoked = revoke({ passport: p, reason: 'critical-finding' });
    expect(status(revoked)).toBe('revoked');
  });
});

describe('passport/renew', () => {
  test('produces a new passport with new ID', () => {
    const original = issue({ report: MOCK_REPORT, agentId: 'a' });
    const renewed = renew({ passport: original, report: MOCK_REPORT });
    expect(renewed.identity.passport_id).not.toBe(original.identity.passport_id);
    expect(renewed.identity.agent_id).toBe('a');
    expect(renewed.revocation.revoked).toBe(false);
  });

  test('resets revocation state', () => {
    const original = issue({ report: MOCK_REPORT, agentId: 'a' });
    const revoked = revoke({ passport: original, reason: 'test' });
    const renewed = renew({ passport: revoked, report: MOCK_REPORT });
    expect(renewed.revocation.revoked).toBe(false);
  });
});

describe('passport/revoke', () => {
  test('sets revoked flag and reason', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
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
  test('returns true for expired passport', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    p.validity.expires_at = '2020-01-01T00:00:00.000Z';
    expect(isExpired(p)).toBe(true);
  });

  test('returns false for non-expired passport', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    expect(isExpired(p)).toBe(false);
  });

  test('returns false when expires_at is absent', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
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
  test('adds a fact to passport', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    const result = addFact(p, 'fact-1', 'evidence content');
    expect(result.evidence_facts['fact-1']).toBeDefined();
    expect(result.evidence_facts['fact-1']!.content_hash).toStartWith('sha256:');
  });

  test('recorded_at is ISO 8601 UTC', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    const result = addFact(p, 'fact-2', { data: 123 });
    const recorded = result.evidence_facts['fact-2']!.recorded_at;
    expect(recorded).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  test('multiple facts coexist', () => {
    const p = issue({ report: MOCK_REPORT, agentId: 'a' });
    addFact(p, 'a', 'x');
    addFact(p, 'b', 'y');
    expect(Object.keys(p.evidence_facts!)).toHaveLength(2);
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
