# finance-tracker

Chat-first personal finance tracker: the user logs and asks about money by chatting with Claude (claude.ai, mobile, desktop) through this remote MCP server. TypeScript on Cloudflare Workers + D1, OAuth via `@cloudflare/workers-oauth-provider`. One private deployment for its owner (ADR 0004); the code is open source to read and fork.

## Read first

- `GLOSSARY.md`: the domain language. Use its terms in code, tests, issues and chat copy (Transaction, Balance check, Estimate, Unaccounted, Gap, Catch-up), and avoid the synonyms it lists.
- `docs/adr/`: read the ADRs that touch the area you change, and flag any conflict with one explicitly. See `docs/agents/domain.md`.
- `README.md`: local dev, conversation tests, deploying, forking.

## Features → code

The MCP tool surface is five tools, defined (schemas and descriptions) in `src/tools.ts`:

| Feature | Tool | Code |
| --- | --- | --- |
| Overview, `today`, setup gate, Gap nudge | `finance_status` | `ledger.ts` (`status`, `setupNext`), `hints.ts` |
| Log Income, Spending, Transfers, Estimates, Balance checks | `finance_record` | `ledger.ts` (`record`) |
| Totals, Balances, entries | `finance_report` | `report.ts`, `queries.ts` |
| Undo, delete, edit | `finance_amend` | `ledger.ts` (`amend`) |
| Profile, Categories, rename Account, CSV export, setup Categories | `finance_manage` | `manage.ts`, `export.ts` |
| Sign-in and owner allowlist | — | `auth-handler.ts`, `utils.ts`, `index.ts` |

## Invariants

- **Derived, never stored.** Balances, Unaccounted, the unfilled part of Estimates and Gaps are computed from items on every read (`queries.ts`, ADR 0001). Add a query, never a cached column.
- **One `items` table.** `kind` says what an item is; a Balance check keeps its stated Balance in `amount`. `id` is the log sequence: same-date order is `(date, id)` (ADR 0002). Each `finance_record` call is one batch, and undo removes the latest batch.
- **Money and dates.** Amounts are integer minor units; dates are `YYYY-MM-DD` in the user's timezone, with no times (`format.ts`).
- **Scoped by user.** Every row carries `user_id` and every query filters on it, even with one user (ADR 0004). In `queries.ts`, `?1` is always the user id.
- **Tool text is the prompt.** claude.ai drops server `instructions`, and there is no claude.ai Skill (ADR 0003), so all model guidance lives in tool descriptions and tool results. In a result, `say` is user-facing copy Claude shows verbatim, and `next` steers Claude's next step; cross-tool scripts (setup, Catch-up, unknown Category or Account) live in `hints.ts`. Changing how a chat reads means changing these strings.
- **Setup gate.** Until setup is done, every tool result is followed by the current setup screen (`guarded` in `tools.ts`).
- **Categories are optional.** No Category means Uncategorized, counted as its own bucket. Accounts come into being only by a first Balance check and close by a Balance check of 0 with `close`.
- **Owner only.** The allowlist (`ALLOWED_USERS`) is checked at sign-in and again on every `/mcp` request (`index.ts`).

## Changing things

- **Schema**: add the next numbered file in `migrations/`; applied migrations are immutable. CI applies migrations before deploying.
- **`wrangler.jsonc`**: run `npm run cf-typegen` after editing. It holds the owner's deployment values (account, URL, allowlist, resource ids); deployment-specific values live there, and `src/` stays generic so forks only edit config.
- **Before pushing**: `npm run type-check` and `npm test` (CI runs both). A push to `main` deploys to production.
- **Tool descriptions, `say` or `next` changed**: drive a few turns through the conversation harness (`test/e2e/`, see README) and read how the chat comes out.
- **New term**: update `GLOSSARY.md`. **Hard-to-reverse, surprising trade-off**: write an ADR.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for DrawdEA/finance-tracker, via the `gh` CLI; this repo uses GitHub only, never work connectors (Linear, Slack, Notion). Planning runs as a wayfinder map on issue 1. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
