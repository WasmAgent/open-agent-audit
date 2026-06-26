# Cloudflare Reference Configuration

This directory contains reference Cloudflare deployment artifacts.

| File | Purpose |
|---|---|
| `wrangler.example.jsonc` | Wrangler config skeleton with all bindings; uses placeholder IDs. |
| `d1-schema.sql` | Initial D1 schema (DDL only). |

## Using these files

These files are **reference artifacts**. They contain placeholder IDs
(e.g. `REPLACE_ME_D1_ID`). Real Cloudflare account / database IDs and
secrets live in the private companion repository `agentaudit-ops` and
are never committed here.

To deploy:

1. Copy `wrangler.example.jsonc` to `wrangler.jsonc` (gitignored).
2. Replace every `REPLACE_ME_*` placeholder with values from your
   Cloudflare dashboard.
3. Run `wrangler secret put <KEY>` for each secret; do not inline secrets
   into `wrangler.jsonc`.
4. Run `wrangler d1 execute oaa-meta --file=examples/cloudflare/d1-schema.sql`.

See `docs/cloudflare-native.md` for the full deployment model.
