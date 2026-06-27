/** @openagentaudit/core/report — full implementation. */
import type { CanonicalEvent, Finding, RiskScore } from '@openagentaudit/schema';
import type { InventoryReport } from '../inventory/index.js';

export interface ReportBundle {
  markdown: string;
  html: string;
  json: string;
  csv: string;
}

export interface ReportMeta {
  /** Unique report identifier, e.g. "OAA-2026-001". Auto-generated if not provided. */
  report_id?: string;
  /** Issuing organisation / platform name shown in the report. Default: "Trustavo (trustavo.com)" */
  issuer?: string;
  /** Issuer contact email. Default: "issuer@trustavo.com" */
  issuer_email?: string;
  /** Analyst or system that produced the report. */
  prepared_by?: string;
  /** Original trace file name(s) for provenance. */
  source_files?: string[];
  /** Timestamp of the original trace (from the earliest event). Auto-derived if not set. */
  trace_start?: string;
  /** Timestamp of the last event. Auto-derived if not set. */
  trace_end?: string;
  /** Audit profiles applied, e.g. ["owasp-agentic-top10-2026", "nist-ai-rmf-1.0"] */
  profiles_applied?: string[];
  /** Free-text audit scope description. */
  scope?: string;
  /** Engine version string. */
  engine_version?: string;
  /** Spec version. */
  spec_version?: string;
  /** Public URL where this report is hosted (used to generate QR code). */
  report_url?: string;
  /** Intended use of the AI system (EU AI Act Annex IV Item 1(b), Art. 13 transparency). */
  intended_use?: string;
  /** Deployment context — environment, user population, geography. */
  deployment_context?: string;
  /** Transparency statement surfaced to end users (EU AI Act Art. 13). */
  transparency_statement?: string;
  /** Quality management system reference (EU AI Act Art. 17). */
  qms_reference?: string;
  /** Run-provenance fields extracted from an AEP source record (aep/v0.2). */
  aep_provenance?: {
    repo_commit?: string;
    runtime_version?: string;
    policy_bundle_digest?: string;
    tool_manifest_digest?: string;
    mcp_server_card_digest?: string;
    parent_trace_id?: string;
    delegation_chain?: string[];
    model_provider?: string;
  };
}

// ---------------------------------------------------------------------------
// Compliance mapping types (exported)
// ---------------------------------------------------------------------------

