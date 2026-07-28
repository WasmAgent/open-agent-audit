/** @openagentaudit/core/alerting — Threshold-breach alerting (Slack, webhooks, email). */
import type { RiskScore, Severity } from '@openagentaudit/schema';

/**
 * Which risk metric an {@link AlertRule} watches. Both the Evidence Admission
 * Score (EAS) and the Agent Risk Score (ARS) are 0–100 where a higher value is
 * better (i.e. lower risk); an alert fires when the observed value drops below
 * the rule's {@link AlertRule.threshold}.
 */
export type AlertMetric = 'eas' | 'ars';

/** Notification channels supported by the alerting engine. */
export type AlertChannel = 'slack' | 'webhook' | 'email';

/**
 * A threshold-breach alert rule (Milestone 6 — Continuous Monitoring &
 * Alerting). When the watched metric drops below `threshold`, an
 * {@link AlertEvent} is produced and dispatched to every channel in
 * `channels`.
 *
 * @example
 * ```ts
 * const rules: AlertRule[] = [
 *   { id: 'eas-floor', metric: 'eas', threshold: 60, channels: ['slack', 'email'] },
 *   { id: 'ars-floor', metric: 'ars', threshold: 50, channels: ['webhook'], severity: 'high' },
 * ];
 * ```
 */
export interface AlertRule {
  /** Stable identifier for the rule (used as the dedupe / alert key). */
  id: string;
  /** Which score to watch. */
  metric: AlertMetric;
  /** Floor value (0–100). Alert fires when observed < threshold. */
  threshold: number;
  /** Channels to notify when this rule fires. */
  channels: AlertChannel[];
  /** Severity stamped onto the alert. Derived from the breach gap when omitted. */
  severity?: Severity;
  /** Human-readable label shown in notifications. Defaults to the rule id. */
  label?: string;
  /** When false, the rule is skipped during evaluation. Defaults to true. */
  enabled?: boolean;
}

/** Run metadata threaded into every alert notification. */
export interface AlertContext {
  run_id: string;
  eas_score: number;
  eas_grade: string;
  ars_score: number;
  /** Link back to the full audit report. */
  report_url?: string;
  /** Deploying organisation name (used in email "From" / Slack footer). */
  issuer?: string;
  /** ISO timestamp the score was generated. */
  generated_at?: string;
}

/** A threshold breach that fired and is ready to dispatch. */
export interface AlertEvent {
  rule_id: string;
  label: string;
  metric: AlertMetric;
  threshold: number;
  observed: number;
  severity: Severity;
  channels: AlertChannel[];
  context: AlertContext;
  /** Single-line human-readable summary. */
  message: string;
  fired_at: string;
}

/** Slack incoming-webhook target. */
export interface SlackTarget {
  /** Slack incoming webhook URL (https://hooks.slack.com/services/...). */
  webhook_url: string;
  /** Optional channel override (e.g. "#security-alerts"). */
  channel?: string;
}

/** Generic JSON webhook target. */
export interface WebhookTarget {
  /** URL to POST the alert payload to. */
  url: string;
  /** Optional extra request headers (e.g. signing tokens). */
  headers?: Record<string, string>;
}

/**
 * Email target. Delivered via an HTTP email gateway (e.g. MailChannels / SES
 * API) to keep the engine Worker-compatible — there is no Node-only SMTP
 * dependency. The rendered {@link EmailMessage} is POSTed as JSON to
 * `endpoint`, which performs the actual delivery.
 */
export interface EmailTarget {
  /** HTTP endpoint that accepts the rendered email and performs delivery. */
  endpoint: string;
  to: string[];
  from?: string;
  subject?: string;
  /** Extra headers forwarded to the gateway. */
  headers?: Record<string, string>;
}

/** Per-channel delivery configuration. */
export interface AlertTargets {
  slack?: SlackTarget;
  webhook?: WebhookTarget;
  email?: EmailTarget;
}

/** Outcome of attempting to deliver one alert to one channel. */
export interface DispatchResult {
  channel: AlertChannel;
  ok: boolean;
  /** HTTP status code when a request completed. */
  status?: number;
  /** Error detail when `ok` is false. */
  error?: string;
}

