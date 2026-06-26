/** @openagentaudit/core/policy-audit — skeleton. */
import type { CanonicalEvent, Finding } from '@openagentaudit/schema';

export interface PolicyAuditContext {
  manifest: { capabilities: string[] };
}

export async function policyAudit(
  _events: CanonicalEvent[],
  _ctx: PolicyAuditContext,
): Promise<Finding[]> {
  return [];
}
