# Disclaimer — OpenAgentAudit v0.1

OpenAgentAudit provides **technical evidence** that may support selected
regulatory documentation requirements. It does **not** constitute legal
advice, regulatory certification, or a determination of compliance.

## What this specification provides

- A canonical evidence format for AI agent runtime traces.
- A finding schema with rubric-referenced severities.
- A reproducible bundle format for delivery to auditors and reviewers.
- Mappings from technical evidence to specific documentation requirements
  in OWASP, NIST, ISO, and EU AI Act materials.

## What this specification does not provide

- A legal determination that an AI system complies with any regulation.
- A binding interpretation of any regulation.
- A guarantee that evidence collected in this format will be accepted by
  any regulator, court, or auditor.
- A determination of contractual liability between parties.

## Regulatory landscape

Regulatory interpretations evolve. As of 2026-06-26:

- The EU AI Act is in phased rollout; certain high-risk provisions have
  been subject to political timetable adjustments.
- ISO/IEC 42001 is a management-system standard; conformity assessment is
  performed by certified third parties, not by tooling.
- NIST AI RMF 1.0 is a voluntary framework; alignment is descriptive,
  not certifiable.
- OWASP Top 10 for Agentic Applications is community-maintained guidance.

Users of OpenAgentAudit are responsible for their own legal and compliance
posture. The mappings in this specification are interpretive and are
provided for engineering convenience only.

## Recommended phrasing

Reports generated from OpenAgentAudit SHOULD use language such as:

- "Technical evidence support for [requirement]."
- "May support selected requirements of [standard]."
- "Not legal advice."
- "Not a determination of compliance."

Reports MUST NOT use language such as:

- "Certified compliant."
- "Regulator approved."
- "Guarantees compliance."
- "Satisfies the AI Act."

See [`CONSTRAINTS.md`](../../../CONSTRAINTS.md) §1 for the lint-enforced
phrasing list.
