import { describe, expect, it } from 'bun:test';
import type { RiskScore } from '@openagentaudit/schema';
import {
  alertContextFromScore,
  alertMessage,
  defaultSeverity,
  dispatchAlert,
  evaluateAlerts,
  formatEmailMessage,
  formatSlackPayload,
  formatWebhookPayload,
  parseAlertRules,
  parseAlertTargets,
  runAlerts,
} from './index.js';
import type {
  AlertChannel,
  AlertContext,
  AlertEvent,
  AlertRule,
  AlertTargets,
} from './index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function score(eas: number, ars: number, runId = 'run-x', grade = 'B'): RiskScore {
  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: runId,
    generated_at: '2026-07-28T00:00:00.000Z',
    evidence_admission_score: { score: eas, grade: grade as RiskScore['evidence_admission_score']['grade'] },
    agent_risk_score: { score: ars },
    components: {},
    contamination_evaluated: false,
  };
}

function context(runId = 'run-x'): AlertContext {
  return {
    run_id: runId,
    eas_score: 40,
    eas_grade: 'F',
    ars_score: 45,
    report_url: `https://example.test/r/${runId}`,
    issuer: 'Trustavo',
    generated_at: '2026-07-28T00:00:00.000Z',
  };
}

/** Realistic context derived from a score (mirrors worker usage via alertContextFromScore). */
function ctxFromScore(s: RiskScore): AlertContext {
  return alertContextFromScore(s, {
    report_url: `https://example.test/r/${s.run_id}`,
    issuer: 'Trustavo',
  });
}

interface MockFetch {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
}