export interface ComplianceMapping {
  profile_id: string;
  profile_name: string;
  requirements: Array<{
    id: string;
    label: string;
    status: 'supported' | 'partial' | 'not_applicable' | 'not_evaluated';
    evidence_event_ids: string[];
    limitation?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Internal resolved meta (all fields required after defaults applied)
// ---------------------------------------------------------------------------

interface ResolvedMeta {
  report_id: string;
  issuer: string;
  issuer_email: string;
  prepared_by: string;
  source_files: string[];
  trace_start: string;
  trace_end: string;
  profiles_applied: string[];
  scope: string;
  engine_version: string;
  spec_version: string;
  report_url: string;
  intended_use?: string;
  deployment_context?: string;
  transparency_statement?: string;
  qms_reference?: string;
  aep_provenance?: ReportMeta['aep_provenance'];
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

/** Wrap a field value in double quotes and escape any inner double quotes per RFC 4180. */
function csvField(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value);
  // Always quote to keep parsing unambiguous
  return '"' + s.replace(/"/g, '""') + '"';
}

function deriveReportId(generatedAt: string, runId: string): string {
  const datePart = generatedAt.slice(0, 10).replace(/-/g, '');
  const hash = Math.abs(
    runId.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0),
  )
    .toString(16)
    .slice(0, 6)
    .toUpperCase();
  return `OAA-${datePart}-${hash}`;
}

function deriveTraceStart(events: CanonicalEvent[]): string {
  if (events.length === 0) return '';
  let min = events[0]?.timestamp ?? '';
  for (const ev of events) {
    if (ev.timestamp < min) {
      min = ev.timestamp;
    }
  }
  return min;
}

function deriveTraceEnd(events: CanonicalEvent[]): string {
  if (events.length === 0) return '';
  let max = events[0]?.timestamp ?? '';
  for (const ev of events) {
    if (ev.timestamp > max) {
      max = ev.timestamp;
    }
  }
  return max;
}

/** Add six calendar months to an ISO timestamp and return YYYY-MM-DD. */
function addSixMonths(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

function resolveMeta(
  events: CanonicalEvent[],
  score: RiskScore,
  generatedAt: string,
  meta: ReportMeta | undefined,
): ResolvedMeta {
  const report_id = meta?.report_id ?? deriveReportId(generatedAt, score.run_id);
  const issuer = meta?.issuer ?? 'Trustavo (trustavo.com)';
  const issuer_email = meta?.issuer_email ?? 'issuer@trustavo.com';
  const prepared_by = meta?.prepared_by ?? 'automated';
  const source_files = meta?.source_files ?? [];
  const trace_start = meta?.trace_start ?? deriveTraceStart(events);
  const trace_end = meta?.trace_end ?? deriveTraceEnd(events);
  // Auto-populate profiles_applied from the compliance mappings we always compute
  const profiles_applied = meta?.profiles_applied ?? [
    'owasp-agentic-top10-2026',
    'eu-ai-act-annex-iv',
    'nist-ai-rmf-1.0',
    'iso-iec-42001',
  ];
  const scope = meta?.scope ?? 'Full trace analysis';
  const engine_version = meta?.engine_version ?? '0.1.0';
  const spec_version = meta?.spec_version ?? 'open-agent-audit/v0.1';
  const report_url = meta?.report_url ?? `https://trustavo.com/r/${report_id}`;
  const intended_use = meta?.intended_use;
  const deployment_context = meta?.deployment_context;
  const transparency_statement = meta?.transparency_statement;
  const qms_reference = meta?.qms_reference;

  return {
    report_id,
    issuer,
    issuer_email,
    prepared_by,
    source_files,
    trace_start,
    trace_end,
    profiles_applied,
    scope,
    engine_version,
    spec_version,
    report_url,
    ...(intended_use !== undefined ? { intended_use } : {}),
    ...(deployment_context !== undefined ? { deployment_context } : {}),
    ...(transparency_statement !== undefined ? { transparency_statement } : {}),
    ...(qms_reference !== undefined ? { qms_reference } : {}),
    aep_provenance: meta?.aep_provenance,
  };
}

// ---------------------------------------------------------------------------
// Compliance mapping derivation
// ---------------------------------------------------------------------------

function buildComplianceMappings(
  events: CanonicalEvent[],
  findings: Finding[],
): ComplianceMapping[] {

  // -------------------------------------------------------------------------
  // Pre-compute event sets used across multiple controls
  // -------------------------------------------------------------------------

  const observationEvents = events.filter((e) => e.type === 'observation');
  const toolCallEvents = events.filter((e) => e.type === 'tool_call');
  const policyDecisionEvents = events.filter((e) => e.type === 'policy_decision');
  const humanApprovalEvents = events.filter((e) => e.type === 'human_approval');
  const errorEvents = events.filter((e) => e.type === 'error');

  const denyPolicyEvents = policyDecisionEvents.filter(
    (e) => e.policy?.decision === 'deny',
  );

  const highRiskToolCallEvents = toolCallEvents.filter((e) => {
    const tags = e.tool?.risk_tags ?? [];
    return tags.includes('high_risk') || tags.includes('mutation');
  });

  // Network tool calls: heuristic — tool name or capability contains "network" / "fetch" / "http" / "url"
  const networkToolCallEvents = toolCallEvents.filter((e) => {
    const name = (e.tool?.name ?? '').toLowerCase();
    const cap = (e.tool?.capability ?? '').toLowerCase();
    return (
      name.includes('network') || name.includes('fetch') || name.includes('http') ||
      name.includes('curl') || name.includes('request') ||
      cap.includes('network') || cap.includes('fetch') || cap.includes('http')
    );
  });

  const networkDenyEvents = denyPolicyEvents.filter((e) => {
    const name = (e.tool?.name ?? '').toLowerCase();
    const cap = (e.tool?.capability ?? '').toLowerCase();
    return (
      name.includes('network') || name.includes('fetch') || name.includes('http') ||
      name.includes('curl') || name.includes('request') ||
      cap.includes('network') || cap.includes('fetch') || cap.includes('http')
    );
  });

  // Events that have any evidence field populated
  const eventsWithEvidence = events.filter((e) => e.evidence !== undefined);
  const eventsWithHash = events.filter(
    (e) => e.evidence?.hash !== undefined && e.evidence.hash !== '',
  );
  const eventsWithSignerKeyId = events.filter(
    (e) => e.evidence?.signer_key_id !== undefined && e.evidence.signer_key_id !== '',
  );

  // Rule IDs from findings, mapped to the finding's evidence_ids
  const findingsByRule = new Map<string, string[]>();
  for (const f of findings) {
    const existing = findingsByRule.get(f.rule_id);
    if (existing !== undefined) {
      for (const id of f.evidence_ids) {
        existing.push(id);
      }
    } else {
      findingsByRule.set(f.rule_id, [...f.evidence_ids]);
    }
  }

  // Helper: collect evidence_event_ids from findings for a set of rule_ids
  function evidenceFromRules(ruleIds: string[]): string[] {
    const ids: string[] = [];
    for (const rid of ruleIds) {
      const evIds = findingsByRule.get(rid);
      if (evIds !== undefined) {
        for (const id of evIds) {
          ids.push(id);
        }
      }
    }
    // Deduplicate
    return [...new Set(ids)];
  }

  // -------------------------------------------------------------------------
  // OWASP Agentic Top 10 2026
  // -------------------------------------------------------------------------

  type ReqEntry = ComplianceMapping['requirements'][number];

  const owaspReqs: ReqEntry[] = [];

  // AAI01 — Memory Poisoning
  {
    const id = 'AAI01';
    const label = 'Memory Poisoning and Persistent Context Manipulation';
    const limitation = 'Detects only what is present in the trace; out-of-band memory channels are not visible.';
    if (observationEvents.length === 0) {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    } else {
      const signedObs = observationEvents.filter(
        (e) => e.evidence?.signature !== undefined && e.evidence.signature !== '',
      );
      if (signedObs.length > 0) {
        owaspReqs.push({
          id, label, status: 'supported',
          evidence_event_ids: signedObs.map((e) => e.event_id),
          limitation,
        });
      } else {
        owaspReqs.push({
          id, label, status: 'partial',
          evidence_event_ids: observationEvents.map((e) => e.event_id),
          limitation,
        });
      }
    }
  }

  // AAI02 — Tool Misuse
  {
    const id = 'AAI02';
    const label = 'Tool Misuse and Unsafe Tool Invocation';
    const limitation = 'Conformance assumes the capability manifest is honestly declared.';
    const findingEvIds = evidenceFromRules([
      'OAA-R-CAP-001', 'OAA-R-CAP-002', 'OAA-R-POLICY-001', 'OAA-R-POLICY-002',
    ]);
    if (toolCallEvents.length > 0 && policyDecisionEvents.length > 0) {
      const evIds = [
        ...toolCallEvents.map((e) => e.event_id),
        ...policyDecisionEvents.map((e) => e.event_id),
        ...findingEvIds,
      ];
      owaspReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: [...new Set(evIds)],
        limitation,
      });
    } else if (toolCallEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...toolCallEvents.map((e) => e.event_id),
          ...findingEvIds,
        ])],
        limitation,
      });
    } else {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    }
  }

  // AAI03 — Privilege Escalation
  {
    const id = 'AAI03';
    const label = 'Privilege Escalation and Excessive Agency';
    const limitation = 'Excessive agency may emerge from chained tool calls not visible to a single rule.';
    const findingEvIds = evidenceFromRules(['OAA-R-CAP-001', 'OAA-R-CAP-002']);
    if (toolCallEvents.length === 0) {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    } else if (denyPolicyEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: [...new Set([
          ...denyPolicyEvents.map((e) => e.event_id),
          ...findingEvIds,
        ])],
        limitation,
      });
    } else if (policyDecisionEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...policyDecisionEvents.map((e) => e.event_id),
          ...findingEvIds,
        ])],
        limitation,
      });
    } else {
      owaspReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...toolCallEvents.map((e) => e.event_id),
          ...findingEvIds,
        ])],
        limitation,
      });
    }
  }

  // AAI04 — Insecure Inter-Agent Delegation
  {
    const id = 'AAI04';
    const label = 'Insecure Inter-Agent Delegation';
    const limitation = 'Multi-agent topologies must publish delegation context.';
    if (eventsWithSignerKeyId.length > 0) {
      owaspReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: eventsWithSignerKeyId.map((e) => e.event_id),
        limitation,
      });
    } else {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    }
  }

  // AAI05 — Unbounded External Communication
  {
    const id = 'AAI05';
    const label = 'Unbounded External Communication';
    const limitation = 'Network egress without instrumented tools cannot be detected.';
    if (networkDenyEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: networkDenyEvents.map((e) => e.event_id),
        limitation,
      });
    } else if (networkToolCallEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: networkToolCallEvents.map((e) => e.event_id),
        limitation,
      });
    } else {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    }
  }

  // AAI06 — Data Exfiltration
  {
    const id = 'AAI06';
    const label = 'Data Exfiltration Through Agent Outputs';
    const limitation = 'Detection relies on taint labels being present in the trace. Labels are set by the AEP emitter at run time.';
    // Match any tool call whose risk_tags contain a known output-taint indicator.
    // AEP adapters copy output_taint_labels values (e.g. "filesystem", "network", "pii")
    // into risk_tags — so we check for non-empty tags that are not purely allow-list items.
    const OUTPUT_TAINT_INDICATORS = ['filesystem', 'network', 'pii', 'exfil', 'output', 'external'];
    const taintedEvents = toolCallEvents.filter((e) => {
      const tags = e.tool?.risk_tags ?? [];
      return tags.some((t) =>
        OUTPUT_TAINT_INDICATORS.some((ind) => t.toLowerCase().includes(ind)),
      );
    });
    if (taintedEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: taintedEvents.map((e) => e.event_id),
        limitation,
      });
    } else {
      owaspReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
    }
  }

  // AAI07 — Goal Drift
  owaspReqs.push({
    id: 'AAI07',
    label: 'Goal Drift and Unintended Autonomy',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Requires drift-guard engine output not present in this trace.',
  });

  // AAI08 — Prompt Injection
  owaspReqs.push({
    id: 'AAI08',
    label: 'Indirect Prompt Injection via Tool Returns',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Requires injection filter evidence not present in this trace.',
  });

  // AAI09 — Insufficient Human Oversight
  {
    const id = 'AAI09';
    const label = 'Insufficient Human Oversight for High-Risk Actions';
    const limitation = 'Human approval records do not verify the reviewer\'s domain expertise.';
    const findingEvIds = evidenceFromRules(['OAA-R-OVERSIGHT-001']);
    if (highRiskToolCallEvents.length === 0) {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    } else if (humanApprovalEvents.length > 0) {
      owaspReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: [...new Set([
          ...humanApprovalEvents.map((e) => e.event_id),
          ...highRiskToolCallEvents.map((e) => e.event_id),
          ...findingEvIds,
        ])],
        limitation,
      });
    } else {
      owaspReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...highRiskToolCallEvents.map((e) => e.event_id),
          ...findingEvIds,
        ])],
        limitation,
      });
    }
  }

  // AAI10 — Insufficient Auditability
  {
    const id = 'AAI10';
    const label = 'Insufficient Auditability and Forensic Readiness';
    const limitation = 'Auditability is a property of the trace, not of the system as a whole.';
    const findingEvIds = evidenceFromRules(['OAA-R-INTEGRITY-001']);
    if (eventsWithEvidence.length === 0) {
      owaspReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    } else {
      const hashCoverage = events.length > 0 ? eventsWithHash.length / events.length : 0;
      if (hashCoverage > 0.5) {
        owaspReqs.push({
          id, label, status: 'supported',
          evidence_event_ids: [...new Set([
            ...eventsWithHash.map((e) => e.event_id),
            ...findingEvIds,
          ])],
          limitation,
        });
      } else {
        owaspReqs.push({
          id, label, status: 'partial',
          evidence_event_ids: [...new Set([
            ...eventsWithEvidence.map((e) => e.event_id),
            ...findingEvIds,
          ])],
          limitation,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // EU AI Act Annex IV
  // -------------------------------------------------------------------------

  const euReqs: ReqEntry[] = [];

  // annex-iv-system-description
  {
    const id = 'annex-iv-system-description';
    const label = 'General description of the AI system';
    const limitation = 'A system card supports the requirement but does not by itself satisfy legal sufficiency.';
    const hasAgentId = events.some((e) => e.agent_id !== '');
    const hasModelId = events.some((e) => e.model_id !== '');
    if (hasAgentId && hasModelId && toolCallEvents.length > 0) {
      euReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: toolCallEvents.slice(0, 5).map((e) => e.event_id),
        limitation,
      });
    } else if (hasAgentId && hasModelId) {
      euReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: events.slice(0, 3).map((e) => e.event_id),
        limitation,
      });
    } else {
      euReqs.push({ id, label, status: 'partial', evidence_event_ids: [], limitation });
    }
  }

  // annex-iv-design-specifications
  euReqs.push({
    id: 'annex-iv-design-specifications',
    label: 'Detailed description of the elements of the AI system and of the process for its development',
    status: 'partial',
    evidence_event_ids: [],
    limitation: 'Capability manifest not always present; runtime evidence reflects deployed configuration, not development provenance.',
  });

  // annex-iv-risk-management
  {
    const id = 'annex-iv-risk-management';
    const label = 'Description of the risk management system';
    const limitation = 'Policy decision events show runtime enforcement but Art. 9 requires a documented continuous risk management system (FMEA, risk register) — organizational documentation is required.';
    if (policyDecisionEvents.length > 0) {
      euReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...policyDecisionEvents.map((e) => e.event_id),
          ...humanApprovalEvents.map((e) => e.event_id),
        ])],
        limitation,
      });
    } else if (toolCallEvents.length > 0) {
      euReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: toolCallEvents.slice(0, 5).map((e) => e.event_id),
        limitation,
      });
    } else {
      euReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
    }
  }

  // annex-iv-data-governance
  euReqs.push({
    id: 'annex-iv-data-governance',
    label: 'Information about training, validation and testing data sets',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Requires contamination engine output not present in this trace.',
  });

  // annex-iv-testing-validation
  euReqs.push({
    id: 'annex-iv-testing-validation',
    label: 'Testing and validation procedures',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Requires benchmark engine output not present in this trace.',
  });

  // annex-iv-monitoring
  euReqs.push({
    id: 'annex-iv-monitoring',
    label: 'Post-market monitoring system',
    status: 'partial',
    evidence_event_ids: events.slice(0, 3).map((e) => e.event_id),
    limitation: 'Trace covers one run; post-market monitoring requires ongoing data collection across deployments.',
  });

  // annex-iv-human-oversight
  {
    const id = 'annex-iv-human-oversight';
    const label = 'Human oversight measures';
    const limitation = 'Approval records do not establish reviewer competence.';
    if (highRiskToolCallEvents.length === 0) {
      euReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    } else if (humanApprovalEvents.length > 0) {
      euReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: [...new Set([
          ...humanApprovalEvents.map((e) => e.event_id),
          ...highRiskToolCallEvents.map((e) => e.event_id),
        ])],
        limitation,
      });
    } else {
      euReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: highRiskToolCallEvents.map((e) => e.event_id),
        limitation,
      });
    }
  }

  // annex-iv-intended-use (Annex IV Item 1(b)) — EU AI Act Art. 13 transparency
  {
    const id = 'annex-iv-intended-use';
    const label = 'Intended purpose and foreseeable misuse (Annex IV Item 1(b), Art. 13)';
    const limitation = 'Requires a system card or provider declaration; runtime trace cannot substitute.';
    euReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
  }

  // annex-iv-logging-capability (Annex IV / Art. 12) — automatic logging capability declaration
  {
    const id = 'annex-iv-logging-capability';
    const label = 'Automatic logging capability (Art. 12(1))';
    const limitation = 'The presence of a trace demonstrates logging occurred; it does not certify the logging system meets Art. 12 specifications.';
    if (eventsWithEvidence.length > 0) {
      euReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: eventsWithEvidence.slice(0, 5).map((e) => e.event_id),
        limitation,
      });
    } else {
      euReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
    }
  }

  // annex-iv-qms (Art. 17) — quality management system reference
  {
    const id = 'annex-iv-qms';
    const label = 'Quality management system documentation (Art. 17)';
    const limitation = 'QMS documentation is organizational; runtime trace cannot evidence its existence.';
    euReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
  }

  // annex-iv-transparency (Art. 13) — transparency to deployers and users
  {
    const id = 'annex-iv-transparency';
    const label = 'Transparency obligations — capabilities and limitations disclosure (Art. 13)';
    const limitation = 'Art. 13 requires provider-supplied instructions for use; runtime trace cannot verify disclosure reached end users.';
    euReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
  }

  // annex-iv-accuracy-robustness
  {
    const id = 'annex-iv-accuracy-robustness';
    const label = 'Accuracy, robustness, and cybersecurity measures';
    const limitation = 'Cybersecurity posture extends beyond agent runtime evidence.';
    if (eventsWithEvidence.length === 0) {
      euReqs.push({ id, label, status: 'not_applicable', evidence_event_ids: [], limitation });
    } else {
      const signedEvents = events.filter(
        (e) => e.evidence?.signature !== undefined && e.evidence.signature !== '',
      );
      if (eventsWithHash.length > 0) {
        const evIds = [...new Set([
          ...eventsWithHash.map((e) => e.event_id),
          ...signedEvents.map((e) => e.event_id),
        ])];
        if (signedEvents.length > 0) {
          euReqs.push({ id, label, status: 'supported', evidence_event_ids: evIds, limitation });
        } else {
          euReqs.push({ id, label, status: 'partial', evidence_event_ids: evIds, limitation });
        }
      } else {
        euReqs.push({
          id, label, status: 'partial',
          evidence_event_ids: eventsWithEvidence.map((e) => e.event_id),
          limitation,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // NIST AI RMF 1.0
  // -------------------------------------------------------------------------

  const nistReqs: ReqEntry[] = [];

  // GOVERN-1.1 — organisational
  nistReqs.push({
    id: 'GOVERN-1.1',
    label: 'Legal and regulatory requirements involving AI are understood and managed',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Technical artifacts do not establish that an organization has performed the necessary legal review.',
  });

  // MAP-2.2 — partial if risk_tags present on tool events
  {
    const id = 'MAP-2.2';
    const label = "Information about the AI system's knowledge limits is documented";
    const limitation = 'System cards may not capture all emergent behavior.';
    const taggedToolEvents = toolCallEvents.filter(
      (e) => (e.tool?.risk_tags ?? []).length > 0,
    );
    if (taggedToolEvents.length > 0) {
      nistReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: taggedToolEvents.map((e) => e.event_id),
        limitation,
      });
    } else {
      nistReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
    }
  }

  // MEASURE-2.7 — supported if findings present (EAS computed); partial otherwise
  {
    const id = 'MEASURE-2.7';
    const label = 'AI system security and resilience are evaluated';
    const limitation = 'Evidence reflects observed runs only; adversarial coverage depends on the test set.';
    const findingEvIds = evidenceFromRules([
      'OAA-R-CAP-001', 'OAA-R-CAP-002', 'OAA-R-OVERSIGHT-001',
      'OAA-R-POLICY-001', 'OAA-R-POLICY-002', 'OAA-R-INTEGRITY-001',
    ]);
    if (findings.length > 0) {
      nistReqs.push({
        id, label, status: 'supported',
        evidence_event_ids: [...new Set([
          ...findingEvIds,
          ...policyDecisionEvents.map((e) => e.event_id),
          ...eventsWithHash.map((e) => e.event_id),
        ])],
        limitation,
      });
    } else {
      nistReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...policyDecisionEvents.map((e) => e.event_id),
          ...eventsWithHash.map((e) => e.event_id),
        ])],
        limitation,
      });
    }
  }

  // MEASURE-2.9 — not_evaluated (requires benchmark engine)
  nistReqs.push({
    id: 'MEASURE-2.9',
    label: 'AI system performance is measured against benchmarks with documented validity',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Statistical validity depends on dataset quality and sampling protocol.',
  });

  // MANAGE-2.3 — response and recovery procedures
  // Deny-policy alone is NOT evidence of response/recovery; it is policy enforcement.
  // Human approvals + deny decisions together suggest an active response posture (partial).
  {
    const id = 'MANAGE-2.3';
    const label = 'Procedures are followed to respond to and recover from AI risks';
    const limitation = 'Runtime trace can show that risk responses were triggered (deny, escalate) but cannot verify that documented recovery procedures exist or were followed.';
    if (humanApprovalEvents.length > 0 && denyPolicyEvents.length > 0) {
      nistReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...humanApprovalEvents.map((e) => e.event_id),
          ...denyPolicyEvents.map((e) => e.event_id),
        ])],
        limitation,
      });
    } else if (denyPolicyEvents.length > 0 || errorEvents.length > 0) {
      nistReqs.push({
        id, label, status: 'partial',
        evidence_event_ids: [...new Set([
          ...denyPolicyEvents.map((e) => e.event_id),
          ...errorEvents.map((e) => e.event_id),
        ])],
        limitation,
      });
    } else {
      nistReqs.push({ id, label, status: 'not_evaluated', evidence_event_ids: [], limitation });
    }
  }

  // MANAGE-4.1 — not_evaluated (requires ongoing monitoring data)
  nistReqs.push({
    id: 'MANAGE-4.1',
    label: 'Post-deployment AI system monitoring is implemented',
    status: 'not_evaluated',
    evidence_event_ids: [],
    limitation: 'Drift detection is statistical; semantic drift is harder. Requires ongoing monitoring data.',
  });

  // -------------------------------------------------------------------------
  // ISO/IEC 42001
  // -------------------------------------------------------------------------

  const isoLimitation = 'Requires organizational documentation beyond runtime evidence.';

  const isoReqs: ReqEntry[] = [
    {
      id: 'A.6.1.4',
      label: 'AI system impact assessment',
      status: 'not_evaluated',
      evidence_event_ids: [],
      limitation: isoLimitation,
    },
    {
      id: 'A.7.4',
      label: 'Data quality for AI systems',
      status: 'not_evaluated',
      evidence_event_ids: [],
      limitation: isoLimitation,
    },
    {
      id: 'A.8.2',
      label: 'Performance evaluation of AI systems',
      status: 'not_evaluated',
      evidence_event_ids: [],
      limitation: 'Coverage limited to instrumented benchmarks. Requires benchmark engine output.',
    },
    {
      id: 'A.9.2',
      label: 'Communication of AI system information',
      status: 'not_evaluated',
      evidence_event_ids: [],
      limitation: 'Communication effectiveness is organizational, not technical.',
    },
    {
      id: 'A.10.2',
      label: 'Monitoring and reporting of AI system operation',
      status: 'not_evaluated',
      evidence_event_ids: [],
      limitation: 'Tooling supports monitoring; does not perform it. Requires drift summary.',
    },
  ];

  return [
    {
      profile_id: 'owasp-agentic-top10-2026',
      profile_name: 'OWASP Top 10 for Agentic Applications 2026',
      requirements: owaspReqs,
    },
    {
      profile_id: 'eu-ai-act-annex-iv',
      profile_name: 'EU AI Act Annex IV Technical Documentation Evidence Profile',
      requirements: euReqs,
    },
    {
      profile_id: 'nist-ai-rmf-1.0',
      profile_name: 'NIST AI Risk Management Framework 1.0 (Govern / Map / Measure / Manage)',
      requirements: nistReqs,
    },
    {
      profile_id: 'iso-iec-42001',
      profile_name: 'ISO/IEC 42001:2023 AI Management Systems',
      requirements: isoReqs,
    },
  ];
}

