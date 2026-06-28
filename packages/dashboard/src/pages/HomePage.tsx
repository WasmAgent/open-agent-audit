import { useState, useCallback, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useAudit } from '../AuditContext'
import { parseJsonl, isAepJson, buildAepMeta } from '../utils'

// ---------- Icon components ----------

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

// ---------- HomePage ----------

export default function HomePage() {
  const [, navigate] = useLocation()
  const {
    events,
    setEvents,
    fileName,
    setFileName,
    fileText: _fileText,
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

  // Navigate to /audit once a file is successfully loaded
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
          return
        }
        const parsed = parseJsonl(text)
        setEvents(parsed)
        if (parsed.length === 0) {
          setParseError('No valid JSON lines found in the file.')
        }
      }
      reader.onerror = () => setParseError('Failed to read file.')
      reader.readAsText(file)
    },
    [setEvents, setFileName, setFileText, setParseError, setIsAepRecord, setAepMeta, setReportSummary, setReportRunId, setReportError],
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
      } else {
        const parsed = parseJsonl(text)
        setEvents(parsed)
        if (parsed.length === 0) setParseError('No valid JSON lines found in the file.')
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

        {/* AEP JSON info banner */}
        {isAepRecord && !parseError && (
          <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-700">
            <ShieldIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>AEP evidence record detected</strong> — this file will be converted to
              canonical events server-side when you generate the report. Event preview is not
              available for AEP JSON files.
            </span>
          </div>
        )}
      </section>

      {/* Empty state hero + how-to + compliance (shown when no file loaded) */}
      <>
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

        {/* How to use — 3 steps */}
        <section aria-labelledby="howto-heading">
          <h2
            id="howto-heading"
            className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2"
          >
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center">
              ?
            </span>
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
              <li
                key={step}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3"
              >
                <span
                  className={`w-8 h-8 rounded-xl border flex items-center justify-center text-sm font-bold shrink-0 ${color}`}
                >
                  {step}
                </span>
                <div>
                  <div
                    className="font-semibold text-slate-800 text-sm mb-1"
                    dangerouslySetInnerHTML={{ __html: title }}
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Compliance frameworks */}
        <section aria-labelledby="compliance-heading">
          <h2
            id="compliance-heading"
            className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
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
              <div
                key={badge}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${badgeColor}`}
                  >
                    {badge}
                  </span>
                </div>
                <div>
                  <div className="font-semibold text-slate-800 text-sm mb-1">{title}</div>
                  <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-400"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </>
    </div>
  )
}
