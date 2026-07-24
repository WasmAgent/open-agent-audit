/**
 * Tool Inventory — proportional call-count bars.
 * Shows relative call count per tool with a CSS bar.
 * Error calls get a red gradient variant.
 */

export interface ToolEntry {
  name: string;
  callCount: number;
  errorCount: number;
}

export function ToolInventory({ tools }: { tools: ToolEntry[] }) {
  const maxCount = Math.max(...tools.map((t) => t.callCount), 1);

  return (
    <div className="space-y-2">
      {tools.map(({ name, callCount, errorCount }) => {
        const pct = (callCount / maxCount) * 100;
        const errorPct = callCount > 0 ? (errorCount / callCount) * 100 : 0;
        const hasErrors = errorCount > 0;

        return (
          <div key={name} className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-700 w-32 shrink-0 truncate">{name}</span>
            <div className="flex-1 h-5 relative rounded bg-slate-100 overflow-hidden">
              {/* Normal calls bar */}
              <div
                className="absolute inset-y-0 left-0 rounded bg-indigo-400 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
              {/* Error overlay within the bar */}
              {hasErrors && (
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, rgba(220,38,38,0.7) 0%, rgba(220,38,38,0.7) ${errorPct}%, transparent ${errorPct}%)`,
                  }}
                />
              )}
            </div>
            <span className="text-xs text-slate-500 w-10 text-right font-medium">{callCount}</span>
            {hasErrors && (
              <span className="text-xs text-red-600 w-10 text-right font-medium">
                {errorCount} err
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
