# Relationship to wasmagent-js / bscode / trace-pipeline

This is for people who already know the WasmAgent ecosystem and are asking:
"Where does OpenAgentAudit fit?"

## The current ecosystem

```
                     wasmagent-js (runtime, SDK, AEP emitter)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
           bscode                         erp-agent (planned)
     (coding agent)                    (ERP agent)
              │
              │ AEP records (signed, Ed25519)
              ▼
     ┌────────┴────────┐
     ▼                 ▼
trace-pipeline   open-agent-audit
(training data)  (audit reports + compliance)
```

## Where OpenAgentAudit fits

OpenAgentAudit is a **peer of trace-pipeline**, not a layer inside any
existing repo:

```
                        wasmagent-js
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
              bscode                        erp-agent
                │                               │
                │ AEP records, rollout JSONL    │
                ▼                               ▼
                └───────────────┬───────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
       trace-pipeline                     open-agent-audit
       (training data pipeline)           (audit evidence pipeline)
       customer: ML engineer              customer: security / compliance / procurement
       output:   SFT / DPO / PPO data     output:   findings / regulatory mappings / reports
```

Both consume the same input (AEP records). They serve different
downstream customers and produce different outputs.

## Why this is the right factoring

If we put audit logic inside `wasmagent-js`, the runtime carries audit
dependencies. If we put it inside `trace-pipeline`, it competes with the
training-data mission. If we put it inside `bscode`, only one workload
gets it.

A peer pipeline:

- Lets `wasmagent-js` stay focused on runtime compliance + AEP emission.
- Lets `trace-pipeline` stay focused on training data.
- Lets `bscode` and `erp-agent` (and future workloads) feed audit reports
  without becoming audit products themselves.
- Lets OpenAgentAudit grow its own external adapter surface
  (OpenTelemetry, Langfuse, LangSmith) without polluting the existing
  repos.

## What each repo contributes to OpenAgentAudit

| Repo | Contribution |
|---|---|
| `wasmagent-js` | AEP schema (the primary source format); evidence_id generation; signature/hash chain; capability manifest; MCP firewall evidence. All four AEP run-provenance traceability fields are now populated since PR #12: `repo_commit`, `runtime_version`, `policy_bundle_digest`, `tool_manifest_digest`. |
| `bscode` | Real-workload smoke traces; the canonical "audit demo" surface that drives the bscode adapter; attack-demo fixtures. |
| `erp-agent` | Domain-specific verifiers (order-state, ledger) that contribute objective_verification evidence. |
| `trace-pipeline` | Statistical algorithm reference (McNemar, Wilson CI, paired bootstrap) and test vectors; contamination sample fixtures. |
| `open-agent-audit` (this repo) | The canonical spec, adapters, audit engines, regulatory profiles, Cloudflare reference deployment. |

## How AEP changes are absorbed

When AEP evolves (`v0.2 → v0.3`), the only OpenAgentAudit file that
**must** change is `packages/adapters/src/aep-v0_3.ts`. The canonical
spec, audit engines, profiles, and reports remain stable.

This is the architectural reason behind the Phase 2 freeze gate (see
[`schema-versioning.md`](./schema-versioning.md)). The freeze gate
applies only to **OAA's own** canonical model; it does **not** constrain
AEP or the main projects, which continue to iterate at their own pace.

## Upstream improvements tracked in wasmagent-ops#3

The wasmagent-ops#3 issue tracks three upstream improvements needed for
full OWASP/NIST/ISO coverage in OpenAgentAudit:

1. **Guardrail → verifier promotion** — surface guardrail outcomes as
   first-class AEP verifier records so OAA can map them to OWASP LLM01–10
   and NIST AI RMF controls.
2. **Deny decisions in AEP** — emit structured deny records (tool blocked,
   capability refused) so OAA can report on enforcement rate alongside
   detection rate.
3. **Taint labels on tool outputs** — propagate data-sensitivity labels
   through the tool-call chain so OAA can produce ISO 42001 data-lineage
   evidence.

Until these land upstream, OAA covers these gaps with heuristic fallbacks
in the adapter layer (`packages/adapters/src/aep-v0_2.ts`).

## OAA does not gate the main projects

Stated explicitly because the inverse is tempting and wrong:

- OAA does **not** require `@wasmagent/aep` to freeze before OAA ships.
- OAA does **not** require bscode to stop iterating its trace format.
- OAA does **not** require trace-pipeline to coordinate releases.
- OAA does **not** impose breaking-change procedures on the main projects.

The main projects have real iteration needs and no customer-side
constraints to honor (yet). OAA absorbs their change at the adapter
layer. If an upstream change forces a new adapter version, that is OAA's
work to do, not theirs.

## What stays in each repo, what moves here

| Concern | Repo |
|---|---|
| AEP schema + emitter | `wasmagent-js` |
| MCP firewall + policy engine | `wasmagent-js` |
| Capability manifest format | `wasmagent-js` |
| Workload smoke traces | per-workload repo (bscode, erp-agent) |
| Training data export | `trace-pipeline` |
| eval_trust algorithms (Python reference) | `trace-pipeline` |
| OAA canonical spec | **`open-agent-audit`** |
| OAA TypeScript audit engines | **`open-agent-audit`** |
| OAA adapters (AEP, OTel, Langfuse, ...) | **`open-agent-audit`** |
| OAA regulatory profiles | **`open-agent-audit`** |
| OAA Cloudflare reference deployment | **`open-agent-audit`** |
| Customer trace data, sales material | `agentaudit-ops` (private) |
