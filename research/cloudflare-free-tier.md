# Cloudflare free tier vs. the remote MCP + OAuth template

Research for issue #4. Checked 2026-10-29 against primary sources (Cloudflare docs, the template's source in `cloudflare/ai`, `cloudflare/workers-oauth-provider` docs, GitHub docs). Throwaway branch; never merged.

## Answer

- **Everything the template needs is on the Workers Free plan. Nothing it requires is paid-only.** A single-user app logging a few dozen Transactions a day uses well under 1% of every daily limit, so it stays at $0.
- **Nothing sleeps or gets deleted for inactivity.** No Cloudflare doc describes inactivity deletion for Workers, D1, KV or Durable Objects. What *does* expire is OAuth state: by default **the Claude connector has to sign in again every 30 days**, and an unused client registration expires after 90 days. Both can be configured (see below).
- **Going over a limit fails closed. It never bills you.** On Free, the over-limit operation type errors until 00:00 UTC. You are never charged automatically.
- **Main risk: the 10 ms CPU-per-request cap.** Check it during the throwaway deploy.

## What the template actually uses

Template: [`cloudflare/ai/demos/remote-mcp-github-oauth`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth). Its [`wrangler.jsonc`](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/wrangler.jsonc) and [`src/index.ts`](https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/index.ts) were read at commit `aa68bcf4` (2026-10-22).

| Piece | Binding | Needed by us? |
|---|---|---|
| Workers | the Worker itself | yes |
| KV | `OAUTH_KV`, used by `@cloudflare/workers-oauth-provider` for clients, grants and tokens | yes |
| Workers AI | `AI`, used only by the demo `generateImage` tool | no, drop it |
| Workers Logs | `observability.enabled: true` | optional |
| D1 | not in the template; we add it for Transactions | yes (ours) |
| Durable Objects | **none any more** | no |

**Important recent change:** on 2026-10-21 (commit `e1ff49d2`, "move every McpAgent demo to createMcpHandler") the demos moved from `McpAgent` (backed by Durable Objects) to the stateless `createMcpHandler`. The [Agents docs](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/) call `McpAgent` deprecated. They also say `createMcpHandler` does "not need a Durable Object, protocol session, or WebSocket" and builds a new server for each request. App data belongs in D1, KV, DO or R2. Older tutorials and blog posts that show `McpAgent` + `durable_objects` + `migrations` are out of date. If we ever did use a DO, it would still be free (see below).

Secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`) are Worker secrets and cost nothing.

## Free limits per service

All daily limits reset at 00:00 UTC.

### Workers ([limits](https://developers.cloudflare.com/workers/platform/limits/))

- 100,000 requests/day (account-wide).
- **10 ms CPU per HTTP request.** Waiting on fetch, KV or D1 doesn't count. The docs mention "some built-in flexibility" for occasional overruns, but give no number.
- 1 s startup (global scope parse) limit. 128 MB memory. 50 subrequests per invocation (1,000 to Cloudflare services). 64 MiB script. 100 Workers. 5 Cron Triggers.
- Over the limit: Error 1027 (or fail-open bypass on routes). `workers.dev` hosting is free.

### D1 ([pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/))

- 5,000,000 rows read/day. 100,000 rows written/day. 5 GB storage per account.
- 10 databases. 500 MB max per database. **50 queries per Worker invocation** (1,000 on Paid).
- Over the daily limit, queries return errors until reset (enforced since 2025-02-10, per the [D1 changelog](https://developers.cloudflare.com/d1/platform/changelog/)). Over the storage limit, writes and schema changes are blocked and nothing is deleted.
- **[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) works on Free:** it is always on with no setup and no cost, and gives **7 days** of point-in-time restore (30 on Paid). Restores overwrite the database in place. For longer history you'd export to R2 yourself.

### KV ([pricing](https://developers.cloudflare.com/kv/platform/pricing/))

- 100,000 reads/day. **1,000 writes/day**. 1,000 deletes/day. 1,000 lists/day. 1 GB stored.
- Only the over-limit operation type fails.

### Durable Objects ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/))

The current template doesn't need them. For reference:

- Available on Free, **SQLite-backed only** (the KV backend is Paid).
- 100,000 requests/day. 13,000 GB-s duration/day. 5M rows read/day. 100k rows written/day. 5 GB stored.
- Per-object storage on Free is either 1 GB or 10 GB; the limits page contradicts itself.

### Workers AI ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/))

10,000 Neurons/day free. Only the demo image tool uses it, so remove the binding.

### Workers Logs ([docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/))

200,000 events/day on Free, **kept for 3 days**.

## OAuth expiry (the real "expires on inactivity" item)

From [`workers-oauth-provider` docs](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md) and [storage schema](https://github.com/cloudflare/workers-oauth-provider/blob/main/storage-schema.md). All of this is stored in KV with TTLs.

- Access token: 1 hour by default, refreshed automatically by the client.
- **Grant / refresh token: by default it expires 30 days after sign-in, "however often it is refreshed".** So Claude would ask to reconnect (GitHub sign-in) about monthly. Setting `refreshTokenIdleTTL` makes it a sliding expiry instead (it lives while used and expires once idle). You can also raise `refreshTokenTTL`.
- Dynamically registered client (what Claude's connector uses): 90-day TTL (`clientRegistrationTTL`), renewed automatically while it keeps refreshing tokens. After a long break of not tracking (90+ days), Claude would have to re-register or reconnect. That's annoying, but no finance data is lost because the data lives in D1.
- Optional `purgeExpiredData()` cleanup needs a Cron Trigger. Free allows 5.

## Does a few dozen writes/day stay at $0?

Rough estimate for 50 Transactions/day plus some queries:

| Resource | Estimated daily use | Free limit | Share |
|---|---|---|---|
| Worker requests | ~500 (about 10 MCP POSTs per logged item) | 100,000 | <1% |
| D1 rows written | ~250 (row plus index writes) | 100,000 | <1% |
| D1 rows read | ~1M worst case (100 full scans of a 10k-row table) | 5,000,000 | ~20%; indexes cut this sharply |
| KV reads | ~500 (token lookup per request) | 100,000 | <1% |
| KV writes | <100 (token refreshes, sign-ins) | 1,000 | <10% |
| Storage | KBs to a few MB | 5 GB / 500 MB per DB | ~0% |

**Yes, it stays at $0 with a large margin.** The only line worth watching is D1 rows read, if Balance and total queries scan whole tables without indexes.

## Deploy from GitHub Actions

- This repo is **public**. GitHub says "The use of standard GitHub-hosted runners is free … in public repositories" ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). For comparison, private repos on GitHub Free get $12/month of compute (about 2,000 Linux minutes).
- [`cloudflare/wrangler-action@v4`](https://github.com/cloudflare/wrangler-action) is free and defaults to Wrangler v4. It needs a `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) repo secret.
- Alternative: Cloudflare's own [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) has a free tier of 3,000 build minutes/month, 1 concurrent build and a 20 min timeout.
- Watch out: GitHub disables *scheduled* (cron) workflows in public repos after 60 days without repo activity ([docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). A push-to-`main` deploy is unaffected.

## Open / uncertain

- **10 ms CPU per request** with MCP SDK v2, zod and the OAuth provider's AES-GCM work is not documented as safe or unsafe. Measure it on the throwaway deploy (`wrangler tail` / Workers Logs show CPU time).
- **D1's 50 queries per invocation:** a large Catch-up that writes many Estimates in one tool call should use `db.batch()`. I didn't confirm whether a batch counts as one query or as N toward this limit.
- **No documented inactivity policy** for Free accounts, in either direction. Absence of evidence, not a guarantee.
