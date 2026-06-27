# Competitive Landscape — AI Agent Audit and Compliance Tools

> **Research date:** 2026-06-27  
> **Method:** Multi-source web research with adversarial claim verification (110 sub-agents,
> 1 630 tool uses, 3-vote consensus per factual claim).  
> **Scope:** Commercial and open-source tools that generate compliance reports or runtime
> detections for AI agent systems, assessed against four frameworks: OWASP Agentic Top 10,
> EU AI Act Annex IV, NIST AI RMF 1.0, ISO/IEC 42001:2023.

---

## Summary finding

As of mid-2026, **no commercial or open-source tool combines all four properties** of
OpenAgentAudit:

1. Runtime trace evidence ingestion (OTel/AEP canonical events)
2. Multi-framework coverage spanning OWASP Agentic Top 10 + EU AI Act + NIST AI RMF + ISO 42001
3. Agentic-AI-specific controls (tool calls, multi-agent delegation, signed evidence chains)
4. Automated human-readable compliance report generation from those traces

The market divides into three distinct product categories, none of which occupies this
intersection.

---

## Category 1 — GRC questionnaire / policy-document platforms

These tools generate compliance reports, but from questionnaires and manually declared
metrics — not from runtime agent traces. They cannot produce evidence that links a specific
tool call or policy decision to a regulatory control.

### VerifyWise *(open-source)*

- **Frameworks:** EU AI Act, ISO 42001, NIST AI RMF, ISO 27001
- **Approach:** AI-generated answers to compliance assessment questions; policy manager;
  evidence folder structure for document upload
- **Agentic AI:** Has an AIGateway component that proxies MCP tool calls, but no
  general-purpose OTel/AEP trace ingestion pipeline
- **Report type:** Questionnaire-driven compliance posture report
- **Source:** `github.com/verifywise-ai/verifywise`

### EuConform *(open-source)*

- **Frameworks:** EU AI Act only (Art. 5, 6, 9–15, Annex IV partial)
- **Approach:** Static source code scan + interactive risk-classification quiz
- **Agentic AI:** None — no runtime trace, OTel, or AEP references in codebase
- **Report type:** Risk classification output from questionnaire
- **Source:** `github.com/Hiepler/EuConform`

### GapSight *(open-source)*

- **Frameworks:** EU AI Act, NIST AI RMF, ISO 42001
- **Approach:** Developer declares accuracy/fairness/robustness scalars in a JSON file;
  tool maps those scalars to framework requirements
- **Agentic AI:** None — inputs are manually declared metrics, not agent trace events
- **Report type:** Self-assessment summary; README explicitly states this is *not* an
  "audit-ready report generator or compliance platform"
- **Source:** `github.com/mmilovanovic87/gapsight`

### Credo AI *(commercial)*

- **Frameworks:** EU AI Act, NIST AI RMF, ISO 42001, and others
- **Approach:** Policy Center with assessment modules; some model evaluation metrics
  can be collected programmatically
- **Agentic AI:** LLM evaluation integrations; no agentic tool-call trace ingestion
- **Report type:** Compliance posture dashboard and policy evidence packages

### Holistic AI *(commercial)*

- **Frameworks:** EU AI Act, NIST AI RMF
- **Approach:** Risk questionnaire, model cards, bias/robustness audits
- **Agentic AI:** Has a Safeguard runtime component; does not produce compliance reports
  from runtime traces
- **Report type:** Risk assessment report; Safeguard produces runtime alerts, not reports

---

## Category 2 — External adversarial probe tools

These tools test AI systems from the outside, as an attacker would. They do not ingest
runtime traces from a running agent — they probe endpoints and judge responses.

### Argus *(open-source, created 2026-05)*

- **Frameworks:** OWASP LLM Top 10, MITRE ATLAS, NIST AI RMF (as probe targets)
- **Approach:** 167 YAML-defined attack prompts sent to a target agent endpoint over
  HTTP/gRPC; response judged by LLM-as-judge
- **Agentic AI:** Tests agents as black boxes; README explicitly states "does not run
  inside the target's runtime" and lists this as a design goal
- **Report type:** Probe results; not a regulatory compliance report
- **Source:** `github.com/gy15901580825/Argus`

### Protect AI / Lakera / HiddenLayer / Robust Intelligence *(commercial)*

- **Frameworks:** OWASP LLM Top 10 (Protect AI, Lakera), MITRE ATLAS (HiddenLayer),
  NIST AI RMF partial (Robust Intelligence / Cisco)
- **Approach:** Prompt injection detection, model scanning, adversarial robustness testing
- **Agentic AI:** Some LangChain integrations; no agentic trace ingestion or
  multi-framework compliance reports

---

## Category 3 — Runtime detection engines

These tools evaluate rules against live agent events. Closest to OpenAgentAudit in
technical architecture, but their output is threat detections, not compliance reports.

### Agent Threat Rules (ATR) *(open-source, created 2026-06)*

The most technically similar open-source project to OpenAgentAudit's detection layer.

- **Frameworks:** OWASP Agentic Top 10 (10/10 categories, 866 rule mappings across
  652 tagged rules), NIST AI RMF (4/4 functions)
- **Approach:** Rules evaluate against live runtime agent events — `llm_io`, `tool_call`,
  `tool_response`, `mcp_exchange` — in real time