// ---------------------------------------------------------------------------
// Status rendering helpers
// ---------------------------------------------------------------------------

function statusSymbol(status: ComplianceMapping['requirements'][number]['status']): string {
  switch (status) {
    case 'supported':     return '✅ supported';
    case 'partial':       return '⚠️ partial';
    case 'not_applicable': return '— not applicable';
    case 'not_evaluated': return '? not evaluated';
  }
}

function statusHtmlStyle(status: ComplianceMapping['requirements'][number]['status']): string {
  switch (status) {
    case 'supported':     return 'color:green;font-weight:bold';
    case 'partial':       return 'color:orange;font-weight:bold';
    case 'not_applicable': return 'color:gray';
    case 'not_evaluated': return 'color:lightgray';
  }
}

// ---------------------------------------------------------------------------
// CSV generation
// ---------------------------------------------------------------------------

function buildCsv(
  events: CanonicalEvent[],
  findings: Finding[],
): string {
  const rows: string[] = [];

  // ---- Section 1: Findings ----
  rows.push(
    'finding_id,rule_id,severity,category,title,description,recommendation,evidence_ids,confidence',
  );
  for (const f of findings) {
    rows.push(
      [
        csvField(f.finding_id),
        csvField(f.rule_id),
        csvField(f.severity),
        csvField(f.category),
        csvField(f.title),
        csvField(f.description),
        csvField(f.recommendation),
        csvField(f.evidence_ids.join('; ')),
        csvField(f.confidence ?? ''),
      ].join(','),
    );
  }

  // Blank line separating the two sections
  rows.push('');

  // ---- Section 2: Events ----
  rows.push(
    'index,event_id,type,actor,timestamp,tool_name,tool_capability,risk_tags,' +
    'policy_decision,policy_reason,human_reviewer,human_decision,' +
    'error_kind,error_message,observation_source,evidence_id,evidence_hash',
  );
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    rows.push(
      [
        csvField(i),
        csvField(e.event_id),
        csvField(e.type),
        csvField(e.actor),
        csvField(e.timestamp),
        csvField(e.tool?.name ?? ''),
        csvField(e.tool?.capability ?? ''),
        csvField((e.tool?.risk_tags ?? []).join('; ')),
        csvField(e.policy?.decision ?? ''),
        csvField(e.policy?.reason ?? ''),
        csvField(e.human?.reviewer_id ?? ''),
        csvField(e.human?.decision ?? ''),
        csvField(e.error?.kind ?? ''),
        csvField(e.error?.message ?? ''),
        csvField(e.observation?.source ?? ''),
        csvField(e.evidence?.evidence_id ?? ''),
        csvField(e.evidence?.hash ?? ''),
      ].join(','),
    );
  }

  return rows.join('\r\n');
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function buildComplianceMappingMarkdown(mappings: ComplianceMapping[]): string[] {
  const lines: string[] = [];

  lines.push('## Compliance Framework Mapping');
  lines.push('');
  lines.push('> Mapping is interpretive and non-binding. See Disclaimer.');
  lines.push('');

  for (const profile of mappings) {
    lines.push(`### ${profile.profile_name}`);
    lines.push('');

    // Choose column layout by profile
    if (
      profile.profile_id === 'owasp-agentic-top10-2026'
    ) {
      lines.push('| Control | Label | Status | Evidence Events |');
      lines.push('|---|---|---|---|');
      for (const req of profile.requirements) {
        const evIds =
          req.evidence_event_ids.length > 0
            ? req.evidence_event_ids.join(', ')
            : '—';
        lines.push(
          `| ${req.id} | ${req.label} | ${statusSymbol(req.status)} | ${evIds} |`,
        );
      }
    } else {
      lines.push('| Requirement | Description | Status | Limitation |');
      lines.push('|---|---|---|---|');
      for (const req of profile.requirements) {
        const limitation = req.limitation !== undefined ? req.limitation : '—';
        lines.push(
          `| ${req.id} | ${req.label} | ${statusSymbol(req.status)} | ${limitation} |`,
        );
      }
    }
    lines.push('');
  }

  return lines;
}

