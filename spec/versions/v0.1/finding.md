# Finding — v0.1

A `Finding` is the structured output of an audit rule. Every conclusion
the auditor draws MUST be expressed as a Finding.

## Required fields

| Field | Type | Notes |
|---|---|---|
| `finding_id` | string | Globally unique, MUST follow `OAA-F-<NNNN>` or `<rule_id>-<run_suffix>`. |
| `rule_id` | string | The rule that produced this finding. |
| `severity` | enum | `info \| low \| medium \| high \| critical`. MUST be derived from the threat taxonomy. |
| `category` | string | From the threat taxonomy. |
| `title` | string | Short headline. |
| `description` | string | Plain-language explanation suitable for non-engineers. |
| `evidence_ids` | string[] | MUST be non-empty. Each entry MUST match an `evidence_id` in the run. |
| `recommendation` | string | Actionable mitigation guidance. |

## Optional fields

| Field | Type | Notes |
|---|---|---|
| `standard_mappings` | array | Each item `{ profile, control_id, limitation }`. |
| `confidence` | enum | `low \| medium \| high`. |
| `false_positive_likelihood` | number | 0..1. |
| `first_seen` | string | RFC 3339. |
| `last_seen` | string | RFC 3339. |
| `occurrence_count` | integer | How many evidence entries support this finding. |
| `suppressed` | boolean | Whether the finding has been suppressed by tenant policy. |
| `suppression_reason` | string | Required if `suppressed === true`. |

## Severity rubric

| Severity | When to use |
|---|---|
| `critical` | Capability boundary violation with successful data exfiltration or destructive write. |
| `high` | Capability boundary violation that was attempted but blocked, OR human-oversight bypass attempt. |
| `medium` | Unexpected tool use, repeated retries, statistically suspicious benchmark claim. |
| `low` | Single-occurrence anomaly, minor protocol drift. |
| `info` | Observational note, no action recommended. |

Subjective severity without a rubric reference is non-conformant.

## Example

```json
{
  "finding_id": "OAA-F-0007",
  "rule_id": "OAA-R-NETWORK-001",
  "severity": "high",
  "category": "capability_boundary",
  "title": "Network tool call without declared capability",
  "description": "The agent attempted to invoke network_fetch although the capability manifest did not declare network access.",
  "evidence_ids": ["evt_109", "evt_142", "evt_188"],
  "recommendation": "Declare the network capability explicitly or deny network tools by default in the policy bundle.",
  "standard_mappings": [
    {
      "profile": "owasp-agentic-top10-2026",
      "control_id": "AAI05",
      "limitation": "OWASP guidance is non-binding; this mapping is interpretive."
    }
  ],
  "confidence": "high",
  "occurrence_count": 3
}
```
