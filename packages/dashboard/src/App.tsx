import { useState, useCallback, useEffect } from 'react'
import { Router, Route, Switch, useLocation, useParams } from 'wouter'
import { AuditProvider, useAudit } from './AuditContext'
import { Breadcrumb, type Crumb } from './Breadcrumb'
import { parseJsonl, isAepJson, buildAepMeta } from './utils'

// ---------- Site config ----------

interface SiteConfig {
  site_name: string
  site_tagline: string
  powered_by: string
}

const DEFAULT_CONFIG: SiteConfig = {
  site_name: 'Trustavo',
  site_tagline: 'Evidence-grade audit for enterprise AI agents',
  powered_by: 'OpenAgentAudit',
}

// ---------- Types ----------

interface RawEvent {
  schema_version?: string
  run_id?: string
  event_id?: string
  agent_id?: string
  model_id?: string
  timestamp?: string
  type?: string
  actor?: string
  tool?: { name?: string; capability?: string; risk_tags?: string[] }
  policy?: { decision?: string; reason?: string; rule_id?: string }
  error?: { kind?: string; message?: string }
  human?: { reviewer_id?: string; decision?: string; justification?: string }
  observation?: { source?: string; byte_size?: number; content_hash?: string }
  model_output?: { token_count?: number; finish_reason?: string; content_hash?: string }
}

const PAGE_SIZE = 50

// ---------- Helper functions ----------

interface TypeStyle {
  chip: string
  dot: string
}

function typeStyle(type: string | undefined): TypeStyle {
  switch (type) {
    case 'tool_call':
      return {
        chip: 'bg-blue-50 text-blue-700 border border-blue-200',
        dot: 'bg-blue-500',
      }
    case 'policy_decision':
      return {
        chip: 'bg-amber-50 text-amber-700 border border-amber-200',
        dot: 'bg-amber-500',
      }
    case 'human_approval':
      return {
        chip: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        dot: 'bg-emerald-500',
      }
    case 'error':
      return {
        chip: 'bg-red-50 text-red-700 border border-red-200',
        dot: 'bg-red-500',
      }
    case 'observation':
      return {
        chip: 'bg-purple-50 text-purple-700 border border-purple-200',
        dot: 'bg-purple-500',
      }
    case 'model_output':
      return {
        chip: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
        dot: 'bg-indigo-500',
      }
    case 'final_answer':
      return {
        chip: 'bg-teal-50 text-teal-700 border border-teal-200',
        dot: 'bg-teal-500',
      }
    default:
      return {
        chip: 'bg-slate-50 text-slate-600 border border-slate-200',
        dot: 'bg-slate-400',
      }
  }
}

function eventDetails(ev: RawEvent): string {
  if (ev.tool?.name) {
    const cap = ev.tool.capability ? ` (${ev.tool.capability})` : ''
    const tags =
      ev.tool.risk_tags && ev.tool.risk_tags.length > 0
        ? ` [${ev.tool.risk_tags.join(', ')}]`
        : ''
    return `tool: ${ev.tool.name}${cap}${tags}`
  }
  if (ev.policy?.decision) {
    return `${ev.policy.decision}${ev.policy.reason ? ` — ${ev.policy.reason}` : ''}`
  }
  if (ev.human?.decision) {
    return `${ev.human.decision} — ${ev.human.reviewer_id ?? 'unknown reviewer'}${
      ev.human.justification ? ` · "${ev.human.justification}"` : ''
    }`
  }
  if (ev.error?.kind) {
    return `${ev.error.kind}${ev.error.message ? `: ${ev.error.message}` : ''}`
  }
  if (ev.observation?.source) {
    const size =
      ev.observation.byte_size != null ? ` · ${ev.observation.byte_size}B` : ''
    return `source: ${ev.observation.source}${size}`
  }
  if (ev.model_output) {
    const parts: string[] = []
    if (ev.model_output.finish_reason)
      parts.push(`finish: ${ev.model_output.finish_reason}`)
    if (ev.model_output.token_count != null)
      parts.push(`${ev.model_output.token_count} tokens`)
    if (parts.length > 0) return parts.join(' · ')
  }
  return '—'
}

