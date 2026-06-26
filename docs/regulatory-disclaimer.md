# Regulatory Disclaimer

OpenAgentAudit produces **technical evidence**. It does not provide legal
advice, regulatory certification, or a determination of compliance.

## Scope of this disclaimer

This disclaimer applies to:

- All generated audit reports.
- All regulatory profile mappings.
- All sample reports in `examples/`.
- All documentation that references regulations or standards.

## What we do

- Collect, validate, and normalize runtime evidence from AI agents.
- Apply documented audit tests against canonical evidence.
- Generate findings with severity rubrics, evidence references, and
  recommended remediation.
- Produce reports that **may** support specific documentation requirements
  of named frameworks.

## What we do not do

- We do not certify that any AI system complies with the EU AI Act, ISO/IEC
  42001, NIST AI RMF, OWASP guidance, or any other regulatory framework.
- We do not provide legal advice.
- We do not perform conformity assessments of the kind reserved for
  accredited third parties.
- We do not warrant that evidence collected with OpenAgentAudit will be
  accepted by any regulator, court, auditor, or counterparty.

## Regulatory landscape as of 2026-06-26

Regulatory interpretations evolve. Notable facts as of this writing:

- **EU AI Act.** Entered into force 2024-08-01; phased applicability with
  some high-risk provisions subject to political timetable adjustments.
  See the European Commission's regulatory framework page for the
  authoritative status.
- **ISO/IEC 42001:2023.** Management-system standard. Conformity is
  assessed by accredited third parties, not by software.
- **NIST AI RMF 1.0.** Voluntary framework. Alignment is descriptive.
- **OWASP Top 10 for Agentic Applications (2026).** Community guidance,
  non-binding.

Users are responsible for tracking the current status of any framework
they rely on.

## Required report language

Every generated report MUST include this disclaimer (or an equivalent that
preserves the same substance):

> This report provides technical evidence that may support selected
> regulatory documentation requirements. It does not constitute legal
> advice, regulatory certification, or a determination of compliance.
> Regulatory interpretations evolve; users are responsible for their own
> compliance posture.

Wording that overstates these claims is forbidden by
[`CONSTRAINTS.md`](../CONSTRAINTS.md) §1 and is rejected by
`scripts/verify-disclaimers.mjs`.

## Liability

OpenAgentAudit is licensed under Apache 2.0. The license disclaims
warranties to the maximum extent permitted by law. Users assume their
own risk for any compliance decisions made on the basis of OpenAgentAudit
output.
