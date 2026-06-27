# Compliance Coverage Report

> **As of:** 2026-06-27  
> **Measurement basis:** Production report from `examples/traces/aep-wasmagent-fixture.json`
> (run `e43a9864`, 4 events, Ed25519-signed AEP v0.2 record with all four traceability fields).  
> **Scoring:** supported = 1.0 · partial = 0.5 · not_applicable = excluded from denominator · not_evaluated = 0.  
> **Coverage formula:** depth = Σ scores ÷ mapped controls (excl. N/A) · breadth = mapped ÷ total addressable controls.

---

## Executive summary

| Framework | Mapped controls | Total addressable | Breadth | Depth | Combined |
|---|---|---|---|---|---|
| OWASP Agentic Top 10 | 10 / 10 | 10 | **100%** | **75.0%** | **75.0%** |
| EU AI Act (high-risk) | 13 / ~32 | ~32 | **40.6%** | **53.8%** | **21.8%** |
| NIST AI RMF 1.0 | 14 / 72 | 72 | **19.4%** | **32.1%** | **6.2%** |
| ISO/IEC 42001:2023 | 11 / 37 | 37 | **29.7%** | **54.5%** | **16.2%** |

---

## OWASP Top 10 for Agentic Applications 2026

**Breadth: 10/10 (100%) · Depth: 6.0/8 active = 75.0%**

| Control | Label | Status | Score | Upgrade path |
|---|---|---|---|---|
| AAI01 | Memory Poisoning | ✅ supported | 1.0 | — |
| AAI02 | Tool Misuse | ✅ supported | 1.0 | — |
| AAI03 | Privilege Escalation | ⚠️ partial | 0.5 | Deny + CAP finding together → supported |
| AAI04 | Inter-Agent Delegation | ✅ supported | 1.0 | — |
| AAI05 | External Communication | — N/A | excl. | Needs network tool in trace |
| AAI06 | Data Exfiltration | ⚠️ partial | 0.5 | Add `exfil-verifier:*` observation → supported |
| AAI07 | Goal Drift | ⚠️ partial | 0.5 | Needs drift-guard engine (cross-run) |
| AAI08 | Prompt Injection | ⚠️ partial | 0.5 | Add `inject-filter:*` observation → supported |
| AAI09 | Human Oversight | — N/A | excl. | Needs human_approval event in trace |
| AAI10 | Auditability | ✅ supported | 1.0 | — |

### Remaining gaps

**Immediately improvable by emitter changes (no engine work):**
- AAI06 → supported: emitter adds a verifier observation with source `exfil-verifier:*`
- AAI08 → supported: emitter adds a verifier observation with source `inject-filter:*`

**Structural / architecture-level gap:**
- AAI07: single-run proxy is in place; `supported` requires the drift-guard engine operating across multiple runs

---

## EU AI Act — High-Risk AI Systems

**Breadth: 13/~32 (40.6%) · Depth: 7.0/13 active = 53.8%**

| Control | Article / Annex | Status | Score | Upgrade path |
|---|---|---|---|---|
| annex-iv-system-description | Annex IV 1(a), Art. 11 | ✅ supported | 1.0 | — |
| annex-iv-accuracy-robustness | Art. 15 | ✅ supported | 1.0 | — |
| annex-iv-logging-capability | Art. 12(1) | ✅ supported | 1.0 | — (100% signed → auto-supported) |
| annex-iv-lifecycle-changes | Annex IV Item 6 | ✅ supported | 1.0 | — (all signer_key_id + fully signed) |
| annex-iv-design-specifications | Annex IV 2 | ⚠️ partial | 0.5 | Fill ReportMeta.deployment_context |
| annex-iv-risk-management | Art. 9 | ⚠️ partial | 0.5 | Deny + finding; FMEA is org. doc. |
| annex-iv-data-governance | Annex IV 4, Art. 10 | ⚠️ partial | 0.5 | pii/user-supplied taint labels present |
| annex-iv-monitoring | Art. 72 | ⚠️ partial | 0.5 | Cross-run needs architecture work |
| annex-iv-intended-use | Annex IV 1(b), Art. 13 | ⚠️ partial | 0.5 | Fill ReportMeta.intended_use |
| annex-iv-testing-validation | Annex IV Item 7 | ? not evaluated | 0 | Needs benchmark engine |
| annex-iv-qms | Art. 17 | ? not evaluated | 0 | Org. documentation only |
| annex-iv-transparency | Art. 13 | ? not evaluated | 0 | Org. documentation only |
| annex-iv-human-oversight | Art. 14 | — N/A | excl. | Needs human_approval in trace |

### Remaining gaps

**Improvable without engine changes:**
- `annex-iv-design-specifications` partial → supported: add `ReportMeta.deployment_context` + `intended_use` → logic can check and upgrade
- `annex-iv-intended-use` partial → supported: same as above

