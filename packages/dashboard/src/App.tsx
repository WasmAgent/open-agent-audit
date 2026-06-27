import { useState, useCallback, useEffect } from 'react'

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

function parseJsonl(text: string): RawEvent[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as RawEvent
      } catch {
        return null
      }
    })
    .filter((e): e is RawEvent => e !== null)
}

function typeColorClass(type: string | undefined): string {
  switch (type) {
    case 'tool_call':
      return 'bg-blue-100 text-blue-800'
    case 'policy_decision':
      return 'bg-yellow-100 text-yellow-800'
    case 'human_approval':
      return 'bg-green-100 text-green-800'
    case 'error':
      return 'bg-red-100 text-red-800'
    case 'observation':
      return 'bg-purple-100 text-purple-800'
    case 'model_output':
      return 'bg-indigo-100 text-indigo-800'
    case 'final_answer':
      return 'bg-teal-100 text-teal-800'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function eventDetails(ev: RawEvent): string {
  if (ev.tool?.name) {
    const cap = ev.tool.capability ? ` (${ev.tool.capability})` : ''
    const tags = ev.tool.risk_tags && ev.tool.risk_tags.length > 0 ? ` [${ev.tool.risk_tags.join(', ')}]` : ''
    return `tool: ${ev.tool.name}${cap}${tags}`
  }
  if (ev.policy?.decision) {
    return `${ev.policy.decision}${ev.policy.reason ? ` — ${ev.policy.reason}` : ''}`
  }
  if (ev.human?.decision) {
    return `${ev.human.decision} — ${ev.human.reviewer_id ?? 'unknown reviewer'}${ev.human.justification ? ` · "${ev.human.justification}"` : ''}`
  }
  if (ev.error?.kind) {
    return `${ev.error.kind}${ev.error.message ? `: ${ev.error.message}` : ''}`
  }
  if (ev.observation?.source) {
    const size = ev.observation.byte_size != null ? ` · ${ev.observation.byte_size}B` : ''
    return `source: ${ev.observation.source}${size}`
  }
  if (ev.model_output) {
    const parts: string[] = []
    if (ev.model_output.finish_reason) parts.push(`finish: ${ev.model_output.finish_reason}`)
    if (ev.model_output.token_count != null) parts.push(`${ev.model_output.token_count} tokens`)
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

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900 truncate">{value}</div>
    </div>
  )
}

export default function App() {
  const [events, setEvents] = useState<RawEvent[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileText, setFileText] = useState<string>('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [page, setPage] = useState(0)
  const [reportGenerating, setReportGenerating] = useState(false)
  const [reportRunId, setReportRunId] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    fetch('/api/v1/config')
      .then((r) => r.json())
      .then((d) => setConfig(d as SiteConfig))
      .catch(() => { /* keep default */ })
  }, [])

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.jsonl') && !file.name.endsWith('.json')) {
      setParseError('Please select a .jsonl file.')
      return
    }
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setFileText(text)
      const parsed = parseJsonl(text)
      setEvents(parsed)
      setPage(0)
      setReportRunId(null)
      setReportError(null)
      if (parsed.length === 0) {
        setParseError('No valid JSON lines found in the file.')
      }
    }
    reader.onerror = () => setParseError('Failed to read file.')
    reader.readAsText(file)
  }, [])

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

  const generateReport = async () => {
    if (!fileText) return
    setReportGenerating(true)
    setReportError(null)
    try {
      const form = new FormData()
      form.append('trace', fileText)
      const headers: Record<string, string> = {}
      if (fileName) headers['x-source-file'] = fileName
      const res = await fetch('/api/v1/runs', { method: 'POST', body: form, headers })
      if (!res.ok) {
        const text = await res.text()
        setReportError(`Server error ${res.status}: ${text}`)
        return
      }
      const data = await res.json() as { run_id?: string; eas_score?: number; eas_grade?: string; finding_count?: number }
      if (data.run_id) setReportRunId(data.run_id)
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err))
    } finally {
      setReportGenerating(false)
    }
  }

  const firstEvent = events[0]
  const typeCounts = countByType(events)
  const totalPages = Math.ceil(events.length / PAGE_SIZE)
  const pageEvents = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="text-xl font-bold text-gray-900">{config.site_name}</span>
          </div>
          <div className="hidden sm:block h-6 border-l border-gray-300" />
          <p className="hidden sm:block text-sm text-gray-500">
            {config.site_tagline}
          </p>
          <div className="ml-auto hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
            <span>Powered by</span>
            <span className="font-medium text-indigo-600">{config.powered_by}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Upload Section */}
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Load Audit Trace</h2>
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white'
            }`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          >
            <div className="flex flex-col items-center gap-3">
              <svg
                className="w-10 h-10 text-gray-400"
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
              <div>
                <p className="text-gray-700 font-medium">
                  {fileName ? (
                    <span className="text-indigo-600">{fileName}</span>
                  ) : (
                    'Drop a .jsonl file here, or click to select'
                  )}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  JSONL format — one CanonicalEvent per line
                </p>
              </div>
              <label className="cursor-pointer mt-1">
                <span className="inline-flex items-center px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
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
          {parseError && (
            <p className="mt-2 text-sm text-red-600">{parseError}</p>
          )}
        </section>

        {/* Summary Section */}
        {events.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">Summary</h2>
              {/* Action bar */}
              <div className="flex items-center gap-2">
                <button
                  onClick={generateReport}
                  disabled={reportGenerating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {reportGenerating ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Generating…
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                      </svg>
                      Generate Full Report
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Report status */}
            {reportError && (
              <div className="mb-3 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                {reportError}
              </div>
            )}
            {reportRunId && (
              <div className="mb-4 p-5 rounded-xl bg-gradient-to-r from-indigo-50 to-green-50 border border-indigo-200">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="h-5 w-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <span className="font-semibold text-gray-900">Audit Report Ready</span>
                  <span className="ml-auto text-xs text-gray-400 font-mono">{reportRunId.slice(0, 8)}…</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <a
                    href={`/api/v1/runs/${reportRunId}/report?format=html`}
                    target="_blank"
                    rel="noreferrer"
                    className="col-span-2 sm:col-span-2 flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-md"
                  >
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <span className="font-semibold text-sm">Full Report</span>
                    <span className="text-xs opacity-80">View · Print · Save PDF</span>
                  </a>
                  <a
                    href={`/api/v1/runs/${reportRunId}/report?format=csv`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-indigo-300 transition-colors shadow-sm"
                  >
                    <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18M10 3v18M6 3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z"/>
                    </svg>
                    <span className="font-medium text-sm">CSV</span>
                    <span className="text-xs text-gray-400">Findings</span>
                  </a>
                  <a
                    href={`/api/v1/runs/${reportRunId}/report?format=json`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-indigo-300 transition-colors shadow-sm"
                  >
                    <svg className="h-6 w-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                    </svg>
                    <span className="font-medium text-sm">JSON</span>
                    <span className="text-xs text-gray-400">Machine-readable</span>
                  </a>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <SummaryCard label="Total Events" value={events.length} />
              <SummaryCard label="Run ID" value={firstEvent?.run_id ?? '—'} />
              <SummaryCard label="Agent ID" value={firstEvent?.agent_id ?? '—'} />
              <SummaryCard label="Model ID" value={firstEvent?.model_id ?? '—'} />
            </div>

            {/* Type breakdown */}
            <div className="mt-4 bg-white rounded-lg border border-gray-200 shadow-sm p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                Event Type Breakdown
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(typeCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <span
                      key={type}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${typeColorClass(type)}`}
                    >
                      {type}
                      <span className="font-bold">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          </section>
        )}

        {/* Events Table */}
        {events.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">
                Events
                {totalPages > 1 && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    (page {page + 1} of {totalPages})
                  </span>
                )}
              </h2>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-48">
                        Event ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Actor
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-44">
                        Timestamp
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageEvents.map((ev, idx) => (
                      <tr key={ev.event_id ?? idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[12rem]">
                          {ev.event_id ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${typeColorClass(ev.type)}`}
                          >
                            {ev.type ?? 'unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {ev.actor ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                          {ev.timestamp
                            ? new Date(ev.timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC')
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs truncate max-w-xs">
                          {eventDetails(ev)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 mt-3">
                <button
                  className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span className="text-sm text-gray-500">
                  {page + 1} / {totalPages}
                </span>
                <button
                  className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </section>
        )}

        {/* Empty state when no file loaded */}
        {events.length === 0 && !parseError && !fileName && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-base">Load a .jsonl audit trace to get started.</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between text-xs text-gray-400">
          <span>{config.site_name} — Technical evidence only. Not legal advice.</span>
          <span>Powered by <a href="https://github.com/WasmAgent/open-agent-audit" target="_blank" rel="noreferrer" className="text-indigo-500 hover:text-indigo-700">{config.powered_by}</a> (open source)</span>
        </div>
      </footer>
    </div>
  )
}