/** Attempt to base64-decode an event_id for human-readable display; falls back to original. */
function decodeEventId(id: string): string {
  try {
    const decoded = atob(id);
    // Only use the decoded form if it is printable ASCII (no control chars)
    if (/^[ -~]+$/.test(decoded)) return decoded;
  } catch { /* not base64 */ }
  return id;
}

/** Build a human-readable details string for one event (used in Forensic Appendix). */
function buildEventDetails(ev: CanonicalEvent): string {
  if (ev.tool?.name) {
    const cap = ev.tool.capability ? ` (${ev.tool.capability})` : '';
    const tags = ev.tool.risk_tags && ev.tool.risk_tags.length > 0
      ? ` [${ev.tool.risk_tags.join(', ')}]` : '';
    return `tool: ${ev.tool.name}${cap}${tags}`;
  }
  if (ev.policy?.decision) {
    return `${ev.policy.decision}${ev.policy.reason ? ` — ${ev.policy.reason}` : ''}`;
  }
  if (ev.human?.decision) {
    return `${ev.human.decision} — ${ev.human.reviewer_id}${ev.human.justification ? ` · "${ev.human.justification}"` : ''}`;
  }
  if (ev.error?.kind) {
    return `${ev.error.kind}${ev.error.message ? `: ${ev.error.message}` : ''}`;
  }
  if (ev.observation?.source) {
    const size = ev.observation.byte_size != null ? ` · ${ev.observation.byte_size}B` : '';
    return `source: ${ev.observation.source}${size}`;
  }
  if (ev.model_output) {
    const parts: string[] = [];
    if (ev.model_output.finish_reason) parts.push(`finish: ${ev.model_output.finish_reason}`);
    if (ev.model_output.token_count != null) parts.push(`${ev.model_output.token_count} tokens`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return '—';
}

function buildMarkdown(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inv: InventoryReport | undefined,
  generatedAt: string,
  resolved: ResolvedMeta,
  complianceMappings: ComplianceMapping[],
): string {
  const counts = countBySeverity(findings);
  const { evidence_admission_score, components } = score;
  const runId = score.run_id;

  const findingsSummary =
    `${findings.length} total — ` +
    `${counts.critical} critical, ${counts.high} high, ` +
    `${counts.medium} medium, ${counts.low} low`;

  const firstEvent = events[0];
  const agentId = firstEvent?.agent_id ?? '—';
  const modelId = firstEvent?.model_id ?? '—';

  const sourceFilesDisplay =
    resolved.source_files.length > 0 ? resolved.source_files.join(', ') : '—';
  const profilesDisplay =
    resolved.profiles_applied.length > 0 ? resolved.profiles_applied.join(', ') : '—';
  const tracePeriod =
    resolved.trace_start !== '' && resolved.trace_end !== ''
      ? `${resolved.trace_start} → ${resolved.trace_end}`
      : '—';

  const retentionUntil = addSixMonths(resolved.trace_end !== '' ? resolved.trace_end : generatedAt);

  const lines: string[] = [];

  // Header
  lines.push('# OpenAgentAudit Report');
  lines.push(`> Generated: ${generatedAt}`);
  lines.push('');

  // Report Metadata
  lines.push('## Report Metadata');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Report ID | ${resolved.report_id} |`);
  lines.push(`| Issued by | ${resolved.issuer} |`);
  lines.push(`| Issuer contact | ${resolved.issuer_email} |`);
  lines.push(`| Report URL | ${resolved.report_url} |`);
  lines.push(`| Prepared by | ${resolved.prepared_by} |`);
  lines.push(`| Generated at | ${generatedAt} |`);
  lines.push(`| Spec version | ${resolved.spec_version} |`);
  lines.push(`| Engine version | ${resolved.engine_version} |`);
  lines.push(`| Source file(s) | ${sourceFilesDisplay} |`);
  lines.push(`| Trace period | ${tracePeriod} |`);
  lines.push(`| Run ID | \`${runId}\` |`);
  lines.push(`| Agent ID | ${agentId} |`);
  lines.push(`| Model ID | ${modelId} |`);
  lines.push(`| Profiles applied | ${profilesDisplay} |`);
  lines.push(`| Audit scope | ${resolved.scope} |`);
  if (resolved.intended_use) lines.push(`| Intended use | ${resolved.intended_use} |`);
  if (resolved.deployment_context) lines.push(`| Deployment context | ${resolved.deployment_context} |`);
  if (resolved.transparency_statement) lines.push(`| Transparency statement | ${resolved.transparency_statement} |`);
  if (resolved.qms_reference) lines.push(`| QMS reference (Art. 17) | ${resolved.qms_reference} |`);
  lines.push('');

  // AEP Run Provenance (only rendered when present)
  const prov = resolved.aep_provenance;
  if (prov !== undefined && Object.keys(prov).length > 0) {
    lines.push('## AEP Run Provenance');
    lines.push('');
    lines.push(
      'These fields anchor this record to the exact code, runtime, policy ruleset,' +
      ' and tool manifest in effect at run time (EU AI Act Art. 12(3)(c) / Art. 19).',
    );
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    if (prov.repo_commit) lines.push(`| Repo commit | \`${prov.repo_commit}\` |`);
    if (prov.runtime_version) lines.push(`| Runtime version | ${prov.runtime_version} |`);
    if (prov.model_provider) lines.push(`| Model provider | ${prov.model_provider} |`);
    if (prov.policy_bundle_digest) lines.push(`| Policy bundle digest | \`${prov.policy_bundle_digest.slice(0, 16)}…\` |`);
    if (prov.tool_manifest_digest) lines.push(`| Tool manifest digest | \`${prov.tool_manifest_digest.slice(0, 16)}…\` |`);
    if (prov.mcp_server_card_digest) lines.push(`| MCP server card digest | \`${prov.mcp_server_card_digest.slice(0, 16)}…\` |`);
    if (prov.parent_trace_id) lines.push(`| Parent trace ID | \`${prov.parent_trace_id}\` |`);
    if (prov.delegation_chain && prov.delegation_chain.length > 0) {
      lines.push(`| Delegation chain | ${prov.delegation_chain.join(' → ')} |`);
    }
    lines.push('');
  }

  // Log Retention Notice (EU AI Act Art. 26(6))
  lines.push('## Log Retention Notice (EU AI Act Art. 26(6))');
  lines.push('');
  lines.push(
    'This audit report and the underlying event trace must be retained for a minimum of' +
    ' **6 months** from the date of last use of the AI system, per Article 26(6) of' +
    ' Regulation (EU) 2024/1689 (EU AI Act). Sector-specific or national law may require' +
    ' longer retention periods.',
  );
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Report generated | ${generatedAt} |`);
  lines.push(`| Minimum retention until | ${retentionUntil} |`);
  lines.push(`| Issuing platform | ${resolved.issuer} |`);
  lines.push(`| Applicable regulation | EU AI Act (Regulation (EU) 2024/1689), Art. 26(6) |`);
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
  lines.push('| Component | Score | What this means |');
  lines.push('|---|---|---|');
  const tcScore = components['trace_completeness'] ?? 0;
  const piScore = components['provenance_integrity'] ?? 0;
  const ovScore = components['objective_verification'] ?? 0;
  const pcScore = components['policy_coverage'] ?? 0;
  const hoScore = components['human_oversight_evidence'] ?? 0;
  const crScore = components['contamination_risk_inverted'] ?? 0;
  const toolCalls = events.filter((e) => e.type === 'tool_call').length;
  const policyDecisions = events.filter((e) => e.type === 'policy_decision').length;
  const verifierObs = events.filter((e) => e.type === 'observation' && e.observation?.source?.startsWith('verifier:')).length;
  lines.push(`| Trace Completeness | ${tcScore}/100 | Penalties for missing evidence_id or timestamp fields, and unpaired tool calls |`);
  lines.push(`| Provenance Integrity | ${piScore}/100 | Hash chain integrity and Ed25519 signature coverage across all events |`);
  lines.push(`| Objective Verification | ${ovScore}/100 | ${verifierObs} verifier result(s) against ${toolCalls} tool call(s) — deterministic verifier coverage |`);
  lines.push(`| Policy Coverage | ${pcScore}/100 | ${policyDecisions} policy decision(s) against ${toolCalls} tool call(s) — ${toolCalls > 0 ? Math.round((policyDecisions / toolCalls) * 100) : 'N/A'}% coverage |`);
  lines.push(`| Human Oversight Evidence | ${hoScore}/100 | Human approval records for actions tagged high_risk or human_required |`);
  lines.push(`| Contamination Risk | ${crScore}/100 | Training/test data overlap risk (100 = no contamination detected) |`);
  lines.push(
    `| **Total EAS** | **${evidence_admission_score.score}/100 (Grade ${evidence_admission_score.grade})** | Weighted average — see docs/evidence-admission-score.md |`,
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

  // Compliance Framework Mapping (after Findings, before Limitations)
  for (const l of buildComplianceMappingMarkdown(complianceMappings)) {
    lines.push(l);
  }

  // Limitations
  lines.push('## Limitations');
  lines.push('');
  lines.push('- This report covers only events present in the submitted trace. Behavior outside this trace is not evaluated.');
  lines.push('- Regulatory framework mappings are interpretive and non-binding. See Disclaimer.');
  lines.push('- Evidence integrity is verified only for events that include hash/signature fields.');
  lines.push('- Tool capability declarations are taken at face value; manifest honesty is assumed.');
  lines.push('');

  // Disclaimer
  lines.push('## Disclaimer');
  lines.push('');
  lines.push(
    '_OpenAgentAudit produces technical evidence only. This report does not constitute legal advice or a determination of regulatory compliance._',
  );
  lines.push('');

  // Evidence Chain Status
  const chainEvents = events.filter((e) => e.evidence?.hash !== undefined || e.evidence?.prev_hash !== undefined);
  if (chainEvents.length > 0) {
    lines.push('## Evidence Chain Status');
    lines.push('');
    lines.push('| Event ID | Type | Has Signature | Chain Status |');
    lines.push('|---|---|---|---|');
    let prevHash = '';
    let brokenCount = 0;
    for (let i = 0; i < chainEvents.length; i++) {
      const ev = chainEvents[i];
      if (ev === undefined) continue;
      const hasSig = ev.evidence?.signature !== undefined ? '✅' : '—';
      let chainStatus: string;
      if (i === 0) {
        const isGenesis = ev.evidence?.prev_hash === '0'.repeat(64);
        chainStatus = isGenesis ? 'genesis' : '⚠️ non-standard genesis';
      } else {
        chainStatus = ev.evidence?.prev_hash === prevHash ? '✅ linked' : '❌ broken';
        if (ev.evidence?.prev_hash !== prevHash) brokenCount++;
      }
      prevHash = ev.evidence?.hash ?? '';
      lines.push(`| ${decodeEventId(ev.event_id)} | ${ev.type} | ${hasSig} | ${chainStatus} |`);
    }
    const unsigned = events.length - chainEvents.length;
    lines.push('');
    lines.push(
      `_Chain summary: ${chainEvents.length} of ${events.length} events signed. ` +
      `${brokenCount} chain break(s) detected. ${unsigned} unsigned events._`,
    );
    lines.push('');
  }

  // Forensic Event Appendix
  lines.push('## Forensic Event Appendix');
  lines.push('');
  lines.push(`> This appendix lists all ${events.length} events in the submitted trace for forensic reference.`);
  lines.push(`> Generated by ${resolved.issuer} — ${resolved.issuer_email} — OpenAgentAudit v${resolved.engine_version}`);
  lines.push('');
  lines.push('| # | Event ID | Type | Actor | Timestamp | Details | Evidence ID |');
  lines.push('|---|---|---|---|---|---|---|');
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined) continue;
    const details = buildEventDetails(ev);
    const evidenceId = ev.evidence?.evidence_id ?? '—';
    lines.push(`| ${i + 1} | ${decodeEventId(ev.event_id)} | ${ev.type} | ${ev.actor} | ${ev.timestamp} | ${details} | ${evidenceId} |`);
  }
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

function buildComplianceMappingHtml(mappings: ComplianceMapping[]): string[] {
  const parts: string[] = [];

  parts.push('<h2>Compliance Framework Mapping</h2>');
  parts.push('<blockquote>Mapping is interpretive and non-binding. See Disclaimer.</blockquote>');

  for (const profile of mappings) {
    parts.push(`<h3>${escapeHtml(profile.profile_name)}</h3>`);

    if (profile.profile_id === 'owasp-agentic-top10-2026') {
      parts.push('<table>');
      parts.push('<thead><tr><th>Control</th><th>Label</th><th>Status</th><th>Evidence Events</th></tr></thead>');
      parts.push('<tbody>');
      for (const req of profile.requirements) {
        const evIds =
          req.evidence_event_ids.length > 0
            ? req.evidence_event_ids.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')
            : '<em>none</em>';
        const style = statusHtmlStyle(req.status);
        parts.push(
          `<tr>` +
          `<td>${escapeHtml(req.id)}</td>` +
          `<td>${escapeHtml(req.label)}</td>` +
          `<td><span style="${style}">${escapeHtml(statusSymbol(req.status))}</span></td>` +
          `<td>${evIds}</td>` +
          `</tr>`,
        );
      }
      parts.push('</tbody>');
      parts.push('</table>');
    } else {
      parts.push('<table>');
      parts.push('<thead><tr><th>Requirement</th><th>Description</th><th>Status</th><th>Limitation</th></tr></thead>');
      parts.push('<tbody>');
      for (const req of profile.requirements) {
        const limitation =
          req.limitation !== undefined ? escapeHtml(req.limitation) : '<em>none</em>';
        const style = statusHtmlStyle(req.status);
        parts.push(
          `<tr>` +
          `<td>${escapeHtml(req.id)}</td>` +
          `<td>${escapeHtml(req.label)}</td>` +
          `<td><span style="${style}">${escapeHtml(statusSymbol(req.status))}</span></td>` +
          `<td><em>${limitation}</em></td>` +
          `</tr>`,
        );
      }
      parts.push('</tbody>');
      parts.push('</table>');
    }
  }

  return parts;
}

function buildHtml(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inv: InventoryReport | undefined,
  generatedAt: string,
  resolved: ResolvedMeta,
  complianceMappings: ComplianceMapping[],
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

  const firstEvent = events[0];
  const agentId = firstEvent?.agent_id ?? '—';
  const modelId = firstEvent?.model_id ?? '—';

  const sourceFilesDisplay =
    resolved.source_files.length > 0
      ? escapeHtml(resolved.source_files.join(', '))
      : '<em>none</em>';
  const profilesDisplay =
    resolved.profiles_applied.length > 0
      ? escapeHtml(resolved.profiles_applied.join(', '))
      : '<em>none</em>';
  const tracePeriod =
    resolved.trace_start !== '' && resolved.trace_end !== ''
      ? `${escapeHtml(resolved.trace_start)} &rarr; ${escapeHtml(resolved.trace_end)}`
      : '<em>—</em>';

  const retentionUntil = addSixMonths(resolved.trace_end !== '' ? resolved.trace_end : generatedAt);

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
    @media print {
      body { max-width: 100%; margin: 10px; font-size: 11pt; }
      h1, h2 { page-break-after: avoid; }
      table { page-break-inside: avoid; font-size: 9pt; }
      tr { page-break-inside: avoid; }
      .no-print { display: none; }
      a { color: inherit; text-decoration: none; }
      blockquote { border-left: 2px solid #999; }
      body::before {
        content: "TRUSTAVO.COM  •  OPENAGENTAUDIT  •  OFFICIAL REPORT  •  EU AI ACT COMPLIANT  •  ";
        position: fixed;
        top: 48%;
        left: -20%;
        width: 150%;
        font-size: 11pt;
        font-family: Arial, sans-serif;
        color: rgba(79, 70, 229, 0.07);
        font-weight: bold;
        letter-spacing: 0.15em;
        transform: rotate(-35deg);
        white-space: nowrap;
        pointer-events: none;
        z-index: 0;
      }
    }
    @page {
      margin: 2cm;
      @top-center { content: "OpenAgentAudit Report — ${resolved.issuer}"; font-size: 9pt; color: #666; }
      @bottom-center { content: "EU AI Act Art. 26(6) Compliant — ${resolved.issuer_email}"; font-size: 8pt; color: #9ca3af; }
      @bottom-right { content: counter(page) " / " counter(pages); font-size: 9pt; }
    }
  `.trim();

  const parts: string[] = [];

  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<meta name="robots" content="noindex, nofollow">');
  parts.push(`<title>Audit Report ${escapeHtml(runId.slice(0, 8))} — ${escapeHtml(resolved.issuer)} — OpenAgentAudit</title>`);
  parts.push(`<meta name="description" content="AI agent audit report for run ${escapeHtml(runId.slice(0, 8))}. EAS score: ${evidence_admission_score.score}/100 (Grade ${escapeHtml(grade)}). ${escapeHtml(findingsSummary)}. Issued by ${escapeHtml(resolved.issuer)}.">`);
  parts.push(`<style>${css}</style>`);
  parts.push('</head>');
  parts.push('<body>');

  // Print button
  parts.push(
    '<div class="no-print" style="text-align:right;margin-bottom:16px">' +
    '<button onclick="window.print()" style="padding:6px 16px;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">' +
    '🖨 Print / Save as PDF' +
    '</button>' +
    '</div>',
  );

  // Title
  parts.push('<h1>OpenAgentAudit Report</h1>');
  parts.push(`<blockquote>Generated: ${escapeHtml(generatedAt)}</blockquote>`);

  // Report Metadata
  parts.push('<h2>Report Metadata</h2>');
  parts.push('<table>');
  parts.push('<thead><tr><th>Field</th><th>Value</th></tr></thead>');
  parts.push('<tbody>');
  parts.push(`<tr><td>Report ID</td><td>${escapeHtml(resolved.report_id)}</td></tr>`);
  parts.push(`<tr><td>Issued by</td><td>${escapeHtml(resolved.issuer)}</td></tr>`);
  parts.push(`<tr><td>Issuer contact</td><td><a href="mailto:${escapeHtml(resolved.issuer_email)}">${escapeHtml(resolved.issuer_email)}</a></td></tr>`);
  parts.push(`<tr><td>Report URL</td><td><a href="${escapeHtml(resolved.report_url)}">${escapeHtml(resolved.report_url)}</a></td></tr>`);
  parts.push(`<tr><td>Prepared by</td><td>${escapeHtml(resolved.prepared_by)}</td></tr>`);
  parts.push(`<tr><td>Generated at</td><td>${escapeHtml(generatedAt)}</td></tr>`);
  parts.push(`<tr><td>Spec version</td><td>${escapeHtml(resolved.spec_version)}</td></tr>`);
  parts.push(`<tr><td>Engine version</td><td>${escapeHtml(resolved.engine_version)}</td></tr>`);
  parts.push(`<tr><td>Source file(s)</td><td>${sourceFilesDisplay}</td></tr>`);
  parts.push(`<tr><td>Trace period</td><td>${tracePeriod}</td></tr>`);
  parts.push(`<tr><td>Run ID</td><td><code>${escapeHtml(runId)}</code></td></tr>`);
  parts.push(`<tr><td>Agent ID</td><td>${escapeHtml(agentId)}</td></tr>`);
  parts.push(`<tr><td>Model ID</td><td>${escapeHtml(modelId)}</td></tr>`);
  parts.push(`<tr><td>Profiles applied</td><td>${profilesDisplay}</td></tr>`);
  parts.push(`<tr><td>Audit scope</td><td>${escapeHtml(resolved.scope)}</td></tr>`);
  if (resolved.intended_use) parts.push(`<tr><td>Intended use</td><td>${escapeHtml(resolved.intended_use)}</td></tr>`);
  if (resolved.deployment_context) parts.push(`<tr><td>Deployment context</td><td>${escapeHtml(resolved.deployment_context)}</td></tr>`);
  if (resolved.transparency_statement) parts.push(`<tr><td>Transparency statement (Art. 13)</td><td>${escapeHtml(resolved.transparency_statement)}</td></tr>`);
  if (resolved.qms_reference) parts.push(`<tr><td>QMS reference (Art. 17)</td><td>${escapeHtml(resolved.qms_reference)}</td></tr>`);
  parts.push('</tbody>');
  parts.push('</table>');

  // AEP Run Provenance (only rendered when present)
  const prov = resolved.aep_provenance;
  if (prov !== undefined && Object.keys(prov).length > 0) {
    parts.push('<h2>AEP Run Provenance</h2>');
    parts.push(
      '<p>These fields anchor this record to the exact code, runtime, policy ruleset,' +
      ' and tool manifest in effect at run time' +
      ' (<abbr title="EU AI Act Art. 12(3)(c) / Art. 19">EU AI Act Art. 12(3)(c) / Art. 19</abbr>).</p>',
    );
    parts.push('<table>');
    parts.push('<thead><tr><th>Field</th><th>Value</th></tr></thead>');
    parts.push('<tbody>');
    if (prov.repo_commit) parts.push(`<tr><td>Repo commit</td><td><code>${escapeHtml(prov.repo_commit)}</code></td></tr>`);
    if (prov.runtime_version) parts.push(`<tr><td>Runtime version</td><td>${escapeHtml(prov.runtime_version)}</td></tr>`);
    if (prov.model_provider) parts.push(`<tr><td>Model provider</td><td>${escapeHtml(prov.model_provider)}</td></tr>`);
    if (prov.policy_bundle_digest) parts.push(`<tr><td>Policy bundle digest</td><td><code>${escapeHtml(prov.policy_bundle_digest.slice(0, 16))}…</code></td></tr>`);
    if (prov.tool_manifest_digest) parts.push(`<tr><td>Tool manifest digest</td><td><code>${escapeHtml(prov.tool_manifest_digest.slice(0, 16))}…</code></td></tr>`);
    if (prov.mcp_server_card_digest) parts.push(`<tr><td>MCP server card digest</td><td><code>${escapeHtml(prov.mcp_server_card_digest.slice(0, 16))}…</code></td></tr>`);
    if (prov.parent_trace_id) parts.push(`<tr><td>Parent trace ID</td><td><code>${escapeHtml(prov.parent_trace_id)}</code></td></tr>`);
    if (prov.delegation_chain && prov.delegation_chain.length > 0) {
      parts.push(`<tr><td>Delegation chain</td><td>${escapeHtml(prov.delegation_chain.join(' → '))}</td></tr>`);
    }
    parts.push('</tbody>');
    parts.push('</table>');
  }

  // Log Retention Notice (EU AI Act Art. 26(6))
  parts.push('<h2>Log Retention Notice (EU AI Act Art. 26(6))</h2>');
  parts.push(
    '<p>This audit report and the underlying event trace must be retained for a minimum of' +
    ' <strong>6 months</strong> from the date of last use of the AI system, per Article 26(6) of' +
    ' Regulation (EU) 2024/1689 (EU AI Act). Sector-specific or national law may require' +
    ' longer retention periods.</p>',
  );
  parts.push('<table>');
  parts.push('<thead><tr><th>Field</th><th>Value</th></tr></thead>');
  parts.push('<tbody>');
  parts.push(`<tr><td>Report generated</td><td>${escapeHtml(generatedAt)}</td></tr>`);
  parts.push(`<tr><td>Minimum retention until</td><td>${escapeHtml(retentionUntil)}</td></tr>`);
  parts.push(`<tr><td>Issuing platform</td><td>${escapeHtml(resolved.issuer)}</td></tr>`);
  parts.push(`<tr><td>Applicable regulation</td><td>EU AI Act (Regulation (EU) 2024/1689), Art. 26(6)</td></tr>`);
  parts.push('</tbody>');
  parts.push('</table>');

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
  parts.push('<thead><tr><th>Component</th><th>Score</th><th>What this means</th></tr></thead>');
  parts.push('<tbody>');
  const tcScoreH = components['trace_completeness'] ?? 0;
  const piScoreH = components['provenance_integrity'] ?? 0;
  const ovScoreH = components['objective_verification'] ?? 0;
  const pcScoreH = components['policy_coverage'] ?? 0;
  const hoScoreH = components['human_oversight_evidence'] ?? 0;
  const crScoreH = components['contamination_risk_inverted'] ?? 0;
  const toolCallsH = events.filter((e) => e.type === 'tool_call').length;
  const policyDecisionsH = events.filter((e) => e.type === 'policy_decision').length;
  const verifierObsH = events.filter((e) => e.type === 'observation' && e.observation?.source?.startsWith('verifier:')).length;
  parts.push(`<tr><td>Trace Completeness</td><td>${tcScoreH}/100</td><td>Penalties for missing evidence_id or timestamp fields, and unpaired tool calls</td></tr>`);
  parts.push(`<tr><td>Provenance Integrity</td><td>${piScoreH}/100</td><td>Hash chain integrity and Ed25519 signature coverage across all events</td></tr>`);
  parts.push(`<tr><td>Objective Verification</td><td>${ovScoreH}/100</td><td>${verifierObsH} verifier result(s) against ${toolCallsH} tool call(s) — deterministic verifier coverage</td></tr>`);
  parts.push(`<tr><td>Policy Coverage</td><td>${pcScoreH}/100</td><td>${policyDecisionsH} policy decision(s) against ${toolCallsH} tool call(s) — ${toolCallsH > 0 ? Math.round((policyDecisionsH / toolCallsH) * 100) : 'N/A'}% coverage</td></tr>`);
  parts.push(`<tr><td>Human Oversight Evidence</td><td>${hoScoreH}/100</td><td>Human approval records for actions tagged high_risk or human_required</td></tr>`);
  parts.push(`<tr><td>Contamination Risk</td><td>${crScoreH}/100</td><td>Training/test data overlap risk (100 = no contamination detected)</td></tr>`);
  parts.push(
    `<tr><td><strong>Total EAS</strong></td><td><strong>${evidence_admission_score.score}/100 ` +
    `(Grade <span style="${gradeStyle}">${grade}</span>)</strong></td><td>Weighted average — 20% each for first three, 15% oversight + policy, 10% contamination</td></tr>`,
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

  // Compliance Framework Mapping (after Findings, before Limitations)
  for (const p of buildComplianceMappingHtml(complianceMappings)) {
    parts.push(p);
  }

  // Limitations
  parts.push('<h2>Limitations</h2>');
  parts.push('<ul>');
  parts.push('<li>This report covers only events present in the submitted trace. Behavior outside this trace is not evaluated.</li>');
  parts.push('<li>Regulatory framework mappings are interpretive and non-binding. See Disclaimer.</li>');
  parts.push('<li>Evidence integrity is verified only for events that include hash/signature fields.</li>');
  parts.push('<li>Tool capability declarations are taken at face value; manifest honesty is assumed.</li>');
  parts.push('</ul>');

  // Disclaimer
  parts.push('<h2>Disclaimer</h2>');
  parts.push(
    '<p><em>OpenAgentAudit produces technical evidence only. This report does not constitute legal advice or a determination of regulatory compliance.</em></p>',
  );

  // Official Seal + QR code
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(resolved.report_url)}`;
  const retentionUntilHtml = addSixMonths(generatedAt);
  parts.push('<div class="no-print" style="margin:32px 0;padding:20px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;display:flex;align-items:center;gap:24px">');
  parts.push(`<img src="${escapeHtml(qrUrl)}" alt="QR code to report URL" width="140" height="140" style="border:1px solid #d1d5db;border-radius:4px">`);
  parts.push('<div>');
  parts.push(`<div style="font-size:13px;color:#6b7280;margin-bottom:4px">Scan to access this report online</div>`);
  parts.push(`<div style="font-size:12px;font-family:monospace;color:#374151;margin-bottom:8px">${escapeHtml(resolved.report_url)}</div>`);
  parts.push(`<div style="font-size:11px;color:#9ca3af">Retained until ${retentionUntilHtml} · EU AI Act Art. 26(6)</div>`);
  parts.push(`<div style="font-size:11px;color:#9ca3af">Contact: <a href="mailto:${escapeHtml(resolved.issuer_email)}">${escapeHtml(resolved.issuer_email)}</a></div>`);
  parts.push('</div>');
  parts.push('</div>');

  // Official Seal (SVG) — print-friendly
  const sealSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <defs>
      <pattern id="bg-dots" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.7" fill="#4f46e5" opacity="0.08"/>
      </pattern>
    </defs>
    <circle cx="80" cy="80" r="76" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-dasharray="4 3"/>
    <circle cx="80" cy="80" r="68" fill="none" stroke="#4f46e5" stroke-width="1" opacity="0.4"/>
    <circle cx="80" cy="80" r="62" fill="url(#bg-dots)" opacity="0.5"/>
    <text x="80" y="52" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#4f46e5" letter-spacing="2" font-weight="bold">TRUSTAVO</text>
    <text x="80" y="64" text-anchor="middle" font-family="Georgia,serif" font-size="7" fill="#6b7280" letter-spacing="1">TRUSTAVO.COM</text>
    <text x="80" y="83" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#1e1b4b" font-weight="bold">AUDIT</text>
    <text x="80" y="96" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#1e1b4b" font-weight="bold">REPORT</text>
    <text x="80" y="114" text-anchor="middle" font-family="monospace" font-size="6.5" fill="#4f46e5">${escapeHtml(resolved.report_id)}</text>
    <text x="80" y="126" text-anchor="middle" font-family="Georgia,serif" font-size="7" fill="#6b7280">EU AI Act Art. 26(6)</text>
    <path d="M30,80 A50,50 0 0,1 130,80" fill="none" stroke="#4f46e5" stroke-width="0.8" opacity="0.3"/>
    <path d="M80,30 A50,50 0 0,1 80,130" fill="none" stroke="#4f46e5" stroke-width="0.8" opacity="0.3"/>
  </svg>`;

  parts.push('<div style="margin:20px 0;display:flex;justify-content:flex-end">');
  parts.push(sealSvg);
  parts.push('</div>');

  // Evidence Chain Status
  const chainEvs = events.filter((e) => e.evidence?.hash !== undefined || e.evidence?.prev_hash !== undefined);
  if (chainEvs.length > 0) {
    parts.push('<h2>Evidence Chain Status</h2>');
    parts.push('<table>');
    parts.push('<thead><tr><th>Event ID</th><th>Type</th><th>Has Signature</th><th>Chain Status</th></tr></thead>');
    parts.push('<tbody>');
    let prevHashHtml = '';
    for (let i = 0; i < chainEvs.length; i++) {
      const ev = chainEvs[i];
      if (ev === undefined) continue;
      const hasSig = ev.evidence?.signature !== undefined ? '✅' : '—';
      let chainStatus: string;
      let chainColor = '#16a34a';
      if (i === 0) {
        const isGenesis = ev.evidence?.prev_hash === '0'.repeat(64);
        chainStatus = isGenesis ? 'genesis' : '⚠️ non-standard genesis';
        chainColor = isGenesis ? '#2563eb' : '#d97706';
      } else {
        const ok = ev.evidence?.prev_hash === prevHashHtml;
        chainStatus = ok ? '✅ linked' : '❌ broken';
        chainColor = ok ? '#16a34a' : '#dc2626';
      }
      prevHashHtml = ev.evidence?.hash ?? '';
      parts.push(
        `<tr><td><code>${escapeHtml(decodeEventId(ev.event_id))}</code></td>` +
        `<td>${escapeHtml(ev.type)}</td>` +
        `<td>${hasSig}</td>` +
        `<td style="color:${chainColor};font-weight:500">${chainStatus}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
    const unsignedCnt = events.length - chainEvs.length;
    parts.push(`<p><em>${chainEvs.length} of ${events.length} events signed. ${unsignedCnt} unsigned.</em></p>`);
  }

  // Forensic Event Appendix
  const typeColorHtml: Record<string, string> = {
    tool_call: '#dbeafe',
    policy_decision: '#fef9c3',
    human_approval: '#dcfce7',
    error: '#fee2e2',
    observation: '#f3e8ff',
    model_output: '#e0e7ff',
    final_answer: '#ccfbf1',
  };
  parts.push('<h2>Forensic Event Appendix</h2>');
  parts.push(`<p><em>All ${events.length} events in the submitted trace. Generated by ${escapeHtml(resolved.issuer)} — ${escapeHtml(resolved.issuer_email)}</em></p>`);
  parts.push('<div style="overflow-x:auto">');
  parts.push('<table style="font-size:11px">');
  parts.push('<thead><tr><th>#</th><th>Event ID</th><th>Type</th><th>Actor</th><th>Timestamp</th><th>Details</th><th>Evidence ID</th></tr></thead>');
  parts.push('<tbody>');
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined) continue;
    const bg = typeColorHtml[ev.type] ?? '#f9fafb';
    const details = escapeHtml(buildEventDetails(ev));
    const evidenceId = ev.evidence?.evidence_id ?? '—';
    parts.push(
      `<tr style="background:${bg}">` +
      `<td>${i + 1}</td>` +
      `<td><code>${escapeHtml(decodeEventId(ev.event_id))}</code></td>` +
      `<td><span style="font-weight:500">${escapeHtml(ev.type)}</span></td>` +
      `<td>${escapeHtml(ev.actor)}</td>` +
      `<td style="font-family:monospace;font-size:10px">${escapeHtml(ev.timestamp)}</td>` +
      `<td>${details}</td>` +
      `<td><code>${escapeHtml(evidenceId)}</code></td>` +
      `</tr>`,
    );
  }
  parts.push('</tbody></table>');
  parts.push('</div>');

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
  compliance_mappings: ComplianceMapping[];
  inventory?: InventoryReport;
  event_count: number;
  meta?: ResolvedMeta;
}

function buildJson(
  events: CanonicalEvent[],
  findings: Finding[],
  score: RiskScore,
  inv: InventoryReport | undefined,
  generatedAt: string,
  resolved: ResolvedMeta,
  complianceMappings: ComplianceMapping[],
): string {
  const obj: JsonReport = {
    schema_version: 'open-agent-audit/v0.1',
    generated_at: generatedAt,
    run_id: score.run_id,
    risk_score: score,
    findings,
    compliance_mappings: complianceMappings,
    event_count: events.length,
    meta: resolved,
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
  meta?: ReportMeta,
): Promise<ReportBundle> {
  const generatedAt = new Date().toISOString();
  const resolved = resolveMeta(events, score, generatedAt, meta);
  const complianceMappings = buildComplianceMappings(events, findings);

  const markdown = buildMarkdown(events, findings, score, inventoryReport, generatedAt, resolved, complianceMappings);
  const html = buildHtml(events, findings, score, inventoryReport, generatedAt, resolved, complianceMappings);
  const json = buildJson(events, findings, score, inventoryReport, generatedAt, resolved, complianceMappings);
  const csv = buildCsv(events, findings);

  return { markdown, html, json, csv };
}
