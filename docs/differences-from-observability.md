# Differences from Observability

A common confusion is "isn't this just another tracing / LLM observability
tool?" This document explains why OpenAgentAudit is in a different
category from products like LangSmith, Langfuse, Helicone, Arize, and
Phoenix.

## Different question

| Concern | Observability | OpenAgentAudit |
|---|---|---|
| Primary question | "What happened? Was it fast? Did it cost too much?" | "Can what happened be defended to an external reviewer?" |
| Primary user | Engineer debugging | Security architect, compliance officer, procurement |
| Primary output | Traces, dashboards, alerts | Findings, evidence bundles, regulatory mappings |
| Time horizon | Real-time + recent history | Audit-window snapshots |

## Different data model

Observability records what the system produced. OpenAgentAudit records
what can be **proven** the system produced, with chain integrity and
signatures.

| Concern | Observability | OpenAgentAudit |
|---|---|---|
| Record contents | Spans, attributes, logs | Canonical events with hashes, signatures, prev_hash |
| Integrity | Optional / not required | Designed for tamper detection |
| Provenance | Tag-based | Signed evidence chains |
| Schema stability | Per-vendor | Schema-versioned spec |

## Different conclusions

Observability surfaces anomalies for **humans to investigate**.
OpenAgentAudit produces **findings with rubric-referenced severities**
that can be cited in reports.

| Concern | Observability | OpenAgentAudit |
|---|---|---|
| Output unit | An alert or a graph | A `Finding` object with evidence_ids |
| Severity model | Threshold-based | Rubric-based, taxonomy-referenced |
| Citation | "See the trace at link" | "See evidence_ids [evt_109, evt_142]" |
| Frameworks | Custom dashboards | Profile-driven mappings to OWASP / NIST / ISO / EU AI Act |

## Different relationship to standards

Observability is positioned as a vendor product. OpenAgentAudit is
positioned as an **open standard plus a reference implementation**:

- The spec lives in this repository under Apache 2.0.
- JSON schemas are public artifacts at versioned URLs.
- Profiles are YAML files that can be forked.
- Reports are reproducible from a bundle.

## Why we don't replace observability

OpenAgentAudit **consumes** observability output. Adapters are provided
for Langfuse, LangSmith, and OpenTelemetry GenAI spans. Customers keep
their observability stack; OpenAgentAudit adds an audit layer on top.

The relationship is upstream → downstream, not competitor → competitor.

## When you should still use observability

- Real-time alerting on latency / cost / error rate.
- Debugging in development.
- A/B testing model variants.
- Token-level cost attribution.

OpenAgentAudit does none of these well.

## When you should add OpenAgentAudit

- You are responding to a security review or procurement questionnaire.
- A regulator or customer has asked for technical documentation aligned
  with EU AI Act Annex IV.
- You need to demonstrate that benchmark claims are statistically valid.
- You are delivering an audit bundle to an external counterparty.
- You want the option of producing a defensible report years after the
  run executed.
