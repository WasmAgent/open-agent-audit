/**
 * Golden fixture regression test for the report engine.
 *
 * This test inlines 7 canonical events from the golden trace, runs the full
 * audit pipeline, and asserts a stable set of properties in the output.
 * If any of these assertions fail after a code change, it indicates a
 * regression in report format or content that must be reviewed.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import type { CanonicalEvent, Finding, RiskScore } from '@openagentaudit/schema';
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
// Template tests: verify report output structure across all formats
// ---------------------------------------------------------------------------

/** Minimal test fixtures */
const MINIMAL_EVENTS: CanonicalEvent[] = [
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'tpl-run-001',
    agent_id: 'tpl-agent',
    model_id: 'tpl-model',
    event_id: 'evt-tpl-001',
    timestamp: '2026-06-15T10:00:00Z',
    type: 'tool_call',
    actor: 'agent',
    tool: { name: 'bash', capability: 'shell_execute', risk_tags: ['high_risk'] },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'tpl-run-001',
    agent_id: 'tpl-agent',
    model_id: 'tpl-model',
    event_id: 'evt-tpl-002',
    timestamp: '2026-06-15T10:00:01Z',
    type: 'policy_decision',
    actor: 'system',
    policy: { decision: 'allow', reason: 'Within declared scope', rule_id: 'OAA-R-CAP-001' },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'tpl-run-001',
    agent_id: 'tpl-agent',
    model_id: 'tpl-model',
    event_id: 'evt-tpl-003',
    timestamp: '2026-06-15T10:00:02Z',
    type: 'human_approval',
    actor: 'human_reviewer',
    human: { reviewer_id: 'rev-1', decision: 'approve', justification: 'Reviewed' },
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'tpl-run-001',
    agent_id: 'tpl-agent',
    model_id: 'tpl-model',
    event_id: 'evt-tpl-004',
    timestamp: '2026-06-15T10:00:03Z',
    type: 'final_answer',
    actor: 'agent',
  },
];

const MINIMAL_FINDINGS: Finding[] = [
  {
    schema_version: 'open-agent-audit/v0.1',
    finding_id: 'find-001',
    rule_id: 'OAA-R-CAP-001',
    severity: 'medium',
    category: 'capability_governance',
    title: 'Undeclared capability used',
    description: 'Tool bash was invoked without a declared capability.',
    evidence_ids: ['evt-tpl-001'],
    recommendation: 'Add bash to the capability manifest.',
    confidence: 'high',
  },
  {
    schema_version: 'open-agent-audit/v0.1',
    finding_id: 'find-002',
    rule_id: 'OAA-R-OVERSIGHT-001',
    severity: 'low',
    category: 'human_oversight',
    title: 'No human oversight for high-risk action',
    description: 'A high-risk tool call was not reviewed by a human.',
    evidence_ids: ['evt-tpl-001'],
    recommendation: 'Require human approval for high-risk tool calls.',
    confidence: 'medium',
  },
];

const MINIMAL_SCORE: RiskScore = {
  schema_version: 'open-agent-audit/v0.1',
  run_id: 'tpl-run-001',
  generated_at: '2026-06-15T10:00:05Z',
  evidence_admission_score: { score: 72, grade: 'C' },
  agent_risk_score: { score: 35 },
  components: {
    trace_completeness: 80,
    provenance_integrity: 60,
    objective_verification: 50,
    policy_coverage: 90,
    human_oversight_evidence: 70,
    contamination_risk: 80,
  },
  contamination_evaluated: false,
};

/** Shared helper — renders a report with the minimal fixtures + optional meta. */
async function renderMinimal(meta?: import('./index.js').ReportMeta) {
  return renderReport(MINIMAL_EVENTS, MINIMAL_FINDINGS, MINIMAL_SCORE, null, meta);
}

// ---- ReportBundle shape ----

describe('template: ReportBundle shape', () => {
  it('returns an object with exactly four string fields', async () => {
    const bundle = await renderMinimal();
    expect(typeof bundle.markdown).toBe('string');
    expect(typeof bundle.html).toBe('string');
    expect(typeof bundle.json).toBe('string');
    expect(typeof bundle.csv).toBe('string');
    expect(Object.keys(bundle).sort()).toEqual(['csv', 'html', 'json', 'markdown']);
  });

  it('all formats are non-empty', async () => {
    const bundle = await renderMinimal();
    expect(bundle.markdown.length).toBeGreaterThan(0);
    expect(bundle.html.length).toBeGreaterThan(0);
    expect(bundle.json.length).toBeGreaterThan(0);
    expect(bundle.csv.length).toBeGreaterThan(0);
  });
});

