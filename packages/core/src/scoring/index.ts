/** @openagentaudit/core/scoring — skeleton. */
import type { CanonicalEvent, RiskScore } from '@openagentaudit/schema';

export async function computeRiskScore(_events: CanonicalEvent[]): Promise<RiskScore> {
  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'placeholder',
    generated_at: '1970-01-01T00:00:00Z',
    evidence_admission_score: { score: 0, grade: 'F' },
    agent_risk_score: { score: 0 },
    components: {},
  };
}