function countByType(events: RawEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const ev of events) {
    const t = ev.type ?? 'unknown'
    counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

// ---------- Sub-components ----------

function TypeBadge({ type }: { type: string | undefined }) {
  const s = typeStyle(type)
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.chip}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {type ?? 'unknown'}
    </span>
  )
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
        {label}
      </div>
      <div className="text-3xl font-bold text-slate-900 truncate">{value}</div>
    </div>
  )
}

// Shield / checkmark logo mark SVG
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M16 3L5 7.5V15c0 6.075 4.697 11.745 11 13 6.303-1.255 11-6.925 11-13V7.5L16 3Z"
        fill="currentColor"
        opacity="0.15"
      />
      <path
        d="M16 3L5 7.5V15c0 6.075 4.697 11.745 11 13 6.303-1.255 11-6.925 11-13V7.5L16 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M11 16l3.5 3.5L21 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Upload cloud icon
function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
      />
    </svg>
  )
}

// Document icon
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )
}

// Spinner
function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ''}`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8z"
      />
    </svg>
  )
}

// Check circle icon
function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

// Warning icon
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  )
}

// ---------- Page components ----------

function HomePage() {
  const [, navigate] = useLocation()
  const {
    events,
    setEvents,
    fileName,
    setFileName,
    setFileText,
    parseError,
    setParseError,
    isAepRecord,
    setIsAepRecord,
    setAepMeta,
    setReportSummary,
    setReportRunId,
    setReportError,
  } = useAudit()

  const [dragging, setDragging] = useState(false)
  const hasEvents = events.length > 0

  // If data already loaded (e.g. back navigation), redirect to /audit
  useEffect(() => {
    if (hasEvents || isAepRecord) {
      navigate('/audit')
    }
  }, [hasEvents, isAepRecord, navigate])

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.jsonl') && !file.name.endsWith('.json')) {
        setParseError('Please select a .jsonl or .json file.')
        return
      }
      setParseError(null)
      setFileName(file.name)
      setIsAepRecord(false)
      setAepMeta(null)
      setReportSummary(null)
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        setFileText(text)
        setReportRunId(null)
        setReportError(null)
        if (isAepJson(text)) {
          setIsAepRecord(true)
          setEvents([])
          try {
            const aep = JSON.parse(text) as Record<string, unknown>
            setAepMeta(buildAepMeta(aep))
          } catch { /* best-effort */ }
          navigate('/audit')
          return
        }
        const parsed = parseJsonl(text)
        setEvents(parsed)
        if (parsed.length === 0) {
          setParseError('No valid JSON lines found in the file.')
        } else {
          navigate('/audit')
        }
      }
      reader.onerror = () => setParseError('Failed to read file.')
      reader.readAsText(file)
    },
    [setEvents, setFileName, setFileText, setParseError, setIsAepRecord, setAepMeta, setReportSummary, setReportRunId, setReportError, navigate],
  )

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
  }

  const onDragLeave = () => setDragging(false)

  const loadSample = async (file: string) => {
    const url = `https://raw.githubusercontent.com/WasmAgent/open-agent-audit/main/examples/traces/${file}`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      setParseError(null)
      setFileName(file)
      setIsAepRecord(false)
      setAepMeta(null)
      setReportSummary(null)
      setFileText(text)
      setReportRunId(null)
      setReportError(null)
      if (isAepJson(text)) {
        setIsAepRecord(true)
        setEvents([])
        try {
          const aep = JSON.parse(text) as Record<string, unknown>
          setAepMeta(buildAepMeta(aep))
        } catch { /* best-effort */ }
        navigate('/audit')
      } else {
        const parsed = parseJsonl(text)
        setEvents(parsed)
        if (parsed.length === 0) {
          setParseError('No valid JSON lines found in the file.')
        } else {
          navigate('/audit')
        }
      }
    } catch (e) {
      setParseError(`Failed to load sample: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const samples = [
    { label: 'wasmagent-js (Example)', file: 'wasmagent-js-runtime.aep.json' },
    { label: 'bscode (Example)', file: 'bscode-session.aep.json' },
  ]

  return (
    <div className="space-y-10">
      {/* Upload section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
            <UploadIcon className="w-4 h-4 text-indigo-600" />
          </div>
          <h2 className="text-base font-semibold text-slate-800">Upload Audit Trace</h2>
        </div>

        {/* Drop zone */}
        <div
          className={[
            'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200',
            dragging
              ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
              : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50/60',
          ].join(' ')}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <div className="flex flex-col items-center gap-4">
            <UploadIcon
              className={[
                'w-12 h-12 transition-all duration-300',
                dragging ? 'text-indigo-500 animate-pulse' : 'text-slate-300',
              ].join(' ')}
            />
            <div>
              <p className="text-slate-700 font-medium text-sm sm:text-base">
                {fileName ? (
                  <span className="text-indigo-600 font-semibold">{fileName}</span>
                ) : (
                  <>Drop a{' '}
                    <span className="font-mono text-slate-500">.jsonl</span>
                    {' '}file here, or click to select</>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                JSONL format — one CanonicalEvent per line
              </p>
            </div>
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white text-sm font-semibold shadow-sm hover:from-indigo-600 hover:to-indigo-700 active:scale-95 transition-all duration-150">
                <UploadIcon className="w-4 h-4" />
                Choose file
              </span>
              <input
                type="file"
                accept=".jsonl,.json"
                className="sr-only"
                onChange={onInputChange}
              />
            </label>
          </div>
        </div>

        {/* Sample traces */}
        {!fileName && (
          <div className="mt-3 text-center">
            <p className="text-xs text-slate-400 mb-2">No file yet? Try an example:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {samples.map(({ label, file }) => (
                <button
                  key={file}
                  onClick={() => void loadSample(file)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Parse error */}
        {parseError && (
          <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}
      </section>

      {/* Hero */}
      <section className="pt-6 pb-2 flex flex-col items-center text-center gap-5">
        <div className="w-20 h-20 rounded-3xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <ShieldIcon className="w-10 h-10 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            AI Agent Audit &amp; Compliance Platform
          </h2>
          <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
            Upload a JSONL audit trace to inspect agent events, score evidence
            quality, and generate audit reports accepted under{' '}
            <strong className="text-slate-700">EU AI Act Art.&nbsp;26(6)</strong>.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { dot: 'bg-blue-500', label: 'Tool call tracing' },
            { dot: 'bg-amber-500', label: 'Policy decisions' },
            { dot: 'bg-emerald-500', label: 'Human approvals' },
            { dot: 'bg-indigo-500', label: 'Model outputs' },
            { dot: 'bg-red-500', label: 'Error capture' },
          ].map((f) => (
            <span
              key={f.label}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs text-slate-600 shadow-sm"
            >
              <span className={`w-2 h-2 rounded-full ${f.dot}`} />
              {f.label}
            </span>
          ))}
        </div>
      </section>

      {/* How to use */}
      <section aria-labelledby="howto-heading">
        <h2
          id="howto-heading"
          className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2"
        >
          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center">?</span>
          How to use
        </h2>
        <ol className="grid sm:grid-cols-3 gap-4 list-none">
          {[
            {
              step: '1',
              title: 'Generate a trace',
              body: 'Instrument your AI agent with the OpenAgentAudit SDK or any compatible adapter (AEP v0.2, bscode). Each agent action is logged as a CanonicalEvent.',
              color: 'bg-blue-50 border-blue-100 text-blue-600',
            },
            {
              step: '2',
              title: 'Upload the .jsonl file',
              body: 'Drag and drop (or click "Choose file") to load the JSONL trace. Events are parsed locally — no raw data leaves your browser.',
              color: 'bg-indigo-50 border-indigo-100 text-indigo-600',
            },
            {
              step: '3',
              title: 'Generate &amp; export report',
              body: 'Click "Generate Report" to compute an Evidence Admission Score (EAS). Download as HTML, PDF, CSV, JSON, or Markdown.',
              color: 'bg-violet-50 border-violet-100 text-violet-600',
            },
          ].map(({ step, title, body, color }) => (
            <li key={step} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
              <span className={`w-8 h-8 rounded-xl border flex items-center justify-center text-sm font-bold shrink-0 ${color}`}>
                {step}
              </span>
              <div>
                <div className="font-semibold text-slate-800 text-sm mb-1" dangerouslySetInnerHTML={{ __html: title }} />
                <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Compliance frameworks */}
      <section aria-labelledby="compliance-heading">
        <h2 id="compliance-heading" className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          Compliance coverage
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              badge: 'EU AI Act',
              badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
              title: 'EU AI Act — Art. 26(6) Log Retention',
              body: 'Reports include a signed log retention notice meeting the mandatory record-keeping requirements for high-risk AI system deployers under the EU AI Act.',
              keywords: ['EUAIA', 'high-risk AI', 'Art. 26', 'log retention', 'GPAI'],
            },
            {
              badge: 'ISO 42001',
              badgeColor: 'bg-violet-50 text-violet-700 border-violet-200',
              title: 'ISO/IEC 42001 — AI Management System',
              body: 'Audit trails produced by OpenAgentAudit support the evidence requirements for ISO 42001 AI management system certification audits.',
              keywords: ['AI governance', 'AIMS', 'risk management', 'auditability'],
            },
            {
              badge: 'NIST AI RMF',
              badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
              title: 'NIST AI RMF — Govern & Measure',
              body: 'The Evidence Admission Score (EAS) maps to NIST AI RMF Govern and Measure functions, providing quantified evidence of AI system oversight.',
              keywords: ['NIST', 'AI risk', 'trustworthy AI', 'measurement'],
            },
            {
              badge: 'SOC 2 / Internal',
              badgeColor: 'bg-slate-100 text-slate-600 border-slate-200',
              title: 'SOC 2 & Internal Audit',
              body: 'Export findings as CSV or JSON to feed into your existing GRC platform, internal audit workflow, or security information system.',
              keywords: ['SOC 2', 'GRC', 'internal audit', 'security', 'AI transparency'],
            },
          ].map(({ badge, badgeColor, title, body, keywords }) => (
            <div key={badge} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${badgeColor}`}>{badge}</span>
              </div>
              <div>
                <div className="font-semibold text-slate-800 text-sm mb-1">{title}</div>
                <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-auto">
                {keywords.map((kw) => (
                  <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-400">{kw}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function AuditPage() {
  const [, navigate] = useLocation()
  const {
    events,
    fileName,
    fileText,
    parseError,
    isAepRecord,
    aepMeta,
    reportSummary,
    reportRunId,
    reportError,
    reportGenerating,
    setReportRunId,
    setReportError,
    setReportGenerating,
    setReportSummary,
    reset,
  } = useAudit()

  const [page, setPage] = useState(0)

  const hasEvents = events.length > 0
  const firstEvent = events[0]
  const typeCounts = countByType(events)
  const totalPages = Math.ceil(events.length / PAGE_SIZE)
  const pageEvents = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Redirect to home if no data is loaded
  useEffect(() => {
    if (!hasEvents && !isAepRecord && !parseError) {
      navigate('/')
    }
  }, [hasEvents, isAepRecord, parseError, navigate])

  // Navigate to report page when a report run ID is set
  useEffect(() => {
    if (reportRunId) {
      navigate(`/runs/${reportRunId}`)
    }
  }, [reportRunId, navigate])

  const generateReport = async () => {
    if (!fileText) return
    setReportGenerating(true)
    setReportError(null)
    try {
      const form = new FormData()
      form.append('trace', fileText)
      const headers: Record<string, string> = {}
      if (fileName) headers['x-source-file'] = fileName
      const res = await fetch('/api/v1/runs', {
        method: 'POST',
        body: form,
        headers,
      })
      if (!res.ok) {
        const text = await res.text()
        setReportError(`Server error ${res.status}: ${text}`)
        return
      }
      const data = (await res.json()) as {
        run_id?: string
        eas_score?: number
        eas_grade?: string
        finding_count?: number
        event_count?: number
      }
      setReportSummary({
        ...(data.eas_score !== undefined && { eas_score: data.eas_score }),
        ...(data.eas_grade !== undefined && { eas_grade: data.eas_grade }),
        ...(data.finding_count !== undefined && { finding_count: data.finding_count }),
        ...(data.event_count !== undefined && { event_count: data.event_count }),
      })
      if (data.run_id) {
        setReportRunId(data.run_id)
      }
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err))
    } finally {
      setReportGenerating(false)
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
              <DocumentIcon className="w-4 h-4 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-800">Audit Summary</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { reset(); navigate('/') }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-500 text-xs font-medium hover:border-slate-300 hover:bg-slate-50 transition-all duration-150"
            >
              New file
            </button>
            <button
              onClick={() => void generateReport()}
              disabled={reportGenerating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white text-sm font-semibold shadow-sm hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all duration-150"
            >
              {reportGenerating ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Generating...
                </>
              ) : (
                <>
                  <DocumentIcon className="h-4 w-4" />
                  Generate Report
                </>
              )}
            </button>
          </div>
        </div>

        {reportError && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{reportError}</span>
          </div>
        )}

        {parseError && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}

        {isAepRecord && !parseError && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-700">
            <ShieldIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>AEP evidence record detected</strong> — this file will be converted to canonical events server-side when you generate the report. Event preview is not available for AEP JSON files.
            </span>
          </div>
        )}

        {isAepRecord ? (
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-5">
            {reportSummary ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircleIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span className="font-semibold text-slate-800 text-sm">Report generated for <span className="font-mono text-indigo-600">{fileName}</span></span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">EAS Score</div>
                    <div className="text-2xl font-bold text-indigo-600">{reportSummary.eas_score ?? '—'}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Grade {reportSummary.eas_grade ?? '—'}</div>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Events</div>
                    <div className="text-2xl font-bold text-slate-700">{reportSummary.event_count ?? '—'}</div>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Findings</div>
                    <div className={`text-2xl font-bold ${(reportSummary.finding_count ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{reportSummary.finding_count ?? 0}</div>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Model</div>
                    <div className="text-xs font-semibold text-slate-700 mt-1 truncate">{aepMeta?.model_id ?? '—'}</div>
                    <div className="text-[10px] text-slate-400">{aepMeta?.model_provider ?? ''}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <ShieldIcon className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span className="font-semibold text-slate-800 text-sm">AEP record loaded: <span className="font-mono text-indigo-600">{fileName}</span></span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white/70 rounded-xl border border-indigo-100 p-3 shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Run ID</div>
                    <div className="text-xs font-mono text-slate-700 truncate">{aepMeta?.run_id ?? '—'}</div>
                  </div>
                  <div className="bg-white/70 rounded-xl border border-indigo-100 p-3 shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Model</div>
                    <div className="text-xs font-semibold text-slate-700 truncate">{aepMeta?.model_id ?? '—'}</div>
                    <div className="text-[10px] text-slate-400">{aepMeta?.model_provider ?? ''}</div>
                  </div>
                  <div className="bg-white/70 rounded-xl border border-indigo-100 p-3 shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Actions</div>
                    <div className="text-xl font-bold text-slate-700">{aepMeta?.actions ?? '—'}</div>
                  </div>
                  <div className="bg-white/70 rounded-xl border border-indigo-100 p-3 shadow-sm">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Schema</div>
                    <div className="text-xs font-mono text-indigo-600">{aepMeta?.schema_version ?? '—'}</div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-3 text-center">Click <strong className="text-slate-600">Generate Report</strong> to run the full audit pipeline.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Total Events" value={events.length} />
            <SummaryCard label="Run ID" value={firstEvent?.run_id ?? '—'} />
            <SummaryCard label="Agent ID" value={firstEvent?.agent_id ?? '—'} />
            <SummaryCard label="Model ID" value={firstEvent?.model_id ?? '—'} />
          </div>
        )}

        {hasEvents && (
          <div className="mt-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
              Event Type Breakdown
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(typeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => {
                  const s = typeStyle(type)
                  return (
                    <span
                      key={type}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${s.chip} shadow-sm`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                      <span>{type}</span>
                      <span className={`px-1.5 py-0.5 rounded-full font-bold text-[10px] ${s.chip} opacity-90`}>
                        {count}
                      </span>
                    </span>
                  )
                })}
            </div>
          </div>
        )}
      </section>

      {hasEvents && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold text-slate-800">Events</h2>
              {totalPages > 1 && (
                <span className="text-sm text-slate-400">
                  page {page + 1} of {totalPages}
                </span>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span className="px-2 text-xs text-slate-400">{page + 1} / {totalPages}</span>
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest w-44">Event ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Actor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest w-44">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageEvents.map((ev, idx) => (
                    <tr
                      key={ev.event_id ?? idx}
                      className="hover:bg-slate-50/60 transition-colors duration-100"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-400 truncate max-w-[11rem]">{ev.event_id ?? '—'}</td>
                      <td className="px-4 py-3"><TypeBadge type={ev.type} /></td>
                      <td className="px-4 py-3 text-sm text-slate-700">{ev.actor ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                        {ev.timestamp
                          ? new Date(ev.timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-xs">{eventDetails(ev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="px-3 py-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg">
                {page + 1} / {totalPages}
              </span>
              <button
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function ReportPage() {
  const params = useParams<{ runId: string }>()
  const runId = params.runId
  const { fileName, aepMeta, reportSummary, reset } = useAudit()
  const [, navigate] = useLocation()

  return (
    <div className="space-y-10">
      <section>
        <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-5">
          <div className="flex items-center gap-2.5 mb-5">
            <CheckCircleIcon className="h-5 w-5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-900">Audit Report Ready</span>
            <span className="ml-auto text-xs text-slate-400 font-mono bg-white/70 px-2 py-0.5 rounded">
              {runId.slice(0, 8)}...
            </span>
          </div>

          {reportSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">EAS Score</div>
                <div className="text-2xl font-bold text-indigo-600">{reportSummary.eas_score ?? '—'}</div>
                <div className="text-xs text-slate-500 mt-0.5">Grade {reportSummary.eas_grade ?? '—'}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Events</div>
                <div className="text-2xl font-bold text-slate-700">{reportSummary.event_count ?? '—'}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Findings</div>
                <div className={`text-2xl font-bold ${(reportSummary.finding_count ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {reportSummary.finding_count ?? 0}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Model</div>
                <div className="text-xs font-semibold text-slate-700 mt-1 truncate">{aepMeta?.model_id ?? (fileName ?? '—')}</div>
                <div className="text-[10px] text-slate-400">{aepMeta?.model_provider ?? ''}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <a
              href={`/api/v1/runs/${runId}/report?format=html`}
              target="_blank"
              rel="noreferrer"
              className="col-span-2 flex flex-col items-center justify-center gap-2 py-5 px-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white hover:from-indigo-600 hover:to-violet-600 active:scale-[0.98] transition-all duration-150 shadow-md"
            >
              <DocumentIcon className="h-8 w-8" />
              <span className="font-bold text-sm">Full Report</span>
              <span className="text-xs opacity-80">View · Print · Save PDF</span>
            </a>

            <a
              href={`/api/v1/runs/${runId}/report?format=csv`}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-2 py-5 px-4 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/30 active:scale-[0.98] transition-all duration-150 shadow-sm"
            >
              <svg className="h-7 w-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18M10 3v18M6 3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z"/>
              </svg>
              <span className="font-semibold text-sm">CSV</span>
              <span className="text-xs text-slate-400">Findings</span>
            </a>

            <a
              href={`/api/v1/runs/${runId}/report?format=json`}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-2 py-5 px-4 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:border-orange-300 hover:bg-orange-50/30 active:scale-[0.98] transition-all duration-150 shadow-sm"
            >
              <svg className="h-7 w-7 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
              <span className="font-semibold text-sm">JSON</span>
              <span className="text-xs text-slate-400">Machine-readable</span>
            </a>

            <a
              href={`/api/v1/runs/${runId}/report?format=md`}
              target="_blank"
              rel="noreferrer"
              className="col-span-2 sm:col-span-4 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98] transition-all duration-150 shadow-sm"
            >
              <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
              </svg>
              <span className="font-semibold text-sm">Markdown</span>
              <span className="text-xs text-slate-400">Plain text · Version control friendly</span>
            </a>
          </div>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => { reset(); navigate('/') }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-medium hover:border-indigo-300 hover:bg-indigo-50/30 transition-all duration-150"
          >
            Audit another file
          </button>
        </div>
      </section>
    </div>
  )
}

// ---------- App shell ----------

function AppShell() {
  const { fileName, isAepRecord, reset } = useAudit()
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_CONFIG)
  const [location, navigate] = useLocation()

  useEffect(() => {
    fetch('/api/v1/config')
      .then((r) => r.json())
      .then((d) => setConfig(d as SiteConfig))
      .catch(() => { /* keep default */ })
  }, [])

  const crumbs: Crumb[] = (() => {
    if (location === '/') {
      return [{ label: 'Home' }]
    }
    if (location === '/audit') {
      return [
        { label: 'Home', href: '/' },
        { label: fileName ? `Audit Trace — ${fileName}` : 'Audit Trace' },
      ]
    }
    if (location.startsWith('/runs/')) {
      return [
        { label: 'Home', href: '/' },
        { label: fileName ? `Audit Trace — ${fileName}` : 'Audit Trace', href: '/audit' },
        { label: 'Report' },
      ]
    }
    return [{ label: 'Home' }]
  })()

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="h-[3px] w-full bg-gradient-to-r from-violet-500 to-indigo-600 shrink-0" />

      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => { reset(); navigate('/') }}
            className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
            aria-label="Back to home"
          >
            <ShieldIcon className="w-5 h-5 text-white" />
          </button>

          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 shrink-0">{config.site_name}</h1>
            <span className="hidden sm:block text-sm text-slate-500 truncate">{config.site_tagline}</span>
          </div>

          <div className="ml-auto shrink-0">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-xs font-medium text-indigo-600 whitespace-nowrap">
              <span className="text-slate-400 font-normal hidden sm:inline">Powered by</span>
              {config.powered_by}
            </span>
          </div>
        </div>
      </header>

      <Breadcrumb crumbs={crumbs} />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 space-y-10">
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/runs/:runId" component={ReportPage} />
        </Switch>
      </main>

      <footer className="border-t border-slate-100 bg-white mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            <span className="font-medium text-slate-500">{config.site_name}</span>
            {' '}— Technical evidence only. Not legal advice.
          </span>
          <span className="flex items-center gap-2">
            Powered by{' '}
            <a
              href="https://github.com/WasmAgent/open-agent-audit"
              target="_blank"
              rel="noreferrer"
              aria-label="OpenAgentAudit on GitHub (opens in new tab)"
              className="font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              {config.powered_by}
            </a>
            {' '}·{' '}
            <a
              href="https://github.com/WasmAgent/open-agent-audit"
              target="_blank"
              rel="noreferrer"
              aria-label="View source on GitHub"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.607.069-.607 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.03-2.683-.103-.253-.447-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.578 9.578 0 0112 6.836a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.026 2.747-1.026.547 1.377.203 2.394.1 2.647.641.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
              </svg>
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <AuditProvider>
      <Router>
        <AppShell />
      </Router>
    </AuditProvider>
  )
}