/** Minimal fetch stub that records calls and returns a configurable response. */
function mockFetch(opts: { status?: number; shouldThrow?: boolean } = {}): MockFetch {
  const calls: MockFetch['calls'] = [];
  const status = opts.status ?? 200;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    if (opts.shouldThrow === true) {
      throw new Error('network down');
    }
    return new Response('ok', { status });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const TARGETS: AlertTargets = {
  slack: { webhook_url: 'https://hooks.slack.com/services/T/B/X' },
  webhook: { url: 'https://example.test/hook', headers: { 'X-Signature': 'sig' } },
  email: { endpoint: 'https://mail.example.test/send', to: ['sec@example.test'], from: 'alerts@example.test' },
};

/** Evaluate a single rule and return its (narrowed) fired alert. */
function oneAlert(rule: AlertRule, s: RiskScore, ctx: AlertContext): AlertEvent {
  const [alert] = evaluateAlerts([rule], s, ctx);
  if (alert === undefined) throw new Error('expected alert to fire');
  return alert;
}

// ---------------------------------------------------------------------------
// defaultSeverity
// ---------------------------------------------------------------------------

describe('defaultSeverity', () => {
  it('gap >= 30 → critical', () => {
    expect(defaultSeverity(20, 60)).toBe('critical');
  });
  it('gap >= 20 → high', () => {
    expect(defaultSeverity(30, 55)).toBe('high');
  });
  it('gap >= 10 → medium', () => {
    expect(defaultSeverity(40, 55)).toBe('medium');
  });
  it('gap < 10 → low', () => {
    expect(defaultSeverity(50, 55)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// evaluateAlerts
// ---------------------------------------------------------------------------

describe('evaluateAlerts', () => {
  it('fires an EAS alert when eas < threshold', () => {
    const rules: AlertRule[] = [
      { id: 'eas-floor', metric: 'eas', threshold: 60, channels: ['slack'] },
    ];
    const alerts = evaluateAlerts(rules, score(40, 90), context());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.rule_id).toBe('eas-floor');
    expect(alerts[0]?.metric).toBe('eas');
    expect(alerts[0]?.observed).toBe(40);
    expect(alerts[0]?.threshold).toBe(60);
    expect(alerts[0]?.channels).toEqual(['slack']);
  });

  it('fires an ARS alert when ars < threshold', () => {
    const rules: AlertRule[] = [
      { id: 'ars-floor', metric: 'ars', threshold: 60, channels: ['webhook'] },
    ];
    const alerts = evaluateAlerts(rules, score(95, 45), context());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.metric).toBe('ars');
    expect(alerts[0]?.observed).toBe(45);
  });

  it('does not fire when observed >= threshold (boundary is strict <)', () => {
    const rules: AlertRule[] = [
      { id: 'eas-floor', metric: 'eas', threshold: 60, channels: ['slack'] },
    ];
    // observed == threshold → no alert
    expect(evaluateAlerts(rules, score(60, 90), context())).toHaveLength(0);
    // observed > threshold → no alert
    expect(evaluateAlerts(rules, score(75, 90), context())).toHaveLength(0);
  });

  it('derives severity from the breach gap when none is pinned', () => {
    const rules: AlertRule[] = [
      { id: 'eas-floor', metric: 'eas', threshold: 80, channels: ['slack'] },
    ];
    const alerts = evaluateAlerts(rules, score(40, 90), context()); // gap 40
    expect(alerts[0]?.severity).toBe('critical');
  });

  it('respects an explicitly pinned severity', () => {
    const rules: AlertRule[] = [
      {
        id: 'eas-floor',
        metric: 'eas',
        threshold: 80,
        channels: ['slack'],
        severity: 'high',
      },
    ];
    const alerts = evaluateAlerts(rules, score(40, 90), context()); // gap 40, but pinned
    expect(alerts[0]?.severity).toBe('high');
  });

  it('skips disabled rules', () => {
    const rules: AlertRule[] = [
      { id: 'eas-floor', metric: 'eas', threshold: 60, channels: ['slack'], enabled: false },
    ];
    expect(evaluateAlerts(rules, score(10, 10), context())).toHaveLength(0);
  });

  it('skips rules with no channels', () => {
    const rules: AlertRule[] = [
      { id: 'eas-floor', metric: 'eas', threshold: 60, channels: [] },
    ];
    expect(evaluateAlerts(rules, score(10, 10), context())).toHaveLength(0);
  });

  it('preserves rule order and fires multiple alerts', () => {
    const rules: AlertRule[] = [
      { id: 'rule-a', metric: 'eas', threshold: 60, channels: ['slack'] },
      { id: 'rule-b', metric: 'ars', threshold: 60, channels: ['email'] },
    ];
    const alerts = evaluateAlerts(rules, score(40, 45), context());
    expect(alerts.map((a) => a.rule_id)).toEqual(['rule-a', 'rule-b']);
  });

  it('uses label when provided, else rule id', () => {
    const rules: AlertRule[] = [
      { id: 'r1', label: 'Production EAS floor', metric: 'eas', threshold: 60, channels: ['slack'] },
      { id: 'r2', metric: 'ars', threshold: 60, channels: ['slack'] },
    ];
    const alerts = evaluateAlerts(rules, score(40, 40), context());
    expect(alerts[0]?.label).toBe('Production EAS floor');
    expect(alerts[1]?.label).toBe('r2');
  });

  it('message mentions the metric, run, observed, and threshold', () => {
    const rule: AlertRule = { id: 'eas-floor', metric: 'eas', threshold: 60, channels: ['slack'] };
    const msg = alertMessage(rule, 40, context('abc'));
    expect(msg).toContain('Evidence Admission Score');
    expect(msg).toContain('run abc');
    expect(msg).toContain('40 < threshold 60');
  });

  it('stamps fired_at from context.generated_at', () => {
    const rules: AlertRule[] = [
      { id: 'eas-floor', metric: 'eas', threshold: 60, channels: ['slack'] },
    ];
    const alerts = evaluateAlerts(rules, score(40, 90), context());
    expect(alerts[0]?.fired_at).toBe('2026-07-28T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// alertContextFromScore
// ---------------------------------------------------------------------------

describe('alertContextFromScore', () => {
  it('maps score fields and optional extras', () => {
    const ctx = alertContextFromScore(score(50, 55, 'run-9', 'F'), {
      report_url: 'https://x/r/run-9',
      issuer: 'Acme',
    });
    expect(ctx.run_id).toBe('run-9');
    expect(ctx.eas_score).toBe(50);
    expect(ctx.eas_grade).toBe('F');
    expect(ctx.ars_score).toBe(55);
    expect(ctx.report_url).toBe('https://x/r/run-9');
    expect(ctx.issuer).toBe('Acme');
  });
  it('omits extras when not provided', () => {
    const ctx = alertContextFromScore(score(50, 55, 'run-9'));
    expect(ctx.report_url).toBeUndefined();
    expect(ctx.issuer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

describe('formatSlackPayload', () => {
  it('produces text containing label, run, and both scores', () => {
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['slack'] },
      score(40, 45),
      context('run-slack'),
    );
    const payload = formatSlackPayload(alert);
    expect(typeof payload.text).toBe('string');
    const text = payload.text as string;
    expect(text).toContain('run-slack');
    expect(text).toContain('40');
    expect(text).toContain('ARS');
    expect(text).toContain('https://example.test/r/run-slack');
  });
});

describe('formatWebhookPayload', () => {
  it('exposes event_type and nested alert + run', () => {
    const s = score(95, 30, 'run-hook');
    const alert = oneAlert({ id: 'r', metric: 'ars', threshold: 60, channels: ['webhook'] }, s, ctxFromScore(s));
    const payload = formatWebhookPayload(alert);
    expect(payload.event_type).toBe('open_agent_audit.alert');
    const alertPayload = payload.alert as Record<string, unknown>;
    const runPayload = payload.run as Record<string, unknown>;
    expect(alertPayload.metric).toBe('ars');
    expect(alertPayload.observed).toBe(30);
    expect(runPayload.run_id).toBe('run-hook');
    expect(runPayload.ars_score).toBe(30);
  });
});

describe('formatEmailMessage', () => {
  it('renders subject/from/to/body with breach details', () => {
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['email'] },
      score(40, 45),
      context('run-mail'),
    );
    const msg = formatEmailMessage(alert, {
      endpoint: 'https://mail.example.test/send',
      to: ['sec@example.test'],
      from: 'alerts@example.test',
    });
    expect(msg.from).toBe('alerts@example.test');
    expect(msg.to).toEqual(['sec@example.test']);
    expect(msg.content_type).toBe('text/plain');
    expect(msg.subject).toContain('risk threshold breached');
    expect(msg.body).toContain('run-mail');
    expect(msg.body).toContain('https://example.test/r/run-mail');
  });
  it('falls back to a default from when target.from is unset', () => {
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['email'] },
      score(40, 45),
      context(),
    );
    const msg = formatEmailMessage(alert, {
      endpoint: 'https://mail.example.test/send',
      to: ['sec@example.test'],
    });
    expect(msg.from).toBe('Trustavo'); // issuer fallback
  });
});

// ---------------------------------------------------------------------------
// dispatchAlert
// ---------------------------------------------------------------------------

describe('dispatchAlert', () => {
  it('POSTs a Slack payload to the webhook_url', async () => {
    const mock = mockFetch();
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['slack'] },
      score(40, 45),
      context(),
    );
    const [result] = await dispatchAlert(alert, TARGETS, { fetchImpl: mock.fetch });
    expect(result?.ok).toBe(true);
    expect(result?.channel).toBe('slack');
    expect(mock.calls[0]?.url).toBe('https://hooks.slack.com/services/T/B/X');
    const body = JSON.parse(String(mock.calls[0]?.init?.body)) as { text: string };
    expect(body.text).toContain('run-x');
  });

  it('POSTs a webhook payload with custom headers', async () => {
    const mock = mockFetch();
    const alert = oneAlert(
      { id: 'r', metric: 'ars', threshold: 60, channels: ['webhook'] },
      score(95, 30),
      context(),
    );
    const [result] = await dispatchAlert(alert, TARGETS, { fetchImpl: mock.fetch });
    expect(result?.ok).toBe(true);
    expect(result?.channel).toBe('webhook');
    expect(mock.calls[0]?.url).toBe('https://example.test/hook');
    const headers = mock.calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-Signature']).toBe('sig');
    expect(headers['content-type']).toBe('application/json');
  });

  it('POSTs an email message to the email endpoint', async () => {
    const mock = mockFetch();
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['email'] },
      score(40, 45),
      context(),
    );
    const [result] = await dispatchAlert(alert, TARGETS, { fetchImpl: mock.fetch });
    expect(result?.ok).toBe(true);
    expect(result?.channel).toBe('email');
    expect(mock.calls[0]?.url).toBe('https://mail.example.test/send');
    const body = JSON.parse(String(mock.calls[0]?.init?.body)) as { to: string[] };
    expect(body.to).toEqual(['sec@example.test']);
  });

  it('returns ok:false with an error when a channel has no target', async () => {
    const mock = mockFetch();
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['slack', 'webhook'] },
      score(40, 45),
      context(),
    );
    const results = await dispatchAlert(
      alert,
      { webhook: { url: 'https://example.test/hook', headers: { 'X-Signature': 'sig' } } },
      { fetchImpl: mock.fetch },
    );
    const slackResult = results.find((r) => r.channel === 'slack');
    expect(slackResult?.ok).toBe(false);
    expect(slackResult?.error).toContain('slack');
    const webhookResult = results.find((r) => r.channel === 'webhook');
    expect(webhookResult?.ok).toBe(true);
  });

  it('records a non-2xx HTTP status as ok:false', async () => {
    const mock = mockFetch({ status: 500 });
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['slack'] },
      score(40, 45),
      context(),
    );
    const [result] = await dispatchAlert(alert, TARGETS, { fetchImpl: mock.fetch });
    expect(result?.ok).toBe(false);
    expect(result?.status).toBe(500);
    expect(result?.error).toBe('HTTP 500');
  });

  it('captures a thrown fetch as ok:false without raising', async () => {
    const mock = mockFetch({ shouldThrow: true });
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['slack'] },
      score(40, 45),
      context(),
    );
    const [result] = await dispatchAlert(alert, TARGETS, { fetchImpl: mock.fetch });
    expect(result?.ok).toBe(false);
    expect(result?.error).toBe('network down');
  });

  it('delivers to every channel in order', async () => {
    const mock = mockFetch();
    const alert = oneAlert(
      { id: 'r', metric: 'eas', threshold: 60, channels: ['slack', 'webhook', 'email'] },
      score(40, 45),
      context(),
    );
    const results = await dispatchAlert(alert, TARGETS, { fetchImpl: mock.fetch });
    const channels: AlertChannel[] = results.map((r) => r.channel);
    expect(channels).toEqual(['slack', 'webhook', 'email']);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(mock.calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// runAlerts
// ---------------------------------------------------------------------------

describe('runAlerts', () => {
  it('returns no alerts and no dispatch when nothing breaches', async () => {
    const mock = mockFetch();
    const result = await runAlerts(
      [{ id: 'r', metric: 'eas', threshold: 30, channels: ['slack'] }],
      score(80, 90),
      context(),
      TARGETS,
      { fetchImpl: mock.fetch },
    );
    expect(result.alerts).toHaveLength(0);
    expect(result.dispatch).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('evaluates and dispatches when a breach occurs', async () => {
    const mock = mockFetch();
    const result = await runAlerts(
      [
        { id: 'eas', metric: 'eas', threshold: 60, channels: ['slack'] },
        { id: 'ars', metric: 'ars', threshold: 60, channels: ['webhook'] },
      ],
      score(40, 45),
      context(),
      TARGETS,
      { fetchImpl: mock.fetch },
    );
    expect(result.alerts).toHaveLength(2);
    expect(result.dispatch).toHaveLength(2);
    expect(mock.calls).toHaveLength(2);
    expect(result.dispatch.every((r) => r.ok)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Env-config parsing
// ---------------------------------------------------------------------------

describe('parseAlertRules', () => {
  it('returns [] for undefined / blank input', () => {
    expect(parseAlertRules(undefined)).toEqual([]);
    expect(parseAlertRules('   ')).toEqual([]);
  });
  it('parses a JSON array of rules', () => {
    const raw = JSON.stringify([
      { id: 'r1', metric: 'eas', threshold: 60, channels: ['slack'] },
    ]);
    const rules = parseAlertRules(raw);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('r1');
  });
  it('throws on malformed JSON', () => {
    expect(() => parseAlertRules('{not json')).toThrow();
  });
  it('throws on non-array JSON', () => {
    expect(() => parseAlertRules('{"id":"r1"}')).toThrow(/array/);
  });
});

describe('parseAlertTargets', () => {
  it('returns {} for undefined / blank input', () => {
    expect(parseAlertTargets(undefined)).toEqual({});
    expect(parseAlertTargets('')).toEqual({});
  });
  it('parses a JSON object of targets', () => {
    const raw = JSON.stringify({ slack: { webhook_url: 'https://hooks.slack.com/x' } });
    const targets = parseAlertTargets(raw);
    expect(targets.slack?.webhook_url).toBe('https://hooks.slack.com/x');
  });
  it('throws on malformed JSON', () => {
    expect(() => parseAlertTargets('{not json')).toThrow();
  });
  it('throws on non-object JSON', () => {
    expect(() => parseAlertTargets('["a"]')).toThrow(/object/);
  });
});
