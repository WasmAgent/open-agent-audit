/** @openagentaudit/core/report — full implementation. */
import type { CanonicalEvent, Finding, RiskScore } from '@openagentaudit/schema';
import type { InventoryReport } from '../inventory/index.js';

export interface ReportBundle {
  markdown: string;
  html: string;
  json: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function severityOrder(s: Finding['severity']): number {
  switch (s) {
    case 'critical': return 0;
    case 'high':     return 1;
    case 'medium':   return 2;
    case 'low':      return 3;
    case 'info':     return 4;
  }
}

function countBySeverity(
  findings: Finding[],
): { critical: number; high: number; medium: number; low: number; info: number } {
  let critical = 0, high = 0, medium = 0, low = 0, info = 0;
  for (const f of findings) {
    switch (f.severity) {
      case 'critical': critical++; break;
      case 'high':     high++;     break;
      case 'medium':   medium++;   break;
      case 'low':      low++;      break;
      case 'info':     info++;     break;
    }
  }
  return { critical, high, medium, low, info };
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return 'green';
    case 'B': return 'blue';
    case 'C': return 'orange';
    default:  return 'red';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function buildMarkdown(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inv: InventoryReport | undefined,
  generatedAt: string,
): string {
  const counts = countBySeverity(findings);
  const { evidence_admission_score, components } = score;
  const runId = score.run_id;

  const findingsSummary =
    `${findings.length} total — ` +
    `${counts.critical} critical, ${counts.high} high, ` +
    `${counts.medium} medium, ${counts.low} low`;

  const lines: string[] = [];

  // Header
  lines.push('# OpenAgentAudit Report');
  lines.push(`> Generated: ${generatedAt}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Run ID | \`${runId}\` |`);
  lines.push(`| Total Events | ${events.length} |`);
  lines.push(
    `| Evidence Admission Score | ${evidence_admission_score.score}/100 (Grade ${evidence_admission_score.grade}) |`,
  );
  lines.push(`| Findings | ${findingsSummary} |`);
  lines.push('');

  // EAS breakdown
  lines.push('## Evidence Admission Score');
  lines.push('');
  lines.push('| Component | Score |');
  lines.push('|---|---|');
  lines.push(`| Trace Completeness | ${components['trace_completeness'] ?? 0}/100 |`);
  lines.push(`| Provenance Integrity | ${components['provenance_integrity'] ?? 0}/100 |`);
  lines.push(`| Objective Verification | ${components['objective_verification'] ?? 0}/100 |`);
  lines.push(`| Policy Coverage | ${components['policy_coverage'] ?? 0}/100 |`);
  lines.push(`| Human Oversight Evidence | ${components['human_oversight_evidence'] ?? 0}/100 |`);
  lines.push(`| Contamination Risk | ${components['contamination_risk_inverted'] ?? 0}/100 |`);
  lines.push(
    `| **Total EAS** | **${evidence_admission_score.score}/100 (Grade ${evidence_admission_score.grade})** |`,
  );
  lines.push('');

  // Tool Inventory
  if (inv !== undefined) {
    lines.push('## Tool Inventory');
    lines.push('');
    lines.push('| Tool | Calls | Denied | Approved | Risk Tags |');
    lines.push('|---|---:|---:|---:|---|');
    for (const t of inv.tools) {
      const tags = t.risk_tags.length > 0 ? t.risk_tags.join(', ') : '—';
      lines.push(`| \`${t.name}\` | ${t.calls} | ${t.denied} | ${t.approved} | ${tags} |`);
    }
    lines.push('');
  }

  // Findings
  lines.push('## Findings');
  lines.push('');

  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    const sorted = [...findings].sort(
      (a, b) => severityOrder(a.severity) - severityOrder(b.severity),
    );
    for (const f of sorted) {
      const sev = f.severity.toUpperCase();
      lines.push(`### [${sev}] ${f.rule_id} — ${f.title}`);
      lines.push('');
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Description:** ${f.description}`);
      lines.push(`- **Evidence IDs:** ${f.evidence_ids.join(', ')}`);
      lines.push(`- **Recommendation:** ${f.recommendation}`);
      if (f.standard_mappings !== undefined && f.standard_mappings.length > 0) {
        const mappings = f.standard_mappings
          .map((m) => `${m.profile}:${m.control_id}`)
          .join(', ');
        lines.push(`- **Standard Mappings:** ${mappings}`);
      }
      lines.push('');
    }
  }

  // Disclaimer
  lines.push('## Disclaimer');
  lines.push('');
  lines.push(
    '_OpenAgentAudit produces technical evidence only. This report does not constitute legal advice or a determination of regulatory compliance._',
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML generation — pure string concatenation, no DOM APIs
// ---------------------------------------------------------------------------

/** Convert a markdown table row string into <tr><td>...</td></tr> HTML. */
function mdTableRowToHtml(row: string, isHeader: boolean, extraCellStyle?: string): string {
  // Split on | and remove first/last empty segments
  const cells = row.split('|').slice(1, -1);
  const tag = isHeader ? 'th' : 'td';
  const cellsHtml = cells
    .map((cell) => {
      const trimmed = cell.trim();
      // Bold marker in markdown (e.g. **Total EAS**)
      const content = trimmed
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
      const style = extraCellStyle !== undefined ? ` style="${extraCellStyle}"` : '';
      return `<${tag}${style}>${content}</${tag}>`;
    })
    .join('');
  return `<tr>${cellsHtml}</tr>\n`;
}

function buildHtml(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inv: InventoryReport | undefined,
  generatedAt: string,
): string {
  const counts = countBySeverity(findings);
  const { evidence_admission_score, components } = score;
  const runId = score.run_id;
  const grade = evidence_admission_score.grade;
  const gradeStyle = `color:${gradeColor(grade)};font-weight:bold`;

  const findingsSummary =
    `${findings.length} total — ` +
    `${counts.critical} critical, ${counts.high} high, ` +
    `${counts.medium} medium, ${counts.low} low`;

  const css = `
    body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { border-bottom: 1px solid #ccc; margin-top: 32px; }
    h3 { margin-top: 24px; }
    blockquote { color: #555; border-left: 3px solid #ccc; margin: 0; padding-left: 12px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #bbb; padding: 6px 10px; text-align: left; }
    th { background: #f4f4f4; }
    code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    ul { padding-left: 20px; }
    li { margin: 4px 0; }
    .severity-critical { color: red; font-weight: bold; }
    .severity-high { color: #c0392b; font-weight: bold; }
    .severity-medium { color: orange; font-weight: bold; }
    .severity-low { color: #666; }
    .severity-info { color: #333; }
    em { font-style: italic; }
    strong { font-weight: bold; }
  `.trim();

  const parts: string[] = [];

  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<title>OpenAgentAudit Report</title>');
  parts.push(`<style>${css}</style>`);
  parts.push('</head>');
  parts.push('<body>');

  // Title
  parts.push('<h1>OpenAgentAudit Report</h1>');
  parts.push(`<blockquote>Generated: ${escapeHtml(generatedAt)}</blockquote>`);

  // Executive Summary
  parts.push('<h2>Executive Summary</h2>');
  parts.push('<table>');
  parts.push('<thead><tr><th>Field</th><th>Value</th></tr></thead>');
  parts.push('<tbody>');
  parts.push(`<tr><td>Run ID</td><td><code>${escapeHtml(runId)}</code></td></tr>`);
  parts.push(`<tr><td>Total Events</td><td>${events.length}</td></tr>`);
  parts.push(
    `<tr><td>Evidence Admission Score</td><td>${evidence_admission_score.score}/100 ` +
    `(Grade <span style="${gradeStyle}">${grade}</span>)</td></tr>`,
  );
  parts.push(`<tr><td>Findings</td><td>${escapeHtml(findingsSummary)}</td></tr>`);
  parts.push('</tbody>');
  parts.push('</table>');

  // EAS breakdown
  parts.push('<h2>Evidence Admission Score</h2>');
  parts.push('<table>');
  parts.push('<thead><tr><th>Component</th><th>Score</th></tr></thead>');
  parts.push('<tbody>');
  parts.push(`<tr><td>Trace Completeness</td><td>${components['trace_completeness'] ?? 0}/100</td></tr>`);
  parts.push(`<tr><td>Provenance Integrity</td><td>${components['provenance_integrity'] ?? 0}/100</td></tr>`);
  parts.push(`<tr><td>Objective Verification</td><td>${components['objective_verification'] ?? 0}/100</td></tr>`);
  parts.push(`<tr><td>Policy Coverage</td><td>${components['policy_coverage'] ?? 0}/100</td></tr>`);
  parts.push(`<tr><td>Human Oversight Evidence</td><td>${components['human_oversight_evidence'] ?? 0}/100</td></tr>`);
  parts.push(`<tr><td>Contamination Risk</td><td>${components['contamination_risk_inverted'] ?? 0}/100</td></tr>`);
  parts.push(
    `<tr><td><strong>Total EAS</strong></td><td><strong>${evidence_admission_score.score}/100 ` +
    `(Grade <span style="${gradeStyle}">${grade}</span>)</strong></td></tr>`,
  );
  parts.push('</tbody>');
  parts.push('</table>');

  // Tool Inventory
  if (inv !== undefined) {
    parts.push('<h2>Tool Inventory</h2>');
    parts.push('<table>');
    parts.push('<thead><tr><th>Tool</th><th>Calls</th><th>Denied</th><th>Approved</th><th>Risk Tags</th></tr></thead>');
    parts.push('<tbody>');
    for (const t of inv.tools) {
      const tags = t.risk_tags.length > 0
        ? escapeHtml(t.risk_tags.join(', '))
        : '<em>none</em>';
      parts.push(
        `<tr><td><code>${escapeHtml(t.name)}</code></td>` +
        `<td>${t.calls}</td><td>${t.denied}</td><td>${t.approved}</td>` +
        `<td>${tags}</td></tr>`,
      );
    }
    parts.push('</tbody>');
    parts.push('</table>');
  }

  // Findings
  parts.push('<h2>Findings</h2>');

  if (findings.length === 0) {
    parts.push('<p>No findings.</p>');
  } else {
    const sorted = [...findings].sort(
      (a, b) => severityOrder(a.severity) - severityOrder(b.severity),
    );
    for (const f of sorted) {
      const sevClass = `severity-${f.severity}`;
      const sev = f.severity.toUpperCase();
      parts.push(
        `<h3><span class="${sevClass}">[${sev}]</span> ` +
        `${escapeHtml(f.rule_id)} — ${escapeHtml(f.title)}</h3>`,
      );
      parts.push('<ul>');
      parts.push(`<li><strong>Category:</strong> ${escapeHtml(f.category)}</li>`);
      parts.push(`<li><strong>Description:</strong> ${escapeHtml(f.description)}</li>`);
      parts.push(
        `<li><strong>Evidence IDs:</strong> ${f.evidence_ids.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}</li>`,
      );
      parts.push(`<li><strong>Recommendation:</strong> ${escapeHtml(f.recommendation)}</li>`);
      if (f.standard_mappings !== undefined && f.standard_mappings.length > 0) {
        const mappings = f.standard_mappings
          .map((m) => escapeHtml(`${m.profile}:${m.control_id}`))
          .join(', ');
        parts.push(`<li><strong>Standard Mappings:</strong> ${mappings}</li>`);
      }
      parts.push('</ul>');
    }
  }

  // Disclaimer
  parts.push('<h2>Disclaimer</h2>');
  parts.push(
    '<p><em>OpenAgentAudit produces technical evidence only. This report does not constitute legal advice or a determination of regulatory compliance.</em></p>',
  );

  parts.push('</body>');
  parts.push('</html>');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// JSON report
// ---------------------------------------------------------------------------

interface JsonReport {
  schema_version: 'open-agent-audit/v0.1';
  generated_at: string;
  run_id: string;
  risk_score: RiskScore;
  findings: Finding[];
  inventory?: InventoryReport;
  event_count: number;
}

function buildJson(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inv: InventoryReport | undefined,
  generatedAt: string,
): string {
  const obj: JsonReport = {
    schema_version: 'open-agent-audit/v0.1',
    generated_at: generatedAt,
    run_id: score.run_id,
    risk_score: score,
    findings,
    event_count: events.length,
  };
  if (inv !== undefined) {
    obj.inventory = inv;
  }
  return JSON.stringify(obj, null, 2);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function renderReport(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inventoryReport?: InventoryReport,
): Promise<ReportBundle> {
  const generatedAt = new Date().toISOString();

  const markdown = buildMarkdown(events, findings, score, inventoryReport, generatedAt);
  const html = buildHtml(events, findings, score, inventoryReport, generatedAt);
  const json = buildJson(events, findings, score, inventoryReport, generatedAt);

  return { markdown, html, json };
}