**Improvable with benchmark engine (already scaffolded in core):**
- `annex-iv-testing-validation` not_evaluated → partial/supported: benchmark-audit engine output needed

**Not technically automatable (organisational):**
- `annex-iv-qms` (Art. 17): QMS policy documents, management responsibility
- `annex-iv-transparency` (Art. 13): Instructions-for-use document to end users

**Unmapped EU AI Act requirements (~19 items):**
The remaining ~19 addressable items fall into two categories:
- *Organisational* (Art. 9 FMEA, Art. 10 data provenance, Art. 13 instructions, Art. 26 deployer obligations, Art. 43 conformity assessment): ~12 items — not automatable by design
- *Technically addressable but not yet mapped* (Art. 12 log field specifications, Annex IV Item 8 accuracy metrics): ~7 items — future work

---

## NIST AI Risk Management Framework 1.0

**Breadth: 14/72 (19.4%) · Depth: 4.5/14 = 32.1%**

| Subcategory | Function | Status | Score | Upgrade path |
|---|---|---|---|---|
| MEASURE-2.7 | MEASURE | ✅ supported | 1.0 | — |
| MEASURE-2.1 | MEASURE | ✅/⚠️ context-dep. | 0.75† | verifier/tool ratio ≥50% → supported |
| MAP-2.2 | MAP | ⚠️ partial | 0.5 | risk_tags on tool events |
| MAP-5.1 | MAP | ⚠️ partial | 0.5 | risk_tags + policy events |
| MAP-3.2 | MAP | ⚠️ partial | 0.5 | policy-audit findings present |
| MEASURE-2.5 | MEASURE | ⚠️ partial | 0.5 | human_approval + risk-tagged tools |
| MEASURE-2.11 | MEASURE | ⚠️ partial | 0.5 | pii/sensitive taint labels |
| MEASURE-2.3 | MEASURE | ⚠️ partial | 0.5 | findings or tool+policy events |
| GOVERN-1.1 | GOVERN | ? not evaluated | 0 | Org. documentation only |
| MEASURE-2.9 | MEASURE | ? not evaluated | 0 | Benchmark engine needed |
| MANAGE-2.3 | MANAGE | ? not evaluated | 0 | Needs deny + human_approval |
| MANAGE-2.2 | MANAGE | ? not evaluated | 0 | Needs deny/error events |
| MANAGE-4.2 | MANAGE | ? not evaluated | 0 | Needs error/deny events |
| MANAGE-4.1 | MANAGE | ? not evaluated | 0 | Cross-run monitoring needed |

† MEASURE-2.1 scores `supported` (1.0) when verifier coverage ≥ 50% of tool calls, `partial` (0.5) otherwise.

### Remaining gaps

**Immediately improvable by trace content (no code changes):**
- MANAGE-2.2, MANAGE-4.2, MANAGE-2.3: all trigger when deny/error/human_approval events exist in trace — emitters just need to emit these event types

**Requires benchmark engine:**
- MEASURE-2.9: benchmark-audit engine scaffolded but not yet wired to compliance mapping

**NIST breadth ceiling for single-run tools:**
NIST RMF has 72 subcategories. Approximately:
- ~8 are fully automatable from runtime traces
- ~17 are hybrid (runtime necessary but insufficient)  
- ~47 require only organisational documentation

The theoretical maximum coverage for a single-run trace tool is therefore approximately **25/72 (34.7%)** — and we are currently at 14/72 (19.4%), meaning there is still **~11 unmapped subcategories** that are technically reachable.

**Three highest-ROI additions not yet implemented:**

| Subcategory | What triggers it | Estimated effort |
|---|---|---|
| MAP-4.1 (risk findings communicated) | findings.length > 0 | 1 line |
| MEASURE-2.2 (AI system metrics tracked) | EAS score computed | 1 line |
| MANAGE-3.2 (risk treatment effectiveness) | deny + verifier together | ~5 lines |

---

## ISO/IEC 42001:2023

**Breadth: 11/37 (29.7%) · Depth: 6.5/11 = 59.1%**

| Control | Clause | Status | Score | Upgrade path |
|---|---|---|---|---|
| A.7.5 | Operational monitoring | ✅ supported | 1.0 | — (100% hash + signed) |
| A.9.1 | Third-party AI components | ✅ supported | 1.0 | — (all events have signer_key_id) |
| A.10.2 | Monitoring & reporting | ✅ supported | 1.0 | — (all events have evidence block) |
| A.6.2 | Individual/group impacts | ⚠️ partial | 0.5 | pii/sensitive taint labels |
| A.7.3 | Verification & validation | ⚠️ partial | 0.5 | verifier obs. coverage ≥50% → supported |
| A.8.3 | Runtime data quality | ⚠️ partial | 0.5 | risk-tagged tool events |
| A.8.5 | Runtime input monitoring | ⚠️ partial | 0.5 | user-supplied taint labels |
| A.6.1.4 | Impact assessment | ? not evaluated | 0 | Org. documentation only |
| A.7.4 | Data quality (design-time) | ? not evaluated | 0 | Org. documentation only |
| A.8.2 | Performance evaluation | ? not evaluated | 0 | Benchmark engine needed |
| A.9.2 | Communication | ? not evaluated | 0 | Org. documentation only |