- **Agentic AI:** ✅ Native — purpose-built for tool calls, MCP exchanges, multi-agent
  communication
- **Output format:** SARIF (threat detections); **not** a regulatory compliance report
- **Missing:** EU AI Act Annex IV, ISO 42001, signed evidence chains, report rendering
- **Source:** `github.com/Agent-Threat-Rule/agent-threat-rules`

**Relationship to OpenAgentAudit:** Complementary, not competitive. ATR detects threats
in real time; OpenAgentAudit produces post-run audit evidence and compliance reports.
An ATR integration adapter would be a high-value addition — ATR findings could flow
into OAA `observation` events and strengthen OWASP/NIST coverage.

### Asqav SDK *(open-source)*

A cryptographic signing SDK for agentic tool calls — infrastructure rather than a
compliance tool.

- **Approach:** ML-DSA-65 (FIPS 204) signing of individual tool calls; counterparty
  acknowledgment protocol (`protectmcp:acknowledgment`) that cryptographically binds
  one agent's action to a downstream agent's action in multi-agent handoffs
- **Adapters:** OpenAI Agents SDK (`AsqavOpenAIAgentsAdapter`); multi-agent chain signing
- **Output:** Signed tool-call records; no compliance report generation
- **Relationship to OpenAgentAudit:** Potential evidence source — Asqav-signed records
  could be adapted into AEP-compatible canonical events via a new adapter, providing
  an alternative to `@wasmagent/aep` for OpenAI-native agent stacks

---

## Comparative matrix

| Capability | OpenAgentAudit | ATR | VerifyWise | Credo AI | Argus |
|---|---|---|---|---|---|
| OTel / AEP trace ingestion | ✅ | ✅ | ❌ | partial | ❌ |
| EU AI Act Annex IV | ✅ 12 controls | ❌ | ✅ (questionnaire) | ✅ (questionnaire) | ❌ |
| NIST AI RMF | ✅ 12 subcategories | ✅ (rules) | ✅ (questionnaire) | ✅ (questionnaire) | probe target |
| OWASP Agentic Top 10 | ✅ AAI01–10 | ✅ 10/10 | ❌ | ❌ | ❌ |
| ISO/IEC 42001 | ✅ 12 controls | ❌ | ✅ (questionnaire) | ✅ (questionnaire) | ❌ |
| Multi-framework in one report | ✅ | ❌ | ✅ (questionnaire) | ✅ (questionnaire) | ❌ |
| Generates Md / HTML / JSON report | ✅ | ❌ (SARIF) | ✅ | ✅ | ❌ |
| Multi-agent delegation chain | ✅ AEP `delegation_chain` | ❌ | ❌ | ❌ | ❌ |
| Ed25519 signed evidence chain | ✅ | ❌ | ❌ | ❌ | ❌ |
| Evidence links control to specific event | ✅ | ✅ (rule → event) | ❌ | ❌ | ❌ |
| Fully open-source | ✅ | ✅ | ✅ | ❌ | ✅ |
| Cloudflare-native deployment | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Market positioning

**OpenAgentAudit occupies an unoccupied position** in the verified open-source and
commercial landscape. The two closest competitors address adjacent — not identical —
problems:

- **ATR** does what OpenAgentAudit's policy-audit engine does (real-time rule evaluation
  against agent events), but stops at threat detection. It does not produce EU AI Act
  or ISO 42001 evidence, does not chain events into a tamper-evident record, and does
  not render a report a compliance officer can deliver to an auditor.

- **Commercial GRC platforms (Credo AI, Holistic AI, VerifyWise)** produce the same
  *type* of output (compliance reports) but use questionnaire input, not runtime trace
  evidence. Their reports say "the organisation declared X" rather than "event
  evt_109 at 2026-06-27T12:13:21Z proves X with an Ed25519 signature."

The fundamental distinction is **evidence quality**. Runtime trace evidence backed by
cryptographic integrity is what makes a report defensible to an external technical
auditor or regulator. Questionnaire-based reports are defensible only as policy
declarations — they cannot prove what the system *actually did*.

---

## Implications for OpenAgentAudit roadmap

Three actionable signals from this research:

**1. ATR integration adapter** — An `atr` adapter that ingests ATR SARIF output as
OAA `observation` events would combine ATR's 652 rules with OAA's report rendering
and EU AI Act / ISO 42001 coverage. ATR would become a detection upstream; OAA would
become the compliance reporting downstream.

**2. Asqav adapter** — An `asqav` adapter for the OpenAI Agents SDK ecosystem would
allow OAA to serve stacks that use ML-DSA-65 signing instead of Ed25519/AEP. Asqav's
multi-agent handoff protocol already produces the cryptographic binding OAA needs for
multi-agent delegation chain evidence.

**3. The "trace → report" gap is the market gap** — Commercial GRC platforms have the
enterprise distribution and the compliance officer relationships. They lack the runtime
trace evidence layer. A partnership or integration path (OAA as the evidence backend
for a GRC platform's EU AI Act module) is more likely than direct competition.

---

## Disclaimer

This analysis is based on publicly available information as of 2026-06-27. Product
capabilities change frequently; verify current feature sets directly with vendors.
This document does not constitute investment advice or a procurement recommendation.
See [`docs/regulatory-disclaimer.md`](./regulatory-disclaimer.md) for OpenAgentAudit's
general disclaimer on regulatory interpretations.