/** Options for {@link dispatchAlert} / {@link runAlerts}. */
export interface DispatchOptions {
  /** Inject a fetch implementation (tests / non-Worker runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional abort signal forwarded to each delivery request. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Default severity for a breach when the rule does not pin one. Derived from
 * how far the observed value fell below the threshold: a larger gap ⇒ higher
 * severity. Returns one of low / medium / high / critical.
 */
export function defaultSeverity(observed: number, threshold: number): Severity {
  const gap = threshold - observed;
  if (gap >= 30) return 'critical';
  if (gap >= 20) return 'high';
  if (gap >= 10) return 'medium';
  return 'low';
}

function observedForMetric(score: RiskScore, metric: AlertMetric): number {
  return metric === 'eas'
    ? score.evidence_admission_score.score
    : score.agent_risk_score.score;
}

function metricLabel(metric: AlertMetric): string {
  return metric === 'eas' ? 'Evidence Admission Score' : 'Agent Risk Score';
}

/** Human-readable single-line summary of a breach. */
export function alertMessage(rule: AlertRule, observed: number, context: AlertContext): string {
  const tail = context.report_url !== undefined ? ` — ${context.report_url}` : '';
  return `${metricLabel(rule.metric)} breach on run ${context.run_id}: ${observed} < threshold ${rule.threshold}${tail}`;
}

/**
 * Evaluate alert rules against a computed {@link RiskScore} and return the
 * alerts that fired. Pure: no network side effects.
 *
 * A rule fires when its metric's observed value is strictly less than its
 * threshold. Rules with `enabled: false` or an empty `channels` list are
 * skipped.
 */
export function evaluateAlerts(
  rules: AlertRule[],
  score: RiskScore,
  context: AlertContext,
): AlertEvent[] {
  const events: AlertEvent[] = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.channels.length === 0) continue;
    const observed = observedForMetric(score, rule.metric);
    if (observed >= rule.threshold) continue;
    const severity = rule.severity ?? defaultSeverity(observed, rule.threshold);
    events.push({
      rule_id: rule.id,
      label: rule.label ?? rule.id,
      metric: rule.metric,
      threshold: rule.threshold,
      observed,
      severity,
      channels: [...rule.channels],
      context,
      message: alertMessage(rule, observed, context),
      fired_at: context.generated_at ?? new Date().toISOString(),
    });
  }
  return events;
}

/** Build an {@link AlertContext} from a {@link RiskScore} plus optional URL/issuer. */
export function alertContextFromScore(
  score: RiskScore,
  extra?: { report_url?: string; issuer?: string },
): AlertContext {
  const context: AlertContext = {
    run_id: score.run_id,
    eas_score: score.evidence_admission_score.score,
    eas_grade: score.evidence_admission_score.grade,
    ars_score: score.agent_risk_score.score,
    generated_at: score.generated_at,
  };
  if (extra?.report_url !== undefined) context.report_url = extra.report_url;
  if (extra?.issuer !== undefined) context.issuer = extra.issuer;
  return context;
}

// ---------------------------------------------------------------------------
// Channel formatters
// ---------------------------------------------------------------------------

function slackEmoji(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return '🚨';
    case 'high':
      return '🔴';
    case 'medium':
      return '🟠';
    case 'low':
      return '🟡';
    default:
      return 'ℹ️';
  }
}

/** Render a Slack incoming-webhook payload ({ text, blocks }). */
export function formatSlackPayload(alert: AlertEvent): Record<string, unknown> {
  const lines: string[] = [
    `${slackEmoji(alert.severity)} *${alert.label}* — ${alert.severity.toUpperCase()}`,
    alert.message,
    '',
    `*EAS:* ${alert.context.eas_score} (${alert.context.eas_grade})  *ARS:* ${alert.context.ars_score}`,
    `*Run:* ${alert.context.run_id}`,
  ];
  if (alert.context.report_url !== undefined) {
    lines.push(`*Report:* ${alert.context.report_url}`);
  }
  return { text: lines.join('\n') };
}

