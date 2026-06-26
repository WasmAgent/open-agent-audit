/** @openagentaudit/core/drift-guard — skeleton. */
export interface DriftSummary {
  windows: number;
  drifted_metrics: string[];
}

export async function driftGuard(): Promise<DriftSummary> {
  return { windows: 0, drifted_metrics: [] };
}