### Remaining gaps

**Improvable by emitter (no code changes to OAA):**
- A.7.3 → supported: verifier coverage ≥ 50% of tool calls (emitter adds more verifier observations)
- A.6.2 → supported: fairness engine output (future work)

**Unmapped ISO controls with technical signal (~5 more reachable):**

| Control | What triggers it |
|---|---|
| A.7.2 (design objectives) | ReportMeta.intended_use present |
| A.8.4 (data preparation) | Input refs with digest in AEP record |
| A.9.3 (third-party monitoring) | Multiple runs with same signer_key_id |
| A.5.2 (AI policy) | ReportMeta.qms_reference present |
| A.10.1 (operational docs) | Source file present in ReportMeta |

**Not automatable (~21 controls):**
ISO 42001 is governance-system standard (ISMS-style). Controls A.5–A.6, A.7.1–A.7.2,
A.8.1–A.8.2, A.9.2, and most of A.10 require organisational policy documents,
management decisions, and stakeholder communication — none of which a runtime trace
can evidence.

---

## Coverage ceiling analysis

The fundamental constraint for any runtime-trace-only tool:

| Framework | Theoretical max (trace-addressable) | Current | Gap to ceiling |
|---|---|---|---|
| OWASP Agentic Top 10 | ~100% | 75% | **25pp** (AAI07 drift, AAI06/08 verifiers) |
| EU AI Act | ~35% combined | 21.8% | **~13pp** (benchmark engine, ReportMeta fields) |
| NIST AI RMF | ~34.7% | 6.2% | **~28pp** (14 more subcategories reachable) |
| ISO/IEC 42001 | ~43% | 16.2% | **~27pp** (5 more controls reachable) |

The remaining gaps after the ceiling are inherently organisational — no automated tool
can cross them. A compliance tool can present them accurately as `not_evaluated` with
a clear limitation statement, which is what this report does.

---

## How to improve coverage in your deployment

**Without changing OpenAgentAudit (emitter-side changes):**

1. Add `inject-filter:*` source observations to your AEP emitter → AAI08 → supported
2. Add `exfil-verifier:*` source observations → AAI06 → supported  
3. Tag high-risk tool calls with `human_required` or `high_risk` risk tags + emit `human_approval` events → AAI09, annex-iv-human-oversight, MEASURE-2.5 → supported
4. Emit `error` events when tool calls fail → MANAGE-2.2, MANAGE-4.2, MANAGE-2.3 → partial
5. Tag sensitive inputs with `pii` or `user-supplied` → A.6.2, MEASURE-2.11, annex-iv-data-governance → partial/supported

**By populating ReportMeta fields:**

```ts
const meta: ReportMeta = {
  intended_use: 'Software development assistant — internal use only',
  deployment_context: 'Engineering team, EU jurisdiction, low-risk per Art. 6',
  transparency_statement: 'Users are informed they interact with an AI coding assistant.',
  qms_reference: 'ISO 9001:2015 QMS v3.2, section 8.3 — AI-assisted development',
};
```

Populating these upgrades `annex-iv-intended-use` and unlocks `annex-iv-design-specifications`.

**Engine-level (benchmark-audit engine integration):**

The `benchmark-audit` engine is scaffolded in `packages/core/src/benchmark-audit/`.
Wiring its output into the compliance mapping would upgrade:
`annex-iv-testing-validation`, `MEASURE-2.9`, `A.8.2` from `not_evaluated` → `partial`/`supported`.

---

## Methodology notes

- `not_applicable` is correct when the framework control is genuinely inapplicable to
  the submitted trace (e.g., AAI05 when no network tools are called). It is not a gap;
  it reflects honest scoping.
- `not_evaluated` means the control is applicable but the tool lacks evidence to assess
  it — either because the trace does not contain the relevant event types, or because
  an engine module has not yet been wired to the compliance mapping.
- `partial` means the tool has some runtime evidence bearing on the control but the
  control is not fully satisfied from trace alone (organisational documentation also
  required, or coverage is below the threshold for `supported`).
- `supported` means the available runtime evidence is sufficient to support the
  control — not that the control is legally satisfied. Legal sufficiency always
  requires qualified human review. See [`docs/regulatory-disclaimer.md`](./regulatory-disclaimer.md).
