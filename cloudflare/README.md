# Cloudflare staging API (isolated)

This is a **read-only staging skeleton**, not a deployed storyboard importer.

The existing Worker `flat-waterfall-436c` is not modified. This Worker intentionally refuses POST requests until authentication and persistence are built, so public visitors cannot replace another person's production data.

## Deployment checklist

1. Create a separate D1 database `animating-platform-staging` in Cloudflare.
2. Run `npx wrangler d1 execute animating-platform-staging --remote --file=cloudflare/schema.sql`.
3. Add its returned database UUID in `cloudflare/wrangler.toml`.
4. From the `cloudflare` directory, run `npx wrangler deploy`.
5. Check `/healthz` returns `ok: true` and `databaseConfigured: true`.
6. Before enabling writes or scanning, add user authentication, size-safe image ingestion, persistent image storage, rate limits, and a verified vision Worker API contract.
7. Configure the browser's API base URL and deploy a preview before switching public traffic.

**Limitations:** R2 is not enabled on the connected Cloudflare account. This code does not assume it is. Browser Pages testing cannot use the original Flask API until that API is ported. Japanese e-konte recognition has not yet been end-to-end tested.
