/**
 * ComplianceEvalRecord adapter.
 *
 * Maps `@wasmagent/compliance` ComplianceEvalRecord payloads into
 * OpenAgentAudit CanonicalEvents.  No Node.js APIs are used; this module is
 * compatible with Cloudflare Workers / Web Crypto runtimes.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';
import type { SourceFormatAdapter } from './index.js';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface ComplianceEvalTask {
  task_id: string;
  task_description: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  passed: boolean;
  score?: number;
  evidence_refs?: string[];
  verifier_id?: string;
  evaluated_at: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface ComplianceEvalRecord {
  schema_version: 'compliance-eval-record/v0.1';
  run_id: string;
  agent_id: string;
  model_id?: string;
  created_at: string;
  tasks: ComplianceEvalTask[];
}

// ---------------------------------------------------------------------------
// Adapter id / version
// ---------------------------------------------------------------------------

export const id = 'compliance-eval-record-v0.1' as const;
export const version = '0.1.0' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RISK_RANK: Record<'low' | 'medium' | 'high' | 'critical', number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Return the highest risk_level across all tasks, or 'low' for an empty set. */
function maxRiskLevel(tasks: ComplianceEvalTask[]): 'low' | 'medium' | 'high' | 'critical' {
  let best: 'low' | 'medium' | 'high' | 'critical' = 'low';
  for (const task of tasks) {
    if (RISK_RANK[task.risk_level] > RISK_RANK[best]) {
      best = task.risk_level;
    }
  }
  return best;
}

/** Map a single ComplianceEvalTask to a CanonicalEvent. */
function taskToEvent(record: ComplianceEvalRecord, task: ComplianceEvalTask): CanonicalEvent {
  const base = {
    schema_version: SPEC_VERSION,
    run_id: record.run_id,
    agent_id: record.agent_id,
    model_id: record.model_id ?? 'compliance-eval',
    event_id: `${record.run_id}:${task.task_id}`,
    timestamp: task.evaluated_at,
  } as const;

  if (task.passed) {
    const ev: CanonicalEvent = {
      ...base,
      type: 'observation',
      actor: 'system',
      observation: {
        source: `verifier:${task.verifier_id ?? task.task_id}`,
        ...(task.score !== undefined ? { content_hash: task.score.toString() } : {}),
      },
    };
    return ev;
  }

  const ev: CanonicalEvent = {
    ...base,
    type: 'error',
    actor: 'system',
    error: {
      kind: 'compliance_failure',
      message: task.task_description,
    },
  };
  return ev;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

function toEvents(record: ComplianceEvalRecord): CanonicalEvent[] {
  return record.tasks.map((task) => taskToEvent(record, task));
}

function beginRun(record: ComplianceEvalRecord): AuditRun {
  return {
    schema_version: SPEC_VERSION,
    run_id: record.run_id,
    agent_id: record.agent_id,
    model_id: record.model_id ?? 'compliance-eval',
    created_at: record.created_at,
    task: {
      id: 'compliance-eval',
      description: 'Compliance evaluation run',
      risk_level: maxRiskLevel(record.tasks),
    },
    event_count: record.tasks.length,
    source_adapter: id,
  };
}

export const ComplianceEvalRecordAdapter: SourceFormatAdapter<ComplianceEvalRecord> = {
  id,
  version,
  beginRun,
  toEvents,
};