// ---- Markdown structure ----

describe('template: Markdown output structure', () => {
  let md: string;
  beforeAll(async () => {
    md = (await renderMinimal()).markdown;
  });

  it('starts with a top-level heading', () => {
    expect(md.startsWith('# ')).toBe(true);
  });

  it('contains the report metadata section', () => {
    expect(md).toContain('## Report Metadata');
  });

  it('contains the executive summary section', () => {
    expect(md).toContain('## Executive Summary');
  });

  it('contains the EAS score section', () => {
    expect(md).toContain('## Evidence Admission Score');
  });

  it('contains the findings section', () => {
    expect(md).toContain('## Findings');
  });

  it('contains the compliance framework mapping section', () => {
    expect(md).toContain('## Compliance Framework Mapping');
  });

  it('contains the limitations section', () => {
    expect(md).toContain('## Limitations');
  });

  it('contains the disclaimer section', () => {
    expect(md).toContain('## Disclaimer');
  });

  it('contains the forensic event appendix', () => {
    expect(md).toContain('## Forensic Event Appendix');
  });

  it('includes the run ID', () => {
    expect(md).toContain('tpl-run-001');
  });

  it('includes the EAS grade', () => {
    expect(md).toContain('Grade C');
  });

  it('includes finding titles', () => {
    expect(md).toContain('Undeclared capability used');
    expect(md).toContain('No human oversight for high-risk action');
  });

  it('includes all four compliance profile headings', () => {
    expect(md).toContain('OWASP');
    expect(md).toContain('EU AI Act');
    expect(md).toContain('NIST');
    expect(md).toContain('ISO/IEC 42001');
  });

  it('includes the log retention notice', () => {
    expect(md).toContain('Log Retention Notice');
  });
});

// ---- HTML structure ----