/** Render a generic JSON webhook payload ({ event_type, alert, run }). */
export function formatWebhookPayload(alert: AlertEvent): Record<string, unknown> {
  return {
    event_type: 'open_agent_audit.alert',
    fired_at: alert.fired_at,
    alert: {
      rule_id: alert.rule_id,
      label: alert.label,
      metric: alert.metric,
      severity: alert.severity,
      threshold: alert.threshold,
      observed: alert.observed,
      message: alert.message,
    },
    run: {
      run_id: alert.context.run_id,
      eas_score: alert.context.eas_score,
      eas_grade: alert.context.eas_grade,
      ars_score: alert.context.ars_score,
      report_url: alert.context.report_url,
    },
  };
}

/** Rendered email message ready to POST to an HTTP email gateway. */
export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  content_type: 'text/plain';
  body: string;
}

/** Render a plain-text email message for an HTTP email gateway. */
export function formatEmailMessage(alert: AlertEvent, target: EmailTarget): EmailMessage {
  const subject =
    target.subject ??
    `[${alert.severity.toUpperCase()}] ${alert.label} — risk threshold breached`;
  const bodyLines: string[] = [
    alert.message,
    '',
    `Severity: ${alert.severity}`,
    `Metric: ${alert.metric.toUpperCase()} (observed ${alert.observed}, threshold ${alert.threshold})`,
    `EAS: ${alert.context.eas_score} (${alert.context.eas_grade})`,
    `ARS: ${alert.context.ars_score}`,
    `Run: ${alert.context.run_id}`,
  ];
  if (alert.context.report_url !== undefined) {
    bodyLines.push(`Report: ${alert.context.report_url}`);
  }
  bodyLines.push('', `— ${alert.context.issuer ?? 'Open Agent Audit'}`);
  return {
    from: target.from ?? alert.context.issuer ?? 'alerts@open-agent-audit.dev',
    to: [...target.to],
    subject,
    content_type: 'text/plain',
    body: bodyLines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  channel: AlertChannel,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
): Promise<DispatchResult> {
  const headersOut: Record<string, string> = { 'content-type': 'application/json' };
  if (headers !== undefined) {
    for (const [key, value] of Object.entries(headers)) {
      headersOut[key] = value;
    }
  }
  const requestInit: RequestInit = {
    method: 'POST',
    headers: headersOut,
    body: JSON.stringify(body),
  };
  if (signal !== undefined) requestInit.signal = signal;
  try {
    const response = await fetchImpl(url, requestInit);
    if (!response.ok) {
      return {
        channel,
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
    }
    return { channel, ok: true, status: response.status };
  } catch (err) {
    return {
      channel,
      ok: false,
      error: err instanceof Error ? err.message : 'dispatch failed',
    };
  }
}

async function dispatchChannel(
  channel: AlertChannel,
  alert: AlertEvent,
  targets: AlertTargets,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<DispatchResult> {
  if (channel === 'slack') {
    const target = targets.slack;
    if (target === undefined) {
      return { channel, ok: false, error: 'no slack target configured' };
    }
    return postJson(fetchImpl, target.webhook_url, formatSlackPayload(alert), channel, undefined, signal);
  }
  if (channel === 'webhook') {
    const target = targets.webhook;
    if (target === undefined) {
      return { channel, ok: false, error: 'no webhook target configured' };
    }
    return postJson(fetchImpl, target.url, formatWebhookPayload(alert), channel, target.headers, signal);
  }
  const target = targets.email;
  if (target === undefined) {
    return { channel, ok: false, error: 'no email target configured' };
  }
  return postJson(fetchImpl, target.endpoint, formatEmailMessage(alert, target), channel, target.headers, signal);
}

/**
 * Deliver one {@link AlertEvent} to every channel it targets. Returns one
 * {@link DispatchResult} per channel (preserving order). Delivery is
 * best-effort: a failed channel never raises — the failure is captured in the
 * result so the caller can log/metric it without aborting the audit.
 */
export async function dispatchAlert(
  alert: AlertEvent,
  targets: AlertTargets,
  opts: DispatchOptions = {},
): Promise<DispatchResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const results: DispatchResult[] = [];
  for (const channel of alert.channels) {
    results.push(await dispatchChannel(channel, alert, targets, fetchImpl, opts.signal));
  }
  return results;
}

/** Result of {@link runAlerts}: the alerts that fired and their delivery outcomes. */
export interface AlertRunResult {
  alerts: AlertEvent[];
  dispatch: DispatchResult[];
}

/**
 * Evaluate the rules against `score` and, for every breach, dispatch
 * notifications to `targets`. Convenience wrapper over
 * {@link evaluateAlerts} + {@link dispatchAlert}.
 */
export async function runAlerts(
  rules: AlertRule[],
  score: RiskScore,
  context: AlertContext,
  targets: AlertTargets,
  opts: DispatchOptions = {},
): Promise<AlertRunResult> {
  const alerts = evaluateAlerts(rules, score, context);
  if (alerts.length === 0) {
    return { alerts, dispatch: [] };
  }
  const dispatch = (
    await Promise.all(alerts.map((alert) => dispatchAlert(alert, targets, opts)))
  ).flat();
  return { alerts, dispatch };
}

// ---------------------------------------------------------------------------
// Suppression gate — rate limiting + de-duplication (Milestone 6 #209)
// ---------------------------------------------------------------------------

/**
 * Configuration for the alert suppression gate. Prevents notification fatigue
 * from batch findings and repeated breaches via two independent mechanisms:
 *
 *  - **De-duplication.** When `dedupe_window_ms` is set, an alert for a rule is
 *    suppressed if that same rule already produced a notification within the
 *    window. A batch of findings that all trip the same floor therefore
 *    collapses to a single notification.
 *  - **Rate limiting.** When `max_per_window` is set, at most that many
 *    notifications are delivered within each `rate_window_ms` window; further
 *    alerts are suppressed until the window rolls over.
 *
 * Both mechanisms are optional. A config of `{}` (the default) passes every
 * event through unchanged.
 */
export interface AlertGateConfig {
  /**
   * Length (ms) of the de-duplication window. A rule that fired within the last
   * `dedupe_window_ms` is suppressed. `0` / omitted disables de-duplication.
   */
  dedupe_window_ms?: number;
  /**
   * Hard cap on notifications delivered per {@link AlertGateConfig.rate_window_ms}.
   * `0` / omitted disables the rate cap.
   */
  max_per_window?: number;
  /**
   * Length (ms) of the rate-limit window. Defaults to 60_000 (one minute) when
   * `max_per_window` is set and this is omitted.
   */
  rate_window_ms?: number;
}

/**
 * Mutable suppression state persisted across runs (e.g. by an
 * `AlertGatekeeper` Durable Object) so de-duplication and rate limiting survive
 * across consecutive audits. A fresh state (see {@link emptyAlertGateState})
 * suppresses nothing on the first run.
 */
export interface AlertGateState {
  /** rule_id → epoch-ms that rule was last allowed through. */
  last_fired: Record<string, number>;
  /** Epoch-ms the current rate-limit window started. */
  window_start: number;
  /** Notifications delivered in the current window. */
  window_count: number;
}

/** Why a single {@link AlertEvent} was suppressed by {@link gateAlerts}. */
export type SuppressReason = 'dedupe' | 'rate-limit';

/** An {@link AlertEvent} that the gate held back, and why. */
export interface SuppressedAlert {
  alert: AlertEvent;
  reason: SuppressReason;
}

/** Outcome of {@link gateAlerts}: which events may notify, and updated state. */
export interface AlertGateResult {
  /** Events that passed both the de-duplication and rate-limit checks. */
  allowed: AlertEvent[];
  /** Events held back, with the reason. */
  suppressed: SuppressedAlert[];
  /** Updated state — persist this so the next call sees the new window/keys. */
  state: AlertGateState;
}

/**
 * The de-duplication key for an alert. The rule id is the stable identity, so
 * repeated breaches of the same rule (including a batch of findings that all
 * trip it) share one key and collapse to a single notification per window.
 */
export function alertDedupeKey(alert: AlertEvent): string {
  return alert.rule_id;
}

/**
 * Build a fresh, empty {@link AlertGateState} seeded at `now` (epoch-ms, default
 * `Date.now()`). Used when no prior state exists yet.
 */
export function emptyAlertGateState(now: number = Date.now()): AlertGateState {
  return { last_fired: {}, window_start: now, window_count: 0 };
}

function resolveGateConfig(config: AlertGateConfig): {
  dedupeMs: number;
  maxPerWindow: number;
  rateMs: number;
} {
  return {
    dedupeMs: config.dedupe_window_ms ?? 0,
    maxPerWindow: config.max_per_window ?? 0,
    rateMs: config.rate_window_ms ?? 60_000,
  };
}

/**
 * Apply rate-limiting and de-duplication to a batch of fired alerts. Pure:
 * given the prior persisted {@link AlertGateState} and the current epoch time
 * `now`, returns the events that may be notified plus an updated state to
 * persist — so an `AlertGatekeeper` Durable Object can hold the gate state
 * across consecutive audit runs.
 *
 * Events are processed in input order: the first breach of each rule within the
 * de-duplication window passes, and the overall rate cap bounds the total. A
 * config of `{}` passes everything through (legacy behaviour).
 *
 * @example
 * ```ts
 * const result = gateAlerts(events, state, { dedupe_window_ms: 300_000, max_per_window: 5 }, Date.now());
 * for (const alert of result.allowed) await dispatchAlert(alert, targets);
 * persist(result.state);
 * ```
 */
export function gateAlerts(
  events: AlertEvent[],
  state: AlertGateState | undefined,
  config: AlertGateConfig,
  now: number,
): AlertGateResult {
  const { dedupeMs, maxPerWindow, rateMs } = resolveGateConfig(config);
  const next: AlertGateState =
    state === undefined
      ? emptyAlertGateState(now)
      : {
          last_fired: { ...state.last_fired },
          window_start: state.window_start,
          window_count: state.window_count,
        };

  // Roll over the rate-limit window when it has elapsed.
  if (maxPerWindow > 0 && now - next.window_start >= rateMs) {
    next.window_start = now;
    next.window_count = 0;
  }

  const allowed: AlertEvent[] = [];
  const suppressed: SuppressedAlert[] = [];

  for (const event of events) {
    const key = alertDedupeKey(event);
    const last = next.last_fired[key];
    if (dedupeMs > 0 && last !== undefined && now - last < dedupeMs) {
      suppressed.push({ alert: event, reason: 'dedupe' });
      continue;
    }
    if (maxPerWindow > 0 && next.window_count >= maxPerWindow) {
      suppressed.push({ alert: event, reason: 'rate-limit' });
      continue;
    }
    // Only track last-firings when de-duplication is active, so disabled gates
    // never accumulate unbounded keys.
    if (dedupeMs > 0) {
      next.last_fired[key] = now;
    }
    next.window_count += 1;
    allowed.push(event);
  }

  return { allowed, suppressed, state: next };
}

/**
 * Parse a JSON-encoded {@link AlertGateConfig} (e.g. the Worker `ALERT_GATE`
 * env var). Returns `{}` (gate disabled) when the value is absent or blank.
 * Throws on malformed JSON or a non-object value so misconfiguration is
 * surfaced rather than silently disabling suppression.
 */
export function parseAlertGate(raw: string | undefined): AlertGateConfig {
  if (raw === undefined || raw.trim() === '') return {};
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ALERT_GATE must be a JSON object of AlertGateConfig');
  }
  return parsed as AlertGateConfig;
}

// ---------------------------------------------------------------------------
// Env-config parsing (Worker-friendly)
// ---------------------------------------------------------------------------

/**
 * Parse a JSON-encoded array of {@link AlertRule} (e.g. the Worker `ALERT_RULES`
 * env var). Returns `[]` when the value is absent or blank. Throws on malformed
 * JSON or a non-array so misconfiguration is surfaced rather than silently
 * disabling alerting.
 */
export function parseAlertRules(raw: string | undefined): AlertRule[] {
  if (raw === undefined || raw.trim() === '') return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('ALERT_RULES must be a JSON array of AlertRule');
  }
  return parsed as AlertRule[];
}

/**
 * Parse a JSON-encoded {@link AlertTargets} object (e.g. the Worker
 * `ALERT_TARGETS` env var). Returns `{}` when the value is absent or blank.
 * Throws on malformed JSON or a non-object value.
 */
export function parseAlertTargets(raw: string | undefined): AlertTargets {
  if (raw === undefined || raw.trim() === '') return {};
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ALERT_TARGETS must be a JSON object of AlertTargets');
  }
  return parsed as AlertTargets;
}
