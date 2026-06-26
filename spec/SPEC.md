# OpenAgentAudit Specification

This directory contains the OpenAgentAudit specification, an open evidence
format for enterprise AI agents.

## Versioned specifications

| Version | Status | Path |
|---|---|---|
| `open-agent-audit/v0.1` | Draft | [`versions/v0.1/SPEC.md`](./versions/v0.1/SPEC.md) |

## What the spec defines

The OpenAgentAudit specification defines a canonical, schema-versioned format
for **AI agent runtime evidence** — the artifacts an enterprise needs in
order to audit, defend, and inspect what an autonomous AI agent did.

The specification covers:

1. **Canonical event** — a single record describing one observable thing
   the agent did (tool call, policy decision, human approval, model output,
   error).
2. **Audit run** — a self-contained collection of canonical events plus
   the metadata required to audit them.
3. **Finding** — a structured record of an audit conclusion, with required
   evidence references and severity rubric.
4. **Evidence bundle** — a packaged delivery format for a complete audit
   trail, including signatures and chain integrity.
5. **Regulatory profiles** — declarative mappings from auditable evidence
   to OWASP / NIST / ISO / EU AI Act technical documentation requirements.

## What the spec does not define

- Legal interpretations of any regulation.
- A binding compliance determination.
- A model evaluation methodology beyond paired statistical baselines.
- A specific transport protocol (HTTP, gRPC, queue semantics).
- A specific storage backend (R2, S3, filesystem).

## Compatibility

OpenAgentAudit is designed to be **filled from** existing trace formats:

| Source format | Adapter |
|---|---|
| AEP (`@wasmagent/aep`) | `packages/adapters/src/aep-v0_2.ts` |
| ComplianceEvalRecord (`@wasmagent/compliance`) | `packages/adapters/src/compliance-eval-record.ts` |
| bscode rollout JSONL | `packages/adapters/src/bscode.ts` |
| OpenTelemetry GenAI spans | `packages/adapters/src/otel.ts` |
| Langfuse export | `packages/adapters/src/langfuse.ts` |
| LangSmith export | `packages/adapters/src/langsmith.ts` |

Adapters are **versioned contracts**. Source-format evolution is absorbed by
the adapter; the OpenAgentAudit canonical model is the stable interior.

See [`docs/adapter-contract.md`](../docs/adapter-contract.md).

## Versioning

See [`docs/schema-versioning.md`](../docs/schema-versioning.md) for the
freeze-gate policy that governs when new spec versions are released.
