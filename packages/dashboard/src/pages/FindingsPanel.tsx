import { useState, useEffect, useCallback } from 'react'

export interface FindingEntry {
  finding_id: string
  run_id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  title: string
  description?: string
  evidence_ids?: string
  recommendation?: string
  standard_mappings?: string
  confidence?: 'high' | 'medium' | 'low'
  event_id?: string
  occurrence_count?: number
  suppressed?: number
  suppression_reason?: string
  created_at?: string
}

const SEVERITY_STYLES: Record<string, { chip: string; dot: string }> = {
  critical: { chip: 'bg-red-100 text-red-800 border border-red-300',     dot: 'bg-red-500' },
  high:     { chip: 'bg-orange-100 text-orange-800 border border-orange-300', dot: 'bg-orange-500' },
  medium:   { chip: 'bg-amber-100 text-amber-800 border border-amber-300', dot: 'bg-amber-500' },
  low:      { chip: 'bg-sky-100 text-sky-800 border border-sky-200',       dot: 'bg-sky-500' },
  info:     { chip: 'bg-slate-100 text-slate-600 border border-slate-200', dot: 'bg-slate-400' },
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border border-amber-200',
  low:    'bg-slate-100 text-slate-600 border border-slate-200',
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = (SEVERITY_STYLES[severity] ?? SEVERITY_STYLES['info'])!
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {severity}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cls = (CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES['low'])!
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {confidence} confidence
    </span>
  )
}

interface FindingsPanelProps {
  runId: string
  /** Optional: highlight the row whose event_id matches this, for drill-down */
  highlightEventId?: string
  onEventClick?: (eventId: string) => void
}

export function FindingsPanel({ runId, highlightEventId, onEventClick }: FindingsPanelProps) {
  const [findings, setFindings] = useState<FindingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchFindings = useCallback(() => {
    setLoading(true)
    fetch(`/api/v1/runs/${runId}/findings`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const arr = (data as { findings?: FindingEntry[] }).findings ?? []
        setFindings(arr.filter((f) => !f.suppressed))
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [runId])

  useEffect(() => { fetchFindings() }, [fetchFindings])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (loading) {
    return <div className="text-center py-8 text-slate-400 text-sm">Loading findings...</div>
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (findings.length === 0) {
    return (
      <div className="text-center py-8 text-emerald-600 text-sm font-medium">
        No findings — clean audit run.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {findings.map((f) => {
        const isOpen = expanded.has(f.finding_id)
        const isHighlighted = highlightEventId != null && f.event_id === highlightEventId
        let mappings: Array<{ profile: string; control_id: string; limitation: string }> = []
        try {
          if (f.standard_mappings) {
            mappings = JSON.parse(f.standard_mappings) as typeof mappings
          }
        } catch { /* ignore */ }

        return (
          <div
            key={f.finding_id}
            className={`rounded-xl border bg-white shadow-sm transition-colors ${
              isHighlighted ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-slate-200'
            }`}
          >
            {/* Header row */}
            <button
              type="button"
              className="w-full text-left px-4 py-3 flex items-start gap-3"
              onClick={() => toggleExpand(f.finding_id)}
            >
              <div className="shrink-0 mt-0.5">
                <SeverityBadge severity={f.severity} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{f.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{f.category}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {f.confidence && <ConfidenceBadge confidence={f.confidence} />}
                {f.occurrence_count != null && f.occurrence_count > 1 && (
                  <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                    ×{f.occurrence_count}
                  </span>
                )}
                {f.event_id && onEventClick && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEventClick(f.event_id!) }}
                    className="text-[10px] text-indigo-500 hover:text-indigo-700 font-mono bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 transition-colors"
                    title="Jump to triggering event"
                  >
                    {f.event_id.slice(0, 8)}
                  </button>
                )}
                <span className="text-slate-300 text-xs">{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {/* Expanded content */}
            {isOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                {f.description && (
                  <p className="text-xs text-slate-600 leading-relaxed">{f.description}</p>
                )}
                {f.recommendation && (
                  <div className="text-xs text-slate-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <span className="font-semibold text-amber-700 block mb-1">Recommendation</span>
                    {f.recommendation}
                  </div>
                )}
                {mappings.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">
                      Framework Mappings
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {mappings.map((m) => (
                        <span
                          key={`${m.profile}:${m.control_id}`}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700"
                          title={m.limitation}
                        >
                          {m.profile} · {m.control_id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {f.event_id && (
                  <div className="text-[10px] text-slate-400 font-mono">
                    Triggered by event: {f.event_id}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
