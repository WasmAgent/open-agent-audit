/**
 * Golden fixture regression test for the report engine.
 *
 * This test inlines 7 canonical events from the golden trace, runs the full
 * audit pipeline, and asserts a stable set of properties in the output.
 * If any of these assertions fail after a code change, it indicates a
 * regression in report format or content that must be reviewed.
 */
import { describe, expect, it } from 'bun:test';
import type { CanonicalEvent, Finding } from '@openagentaudit/schema';
import { inventory } from '../inventory/index.js';
import { policyAudit } from '../policy-audit/index.js';
import { computeRiskScore } from '../scoring/index.js';
import { validate } from '../validate/index.js';
import { renderReport } from './index.js';

// ---------------------------------------------------------------------------
// Golden trace — 7 events with a hash chain (same as examples/traces/golden-trace.jsonl)
// ---------------------------------------------------------------------------

const GOLDEN_EVENTS: CanonicalEvent[] = [
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-001',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'policy_decision',
    actor: 'system',
    policy: {
      decision: 'allow',
      reason: 'Read-only file access within declared scope',
      rule_id: 'OAA-R-CAP-001',
    },
    evidence: {
      evidence_id: 'eid-001',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
    },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-002',
    timestamp: '2026-01-01T00:00:01Z',
    type: 'tool_call',
    actor: 'agent',
    tool: {
      name: 'read_file',
      capability: 'file_read',
      args_hash: 'sha256:abc123',
      risk_tags: ['read_only'],
    },
    evidence: {
      evidence_id: 'eid-002',
      hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      prev_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-003',
    timestamp: '2026-01-01T00:00:02Z',
    type: 'observation',
    actor: 'tool',
    observation: { source: 'verifier:read_file', content_hash: 'sha256:def456', byte_size: 1024 },
    evidence: {
      evidence_id: 'eid-003',
      hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      prev_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-004',
    timestamp: '2026-01-01T00:00:03Z',
    type: 'tool_call',
    actor: 'agent',
    tool: {
      name: 'write_file',
      capability: 'file_write',
      args_hash: 'sha256:ghi789',
      risk_tags: ['high_risk', 'human_required'],
    },
    evidence: {
      evidence_id: 'eid-004',
      hash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      prev_hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-005',
    timestamp: '2026-01-01T00:00:04Z',
    type: 'human_approval',
    actor: 'human_reviewer',
    human: {
      reviewer_id: 'reviewer-alice',
      decision: 'approve',
      justification: 'Reviewed diff; change is safe and scoped to test files only',
    },
    evidence: {
      evidence_id: 'eid-005',
      hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      prev_hash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-006',
    timestamp: '2026-01-01T00:00:05Z',
    type: 'observation',
    actor: 'tool',
    observation: { source: 'verifier:write_file', content_hash: 'sha256:jkl012', byte_size: 512 },
    evidence: {
      evidence_id: 'eid-006',
      hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      prev_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'golden-run-001',
    agent_id: 'golden-agent',
    model_id: 'golden-model-v1',
    event_id: 'evt-007',
    timestamp: '2026-01-01T00:00:06Z',
    type: 'final_answer',
    actor: 'agent',
    evidence: {
      evidence_id: 'eid-007',
      hash: '1111111111111111111111111111111111111111111111111111111111111111',
      prev_hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    },
  },
];

// ---------------------------------------------------------------------------
// Golden fixture regression test
// ---------------------------------------------------------------------------

describe('golden report fixture', () => {
  it('produces stable output matching golden assertions', async () => {
    // Run the full pipeline
    await validate(GOLDEN_EVENTS);

    const inv = await inventory(GOLDEN_EVENTS);

    // Use an empty manifest so policyAudit fires on undeclared capabilities
    const findings = await policyAudit(GOLDEN_EVENTS, {
      manifest: {
        declared_capabilities: [],
        high_risk_capabilities: [],
        denied_capabilities: [],
      },
    });

    const score = await computeRiskScore(GOLDEN_EVENTS);

    const bundle = await renderReport(GOLDEN_EVENTS, findings, score, inv);

    // -- Parse JSON report --
    const report = JSON.parse(bundle.json) as {
      run_id: string;
      risk_score: {
        evidence_admission_score: { score: number; grade: string };
      };
      findings: Array<{ rule_id: string }>;
      compliance_mappings: Array<{ profile_id: string }>;
      event_count: number;
      inventory: {
        tools: Array<{ name: string }>;
      };
    };

    // Stable identity properties
    expect(report.run_id).toBe('golden-run-001');

    // EAS score — deterministic given the fixed trace
    expect(report.risk_score.evidence_admission_score.score).toBe(85);
    expect(report.risk_score.evidence_admission_score.grade).toBe('B');

    // Findings — with empty manifest, OAA-R-CAP-000 (info, skipped audit) + OAA-R-POLICY-002
    expect(report.findings.length).toBe(2);
    expect(report.findings.some((f) => f.rule_id === 'OAA-R-CAP-000')).toBe(true);
    expect(report.findings.some((f) => f.rule_id === 'OAA-R-POLICY-002')).toBe(true);

    // Compliance mappings — four profiles always emitted
    expect(report.compliance_mappings.length).toBe(4);
    expect(
      report.compliance_mappings.some((m) => m.profile_id === 'owasp-agentic-top10-2026'),
    ).toBe(true);
    expect(report.compliance_mappings.some((m) => m.profile_id === 'eu-ai-act-annex-iv')).toBe(
      true,
    );

    // Event count
    expect(report.event_count).toBe(7);

    // Tool inventory
    expect(report.inventory.tools.length).toBe(2);
    expect(report.inventory.tools.some((t) => t.name === 'read_file')).toBe(true);
    expect(report.inventory.tools.some((t) => t.name === 'write_file')).toBe(true);

    // Markdown report contains key strings
    expect(bundle.markdown).toContain('Evidence Admission Score');
    expect(bundle.markdown).toContain('OAA-R-CAP-000');

    // HTML report contains score display
    const hasScoreDisplay = bundle.html.includes('85/100') || bundle.html.includes('Grade B');
    expect(hasScoreDisplay).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug #57: renderReport does not crash when inventoryReport is null
// ---------------------------------------------------------------------------

describe('renderReport null inventoryReport (#57)', () => {
  it('does not crash when inventoryReport is null', async () => {
    const score = await computeRiskScore(GOLDEN_EVENTS);
    const findings = await policyAudit(GOLDEN_EVENTS, {
      manifest: {
        declared_capabilities: [],
        high_risk_capabilities: [],
        denied_capabilities: [],
      },
    });

    // Passing null explicitly — this previously threw TypeError
    const bundle = await renderReport(GOLDEN_EVENTS, findings, score, null);

    expect(bundle.markdown).toContain('Evidence Admission Score');
    expect(bundle.html).toBeDefined();
    expect(bundle.json).toBeDefined();
    expect(bundle.csv).toBeDefined();

    // The JSON report should not have an inventory section
    const report = JSON.parse(bundle.json) as { inventory?: unknown };
    expect(report.inventory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #111 / Milestone 3: report sections for risk score and open risks
// ---------------------------------------------------------------------------

describe('report sections: risk score and open risks (#111)', () => {
  it('renders Risk Score and Open Risks sections in markdown and html', async () => {
    const score = await computeRiskScore(GOLDEN_EVENTS);
    const bundle = await renderReport(GOLDEN_EVENTS, [], score, null);

    // Both new sections are present in markdown and html
    expect(bundle.markdown).toContain('## Risk Score');
    expect(bundle.markdown).toContain('## Open Risks');
    expect(bundle.html).toContain('<h2>Risk Score</h2>');
    expect(bundle.html).toContain('<h2>Open Risks</h2>');

    // Risk Score section surfaces the ARS value and its interpretation band
    const arsScore = score.agent_risk_score.score;
    expect(bundle.markdown).toContain(`Agent Risk Score (ARS) | ${arsScore}/100`);
    expect(bundle.html).toContain(`Agent Risk Score (ARS)</td><td>${arsScore}/100`);

    // JSON report carries an open_risks array
    const json = JSON.parse(bundle.json) as { open_risks: unknown[] };
    expect(Array.isArray(json.open_risks)).toBe(true);
  });

  it('derives open risks from unsuppressed medium/high/critical findings, most-severe first', async () => {
    const score = await computeRiskScore(GOLDEN_EVENTS);
    const findings: Finding[] = [
      {
        schema_version: 'open-agent-audit/v0.1',
        finding_id: 'f-1',
        rule_id: 'R-MED',
        severity: 'medium',
        category: 'oversight',
        title: 'Medium open issue',
        description: 'desc',
        evidence_ids: ['eid-y'],
        recommendation: 'Review oversight',
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        finding_id: 'f-2',
        rule_id: 'R-CRIT',
        severity: 'critical',
        category: 'capability',
        title: 'Critical open issue',
        description: 'desc',
        evidence_ids: ['eid-x'],
        recommendation: 'Fix it now',
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        finding_id: 'f-3',
        rule_id: 'R-SUPPRESSED',
        severity: 'high',
        category: 'policy',
        title: 'Suppressed high issue',
        description: 'desc',
        evidence_ids: ['eid-z'],
        recommendation: 'Should not appear',
        suppressed: true,
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        finding_id: 'f-4',
        rule_id: 'R-LOW',
        severity: 'low',
        category: 'integrity',
        title: 'Low issue',
        description: 'desc',
        evidence_ids: ['eid-w'],
        recommendation: 'Below threshold',
      },
    ];

    const bundle = await renderReport(GOLDEN_EVENTS, findings, score, null);

    // Only critical + medium qualify (high is suppressed, low is below threshold)
    const json = JSON.parse(bundle.json) as { open_risks: Array<{ rule_id: string }> };
    expect(json.open_risks.map((r) => r.rule_id)).toEqual(['R-CRIT', 'R-MED']);

    // Markdown lists qualifying findings ordered most-severe first
    expect(bundle.markdown.indexOf('[CRITICAL] R-CRIT')).toBeLessThan(
      bundle.markdown.indexOf('[MEDIUM] R-MED'),
    );

    // The suppressed high finding and the below-threshold low finding are NOT
    // surfaced in the Open Risks section. They still appear in the full
    // Findings section (which lists every finding regardless of suppression),
    // so the assertion is scoped to the Open Risks section only.
    const openRisksStart = bundle.markdown.indexOf('## Open Risks');
    const limitationsStart = bundle.markdown.indexOf('## Limitations', openRisksStart);
    const openRisksSection = bundle.markdown.slice(openRisksStart, limitationsStart);
    expect(openRisksSection).not.toContain('R-SUPPRESSED');
    expect(openRisksSection).not.toContain('[LOW]');
  });

  it('reports no open risks when only low/info findings are present', async () => {
    const score = await computeRiskScore(GOLDEN_EVENTS);
    const findings: Finding[] = [
      {
        schema_version: 'open-agent-audit/v0.1',
        finding_id: 'f-1',
        rule_id: 'R-LOW',
        severity: 'low',
        category: 'integrity',
        title: 'Low issue',
        description: 'desc',
        evidence_ids: ['eid-w'],
        recommendation: 'Below threshold',
      },
    ];

    const bundle = await renderReport(GOLDEN_EVENTS, findings, score, null);

    const json = JSON.parse(bundle.json) as { open_risks: unknown[] };
    expect(json.open_risks).toEqual([]);
    expect(bundle.markdown).toContain('No open risks');
    expect(bundle.html).toContain('No open risks');
  });
});
