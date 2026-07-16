import { describe, expect, test } from 'bun:test';
import { issue, renew, revoke, status } from './index.js';

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
