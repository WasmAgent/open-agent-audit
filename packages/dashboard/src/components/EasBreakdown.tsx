/**
 * EAS Sub-score Breakdown — shows 6 sub-scores with 4px proportional bars.
 * Bar width = percentage of max (100). Color matches score quality.
 */

export interface EasSubScore {
  label: string;
  score: number; // 0-100
}

function barColor(score: number): string {
  if (score > 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function textColor(score: number): string {
  if (score > 80) return 'text-emerald-700';
  if (score >= 60) return 'text-yellow-700';
  return 'text-red-700';
}

export function EasBreakdown({ scores }: { scores: EasSubScore[] }) {
  return (
    <div className="space-y-3">
      {scores.map(({ label, score }) => {
        const clamped = Math.max(0, Math.min(100, score));
        return (
          <div key={label} className="flex items-center gap-3">
            <span className="text-xs text-slate-600 w-28 shrink-0 truncate font-medium">
              {label}
            </span>
            <div className="flex-1 relative">
              {/* Track */}
              <div className="h-1 w-full rounded-full bg-slate-100" />
              {/* Fill */}
              <div
                className={`h-1 rounded-full absolute top-0 left-0 ${barColor(clamped)}`}
                style={{ width: `${clamped}%` }}
              />
            </div>
            <span className={`text-xs font-semibold w-8 text-right ${textColor(clamped)}`}>
              {clamped}
            </span>
          </div>
        );
      })}
    </div>
  );
}
