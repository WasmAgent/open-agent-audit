# EvidenceBundle — v0.1

An `EvidenceBundle` is a reproducible packaged delivery containing every
artifact required to defend an audit conclusion to an external reviewer.

## Bundle layout

A bundle is a single zip or tar.gz archive with the following entries:

```
evidence-bundle.zip
├── manifest.json                 # required
├── audit-run.json                # required, conforms to audit-run.schema.json
├── events.jsonl                  # required, canonical events
├── findings.json                 # required, array of Finding
├── risk-score.json               # required, conforms to risk-score.schema.json
├── report/                       # optional
│   ├── audit-report.md
│   ├── audit-report.html
│   └── audit-report.pdf
├── capability-manifest.json      # optional, snapshot at audit time
├── profiles/                     # optional, snapshot of profiles used
│   ├── owasp-agentic-top10-2026.yaml
│   └── ...
└── manifest.sig                  # optional detached signature over manifest.json
```

## Manifest

`manifest.json` describes every file and its content hash.

```json
{
  "schema_version": "open-agent-audit/v0.1",
  "bundle_id": "bdl_2026_06_26_001",
  "run_id": "run_abc",
  "generated_at": "2026-06-26T12:00:00Z",
  "engine_version": "@openagentaudit/core@0.1.0",
  "spec_version": "open-agent-audit/v0.1",
  "files": [
    {
      "path": "audit-run.json",
      "sha256": "ab12...",
      "size_bytes": 5421
    },
    {
      "path": "events.jsonl",
      "sha256": "cd34...",
      "size_bytes": 184221
    }
  ],
  "signer_key_id": "oaa-pilot-1",
  "signature_algorithm": "ed25519"
}
```

## Reproducibility requirement

Re-running the audit engine on the same `events.jsonl` with the same
profile versions and the same engine version MUST produce findings with
identical IDs and identical severities.

Findings IDs that depend on the run timestamp or random salting are
non-conformant.

## Signature

If `manifest.sig` is present, it MUST be a detached signature of
`manifest.json` produced with the algorithm declared in
`manifest.signature_algorithm`. Verifiers MUST verify the signature
before trusting any file hash.

## Tamper detection

A bundle is considered tampered if:

1. Any file's actual sha256 does not match its declared hash.
2. The manifest signature does not verify.
3. The hash chain in `events.jsonl` (when `evidence.prev_hash` is present)
   is broken.

Tampered bundles MUST NOT be accepted as audit evidence. The audit engine
SHOULD record a high-severity finding documenting the tamper detection.
