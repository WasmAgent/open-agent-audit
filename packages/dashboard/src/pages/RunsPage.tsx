import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'

/**
 * Sparkline — tiny inline bar chart for EAS score trend.
 * Pure SVG, no external deps.
 */
function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null
  const max = Math.max(...values, 100)
  const barWidth = Math.max(2, (width - (values.length - 1) * 1) / values.length)

  return (
    <svg width={width} height={height} className="inline-block">
      {values.map((v, i) => {
        const barH = (v / max) * height
        const color = v > 80 ? '#16a34a' : v >= 60 ? '#ca8a04' : '#dc2626'
        return (
          <rect
            key={i}
            x={i * (barWidth + 1)}
            y={height - barH}
            width={barWidth}
            height={barH}
            rx={1}
            fill={color}
            opacity={0.85}
          />
        )
      })}
    </svg>
  )
}

interface RunEntry {
  run_id: string
  created_at: string
  input_format?: string
  eas_score?: number
  event_count?: number
  finding_count?: number
  /** Agent Risk Score stored in D1 (risk_score column). */
  risk_score?: number
  status?: string
}

export function RunsPage() {
  const [, navigate] = useLocation()
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/runs')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setRuns((data as { runs?: RunEntry[] }).runs ?? (data as RunEntry[]))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const easScores = runs
    .map((r) => r.eas_score)
    .filter((s): s is number => s != null)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Audit Runs</h2>
        {easScores.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">EAS trend</span>
            <Sparkline values={easScores} />
          </div>
        )}
      </div>

      {loading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading runs...</div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          No audit runs yet. Upload a trace to create your first run.
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Run ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">EAS</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">ARS</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Findings</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Events</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr
                  key={run.run_id}
                  className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                  onClick={() => navigate(`/runs/${run.run_id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-indigo-600 truncate max-w-[10rem]">
                    {run.run_id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 truncate max-w-[12rem]">
                    {run.input_format ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {run.eas_score != null ? (
                      <span className={`text-xs font-bold ${
                        run.eas_score > 80 ? 'text-emerald-600' : run.eas_score >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {run.eas_score}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {run.risk_score != null ? (
                      <span className={`text-xs font-bold ${
                        run.risk_score > 80 ? 'text-emerald-600' : run.risk_score >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {run.risk_score}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {run.finding_count != null ? (
                      <span className={run.finding_count > 0 ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                        {run.finding_count}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {run.event_count ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {run.created_at
                      ? new Date(run.created_at).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
