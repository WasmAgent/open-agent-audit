# RFC 0003 — Cloudflare-Native Execution

- **Status:** Draft
- **Date:** 2026-06-26

## Summary

OpenAgentAudit's reference deployment is Cloudflare-only. This RFC records
the architectural commitment, the components used, and the constraints
on `packages/core` that make it feasible.

## Motivation

- The team has no GPU.
- The team prefers TypeScript / Bun over Python operationally.
- Cloudflare's product surface (Workers + Queues + DO + R2 + D1 +
  Workflows + Browser Run + Containers) covers every production need.
- A Cloudflare-only path eliminates VPS/Cloud Run/Kubernetes operational
  burden.

## Detailed design

See `docs/cloudflare-native.md`.

## Constraints on `packages/core`

`packages/core` MUST be Worker-compatible. It MUST NOT use:
- `node:fs`, `node:path`, `node:child_process`, `node:os`
- Native dependencies
- DB clients
- Cloudflare bindings directly (interfaces are injected)
- Node-only crypto

This is enforced by `CONSTRAINTS.md` §4.

## Containers as backstop

Cloudflare Containers are an opt-in path for jobs that exceed Worker
limits (very large contamination scans, complex PDF rendering). They are
not part of the MVP and do not pollute the default code path.

## Alternatives considered

- **Self-hosted Python service.** Rejected — operational burden, language
  split with WasmAgent ecosystem.
- **AWS Lambda + S3.** Rejected — adds a second cloud vendor, doesn't
  match Bun/Cloudflare workflow.
- **Local-only CLI, no cloud.** Rejected as the *only* path — the CLI is
  kept as a developer convenience but production is hosted.

## Open questions

- Whether to add a self-hostable Docker image as a third deployment
  target (not blocking MVP).
