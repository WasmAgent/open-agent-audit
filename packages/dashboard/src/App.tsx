import { useState, useCallback } from 'react'

interface RawEvent {
  schema_version?: string
  run_id?: string
  event_id?: string
  agent_id?: string
  model_id?: string
  timestamp?: string
  type?: string
  actor?: string
  tool?: { name?: string; capability?: string }
  policy?: { decision?: string; reason?: string }
  error?: { kind?: string; message?: string }
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
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function eventDetails(ev: RawEvent): string {
  if (ev.tool?.name) {
    return `tool: ${ev.tool.name}${ev.tool.capability ? ` (${ev.tool.capability})` : ''}`
  }
  if (ev.policy?.decision) {
    return `${ev.policy.decision}${ev.policy.reason ? ` — ${ev.policy.reason}` : ''}`
  }
  if (ev.error?.kind) {
    return `${ev.error.kind}${ev.error.message ? `: ${ev.error.message}` : ''}`
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
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [page, setPage] = useState(0)

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
      const parsed = parseJsonl(text)
      setEvents(parsed)
      setPage(0)
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
              <span className="text-white font-bold text-sm">OA</span>
            </div>
            <span className="text-xl font-bold text-gray-900">OpenAgentAudit</span>
          </div>
          <div className="hidden sm:block h-6 border-l border-gray-300" />
          <p className="hidden sm:block text-sm text-gray-500">
            Evidence-grade audit for enterprise AI agents
          </p>
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
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Summary</h2>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-xs text-gray-400">
          OpenAgentAudit — Technical evidence only. Not legal advice.
        </div>
      </footer>
    </div>
  )
}
