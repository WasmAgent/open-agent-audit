import { describe, it, expect } from 'bun:test';
import { ComplianceEvalRecordAdapter } from './compliance-eval-record.js';
import type { ComplianceEvalRecord } from './compliance-eval-record.js';

const BASE_RECORD: ComplianceEvalRecord = {
  schema_version: 'compliance-eval-record/v0.1',
  run_id: 'run-abc-123',
  agent_id: 'test-agent',
  model_id: 'gpt-4o',
  created_at: '2025-01-01T00:00:00.000Z',
  tasks: [],
};

describe('ComplianceEvalRecordAdapter', () => {
  it('passed task maps to observation event with verifier source', () => {
    const record: ComplianceEvalRecord = {
      ...BASE_RECORD,
      tasks: [
        {
          task_id: 'task-1',
          task_description: 'Check data retention policy',
          risk_level: 'low',
          passed: true,
          score: 0.95,
          verifier_id: 'verifier-policy',
          evaluated_at: '2025-01-01T01:00:00.000Z',
        },
      ],
    };

    const events = ComplianceEvalRecordAdapter.toEvents(record);
    expect(events).toHaveLength(1);

    const ev = events[0]!;
    expect(ev.type).toBe('observation');
    expect(ev.actor).toBe('system');
    expect(ev.observation?.source).toBe('verifier:verifier-policy');
    expect(ev.observation?.content_hash).toBe('0.95');
    expect(ev.event_id).toBe('run-abc-123:task-1');
    expect(ev.timestamp).toBe('2025-01-01T01:00:00.000Z');
  });

  it('passed task without verifier_id falls back to task_id in source', () => {
    const record: ComplianceEvalRecord = {
      ...BASE_RECORD,
      tasks: [
        {
          task_id: 'task-fallback',
          task_description: 'Check logs',
          risk_level: 'low',
          passed: true,
          evaluated_at: '2025-01-01T02:00:00.000Z',
        },
      ],
    };

    const events = ComplianceEvalRecordAdapter.toEvents(record);
    expect(events[0]?.observation?.source).toBe('verifier:task-fallback');
  });

  it('failed task maps to error event with kind compliance_failure', () => {
    const record: ComplianceEvalRecord = {
      ...BASE_RECORD,
      tasks: [
        {
          task_id: 'task-2',
          task_description: 'PII redaction must be applied before storage',
          risk_level: 'high',
          passed: false,
          evaluated_at: '2025-01-01T03:00:00.000Z',
        },
      ],
    };

    const events = ComplianceEvalRecordAdapter.toEvents(record);
    expect(events).toHaveLength(1);

    const ev = events[0]!;
    expect(ev.type).toBe('error');
    expect(ev.actor).toBe('system');
    expect(ev.error?.kind).toBe('compliance_failure');
    expect(ev.error?.message).toBe('PII redaction must be applied before storage');
    expect(ev.event_id).toBe('run-abc-123:task-2');
  });

  it('run_id and agent_id are set correctly on every event', () => {
    const record: ComplianceEvalRecord = {
      ...BASE_RECORD,
      run_id: 'my-run-id',
      agent_id: 'my-agent',
      tasks: [
        {
          task_id: 't1',
          task_description: 'desc',
          risk_level: 'low',
          passed: true,
          evaluated_at: '2025-01-01T00:00:00.000Z',
        },
        {
          task_id: 't2',
          task_description: 'desc2',
          risk_level: 'medium',
          passed: false,
          evaluated_at: '2025-01-01T00:01:00.000Z',
        },
      ],
    };

    const events = ComplianceEvalRecordAdapter.toEvents(record);
    for (const ev of events) {
      expect(ev.run_id).toBe('my-run-id');
      expect(ev.agent_id).toBe('my-agent');
    }
  });

  it('empty tasks array returns empty events array', () => {
    const events = ComplianceEvalRecordAdapter.toEvents(BASE_RECORD);
    expect(events).toHaveLength(0);
  });

  it('beginRun returns correct event_count', () => {
    const record: ComplianceEvalRecord = {
      ...BASE_RECORD,
      tasks: [
        {
          task_id: 'a',
          task_description: 'check a',
          risk_level: 'low',
          passed: true,
          evaluated_at: '2025-01-01T00:00:00.000Z',
        },
        {
          task_id: 'b',
          task_description: 'check b',
          risk_level: 'critical',
          passed: false,
          evaluated_at: '2025-01-01T00:01:00.000Z',
        },
      ],
    };

    const run = ComplianceEvalRecordAdapter.beginRun(record);
    expect(run.event_count).toBe(2);
    expect(run.run_id).toBe('run-abc-123');
    expect(run.agent_id).toBe('test-agent');
    expect(run.model_id).toBe('gpt-4o');
    expect(run.task.id).toBe('compliance-eval');
    expect(run.task.description).toBe('Compliance evaluation run');
    expect(run.task.risk_level).toBe('critical');
    expect(run.source_adapter).toBe('compliance-eval-record-v0.1');
  });

  it('beginRun with empty tasks has risk_level low and event_count 0', () => {
    const run = ComplianceEvalRecordAdapter.beginRun(BASE_RECORD);
    expect(run.event_count).toBe(0);
    expect(run.task.risk_level).toBe('low');
  });

  it('model_id defaults to compliance-eval when absent', () => {
    const record: ComplianceEvalRecord = {
      ...BASE_RECORD,
      model_id: undefined,
      tasks: [
        {
          task_id: 'x',
          task_description: 'check x',
          risk_level: 'low',
          passed: true,
          evaluated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    };

    const events = ComplianceEvalRecordAdapter.toEvents(record);
    expect(events[0]?.model_id).toBe('compliance-eval');

    const run = ComplianceEvalRecordAdapter.beginRun(record);
    expect(run.model_id).toBe('compliance-eval');
  });
});