describe('template: HTML output structure', () => {
  let html: string;
  beforeAll(async () => {
    html = (await renderMinimal()).html;
  });

  it('is a complete HTML document with doctype and closing tag', () => {
    expect(html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('contains a <style> block', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
  });

  it('contains a <head> section with title', () => {
    expect(html).toContain('<head>');
    expect(html).toContain('<title>');
    expect(html).toContain('</head>');
  });

  it('contains a <body> section', () => {
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('includes the EAS score display', () => {
    expect(html).toContain('72/100');
  });

  it('includes the grade', () => {
    expect(html).toContain('Grade C');
  });

  it('includes finding titles (HTML-escaped)', () => {
    expect(html).toContain('Undeclared capability used');
  });

  it('includes compliance framework section', () => {
    expect(html).toContain('Compliance Framework Mapping');
  });

  it('includes the forensic event appendix', () => {
    expect(html).toContain('Forensic Event Appendix');
  });

  it('contains an inline SVG seal element', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  it('includes severity CSS classes', () => {
    expect(html).toContain('severity-medium');
    expect(html).toContain('severity-low');
  });

  it('has a print media query', () => {
    expect(html).toContain('@media print');
  });

  it('escapes HTML entities in content', async () => {
    const bundle = await renderReport(
      MINIMAL_EVENTS,
      [
        {
          schema_version: 'open-agent-audit/v0.1',
          finding_id: 'find-xss',
          rule_id: 'TEST-XSS',
          severity: 'medium',
          category: 'test',
          title: '<script>alert(1)</script>',
          description: 'Test & "quotes"',
          evidence_ids: [],
          recommendation: 'Fix <b>bold</b>',
        },
      ],
      MINIMAL_SCORE,
    );
    expect(bundle.html).not.toContain('<script>alert(1)</script>');
    expect(bundle.html).toContain('&lt;script&gt;');
    expect(bundle.html).toContain('Test &amp; &quot;quotes&quot;');
  });
});

// ---- JSON structure ----

describe('template: JSON output structure', () => {
  let report: Record<string, unknown>;
  beforeAll(async () => {
    const json = (await renderMinimal()).json;
    report = JSON.parse(json) as Record<string, unknown>;
  });

  it('is valid JSON', () => {
    expect(report).toBeDefined();
  });

  it('contains schema_version', () => {
    expect(report.schema_version).toBe('open-agent-audit/v0.1');
  });

  it('contains generated_at as an ISO string', () => {
    expect(typeof report.generated_at).toBe('string');
    expect(report.generated_at as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('contains run_id matching input', () => {
    expect(report.run_id).toBe('tpl-run-001');
  });

  it('contains risk_score with EAS and ARS', () => {
    const rs = report.risk_score as Record<string, unknown>;
    expect(rs).toBeDefined();
    const eas = rs.evidence_admission_score as Record<string, unknown>;
    expect(eas.score).toBe(72);
    expect(eas.grade).toBe('C');
    const ars = rs.agent_risk_score as Record<string, unknown>;
    expect(ars.score).toBe(35);
  });

  it('contains findings array with correct length', () => {
    const findings = report.findings as Array<Record<string, unknown>>;
    expect(Array.isArray(findings)).toBe(true);
    expect(findings).toHaveLength(2);
  });

  it('findings contain required fields', () => {
    const findings = report.findings as Array<Record<string, unknown>>;
    for (const f of findings) {
      expect(f).toHaveProperty('finding_id');
      expect(f).toHaveProperty('rule_id');
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('category');
      expect(f).toHaveProperty('title');
      expect(f).toHaveProperty('description');
      expect(f).toHaveProperty('recommendation');
      expect(f).toHaveProperty('evidence_ids');
    }
  });

  it('contains compliance_mappings array with four profiles', () => {
    const mappings = report.compliance_mappings as Array<Record<string, unknown>>;
    expect(Array.isArray(mappings)).toBe(true);
    expect(mappings).toHaveLength(4);
    const ids = mappings.map((m) => m.profile_id);
    expect(ids).toContain('owasp-agentic-top10-2026');
    expect(ids).toContain('eu-ai-act-annex-iv');
    expect(ids).toContain('nist-ai-rmf-1.0');
    expect(ids).toContain('iso-iec-42001');
  });

  it('each compliance mapping has profile_id, profile_name, and requirements', () => {
    const mappings = report.compliance_mappings as Array<Record<string, unknown>>;
    for (const m of mappings) {
      expect(m).toHaveProperty('profile_id');
      expect(m).toHaveProperty('profile_name');
      expect(m).toHaveProperty('requirements');
      expect(Array.isArray(m.requirements)).toBe(true);
    }
  });

  it('contains event_count matching input', () => {
    expect(report.event_count).toBe(4);
  });

  it('contains meta object', () => {
    const meta = report.meta as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta).toHaveProperty('report_id');
    expect(meta).toHaveProperty('issuer');
  });

  it('does not contain inventory when not provided', () => {
    expect(report).not.toHaveProperty('inventory');
  });

  it('pretty-prints with 2-space indentation', async () => {
    const json = (await renderMinimal()).json;
    expect(json.split('\n')[1]).toMatch(/^ {2}\S/);
  });
});

// ---- CSV structure ----

describe('template: CSV output structure', () => {
  let csv: string;
  beforeAll(async () => {
    csv = (await renderMinimal()).csv;
  });

  it('contains the findings header row', () => {
    expect(csv).toContain(
      'finding_id,rule_id,severity,category,title,description,recommendation,evidence_ids,confidence',
    );
  });

  it('contains the events header row', () => {
    expect(csv).toContain('index,event_id,type,actor,timestamp,tool_name,tool_capability');
  });

  it('contains the correct number of finding data rows', () => {
    const lines = csv.split('\r\n');
    // Findings header + 2 data rows + blank separator + events header + 4 data rows
    const findingRows = lines.filter((l) => l.startsWith('"find-'));
    expect(findingRows).toHaveLength(2);
  });

  it('contains the correct number of event data rows', () => {
    const lines = csv.split('\r\n');
    const eventRows = lines.filter(
      (l) =>
        l.startsWith('"0","') ||
        l.startsWith('"1","') ||
        l.startsWith('"2","') ||
        l.startsWith('"3","'),
    );
    expect(eventRows).toHaveLength(4);
  });

  it('data rows are RFC 4180 double-quoted', () => {
    // Data rows should start with a quoted field; header rows are plain text
    const lines = csv.split('\r\n').filter((l) => l.length > 0);
    const dataLines = lines.filter((l) => l.startsWith('"'));
    expect(dataLines.length).toBeGreaterThan(0);
  });

  it('finding rows include severity and rule_id', () => {
    expect(csv).toContain('"OAA-R-CAP-001"');
    expect(csv).toContain('"medium"');
    expect(csv).toContain('"OAA-R-OVERSIGHT-001"');
    expect(csv).toContain('"low"');
  });

  it('event rows include event types', () => {
    expect(csv).toContain('"tool_call"');
    expect(csv).toContain('"policy_decision"');
    expect(csv).toContain('"human_approval"');
    expect(csv).toContain('"final_answer"');
  });

  it('has a blank line separating findings and events sections', () => {
    expect(csv).toContain('\r\n\r\n');
  });
});

// ---- Cross-format consistency ----

describe('template: cross-format consistency', () => {
  let bundle: import('./index.js').ReportBundle;
  beforeAll(async () => {
    bundle = await renderMinimal({
      issuer: 'TestOrg',
      report_url: 'https://example.com/reports/test-001',
    });
  });

  it('run_id is consistent across markdown, html, and json', () => {
    expect(bundle.markdown).toContain('tpl-run-001');
    expect(bundle.html).toContain('tpl-run-001');
    const report = JSON.parse(bundle.json) as { run_id: string };
    expect(report.run_id).toBe('tpl-run-001');
  });

  it('custom issuer appears in markdown and html', () => {
    expect(bundle.markdown).toContain('TestOrg');
    expect(bundle.html).toContain('TestOrg');
  });

  it('EAS score and grade are consistent across formats', () => {
    expect(bundle.markdown).toContain('72/100');
    expect(bundle.html).toContain('72/100');
    const report = JSON.parse(bundle.json) as {
      risk_score: { evidence_admission_score: { score: number; grade: string } };
    };
    expect(report.risk_score.evidence_admission_score.score).toBe(72);
    expect(report.risk_score.evidence_admission_score.grade).toBe('C');
  });

  it('finding count is consistent across formats', () => {
    // Markdown: finding titles present
    expect(bundle.markdown).toContain('Undeclared capability used');
    expect(bundle.markdown).toContain('No human oversight for high-risk action');

    // HTML: finding titles present
    expect(bundle.html).toContain('Undeclared capability used');
    expect(bundle.html).toContain('No human oversight for high-risk action');

    // JSON: 2 findings
    const report = JSON.parse(bundle.json) as { findings: unknown[] };
    expect(report.findings).toHaveLength(2);

    // CSV: 2 finding rows
    const findingRows = bundle.csv.split('\r\n').filter((l) => l.startsWith('"find-'));
    expect(findingRows).toHaveLength(2);
  });

  it('compliance profile count matches across json and markdown', () => {
    const report = JSON.parse(bundle.json) as {
      compliance_mappings: Array<{ profile_id: string }>;
    };
    expect(report.compliance_mappings).toHaveLength(4);

    // Markdown should reference all four profiles
    expect(bundle.markdown).toContain('OWASP');
    expect(bundle.markdown).toContain('EU AI Act');
    expect(bundle.markdown).toContain('NIST');
    expect(bundle.markdown).toContain('ISO');
  });

  it('event count matches across json and csv', () => {
    const report = JSON.parse(bundle.json) as { event_count: number };
    expect(report.event_count).toBe(4);

    const eventRows = bundle.csv
      .split('\r\n')
      .filter((l) => /^[0-3],/.test(l) || /^"[0-3]",/.test(l));
    expect(eventRows).toHaveLength(4);
  });
});

// ---- With inventory report ----

describe('template: formats with inventory report', () => {
  it('JSON includes inventory when provided', async () => {
    const invReport = await inventory(MINIMAL_EVENTS);
    const bundle = await renderReport(MINIMAL_EVENTS, MINIMAL_FINDINGS, MINIMAL_SCORE, invReport);
    const report = JSON.parse(bundle.json) as { inventory?: { tools: unknown[] } };
    expect(report.inventory).toBeDefined();
    expect(Array.isArray(report.inventory?.tools)).toBe(true);
  });

  it('Markdown includes tool inventory section when provided', async () => {
    const invReport = await inventory(MINIMAL_EVENTS);
    const bundle = await renderReport(MINIMAL_EVENTS, MINIMAL_FINDINGS, MINIMAL_SCORE, invReport);
    expect(bundle.markdown).toContain('## Tool Inventory');
  });

  it('CSV event count matches input events', async () => {
    const bundle = await renderMinimal();
    const eventRows = bundle.csv.split('\r\n').filter((l) => /^"[0-3]",/.test(l));
    expect(eventRows).toHaveLength(4);
  });
});

// ---- With custom meta (narrative, provenance, crypto) ----

describe('template: formats with custom ReportMeta', () => {
  it('renders narrative intro in markdown and html', async () => {
    const bundle = await renderMinimal({
      narrative_intro: 'This is a custom auditor introduction.',
    });
    expect(bundle.markdown).toContain('This is a custom auditor introduction.');
    expect(bundle.html).toContain('This is a custom auditor introduction.');
  });

  it('renders narrative conclusion in markdown and html', async () => {
    const bundle = await renderMinimal({
      narrative_conclusion: 'These are the final recommendations.',
    });
    expect(bundle.markdown).toContain('These are the final recommendations.');
    expect(bundle.html).toContain('These are the final recommendations.');
  });

  it('structured narrative takes precedence over flat fields', async () => {
    const bundle = await renderMinimal({
      narrative_intro: 'flat intro',
      narrative_conclusion: 'flat conclusion',
      narrative: {
        intro: 'structured intro',
        conclusion: 'structured conclusion',
      },
    });
    expect(bundle.markdown).toContain('structured intro');
    expect(bundle.markdown).not.toContain('flat intro');
    expect(bundle.markdown).toContain('structured conclusion');
    expect(bundle.markdown).not.toContain('flat conclusion');
  });

  it('AEP provenance appears in markdown when provided', async () => {
    const bundle = await renderMinimal({
      aep_provenance: {
        repo_commit: 'abc123',
        runtime_version: '1.0.0',
        model_provider: 'Anthropic',
      },
    });
    expect(bundle.markdown).toContain('AEP Run Provenance');
    expect(bundle.markdown).toContain('abc123');
    expect(bundle.markdown).toContain('Anthropic');
  });

  it('intended_use and transparency_statement appear in report', async () => {
    const bundle = await renderMinimal({
      intended_use: 'Software development assistant',
      transparency_statement: 'This AI system aids developers.',
    });
    expect(bundle.markdown).toContain('Software development assistant');
    expect(bundle.markdown).toContain('This AI system aids developers.');
  });
});

// ---- Empty edge cases ----

describe('template: edge cases', () => {
  it('handles empty events array', async () => {
    const emptyScore: RiskScore = {
      schema_version: 'open-agent-audit/v0.1',
      run_id: 'empty-run',
      generated_at: '2026-06-15T10:00:00Z',
      evidence_admission_score: { score: 0, grade: 'F' },
      agent_risk_score: { score: 100 },
      components: {},
      contamination_evaluated: false,
    };
    const bundle = await renderReport([], [], emptyScore);
    expect(bundle.markdown).toContain('# OpenAgentAudit Report');
    expect(bundle.html).toContain('<!DOCTYPE html>');
    const report = JSON.parse(bundle.json) as { event_count: number; findings: unknown[] };
    expect(report.event_count).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it('handles empty findings array', async () => {
    const bundle = await renderReport(MINIMAL_EVENTS, [], MINIMAL_SCORE);
    expect(bundle.markdown).toContain('## Findings');
    const report = JSON.parse(bundle.json) as { findings: unknown[] };
    expect(report.findings).toHaveLength(0);
  });

  it('CSV has only headers when events and findings are empty', async () => {
    const emptyScore: RiskScore = {
      schema_version: 'open-agent-audit/v0.1',
      run_id: 'empty-run',
      generated_at: '2026-06-15T10:00:00Z',
      evidence_admission_score: { score: 0, grade: 'F' },
      agent_risk_score: { score: 100 },
      components: {},
      contamination_evaluated: false,
    };
    const bundle = await renderReport([], [], emptyScore);
    // Should have findings header, blank line, events header, and nothing else
    const nonEmptyLines = bundle.csv.split('\r\n').filter((l) => l.length > 0);
    expect(nonEmptyLines).toHaveLength(2); // findings header + events header
  });
});
