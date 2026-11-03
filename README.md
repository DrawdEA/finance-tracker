# Finance Tracker

Track your money by chatting with Claude. Say "lunch 250 gcash" or "how much did I spend this week?" in claude.ai, on your phone or on desktop, and a remote MCP server on Cloudflare Workers + D1 keeps the books.

It's built for the way tracking really goes: you forget for a week, then catch up with rough totals, and your Balances stay true anyway.

> **Status:** a personal server for its owner (ADR 0004). The code is open source (MIT) to read, learn from and fork; there's no hosted service to sign up for. Run your own copy with [Fork and deploy your own](#fork-and-deploy-your-own).

## Features

- **Log in plain words**: Spending, Income and Transfers between Accounts ("moved 2k BPI to GCash"), several in one message.
- **Accounts by Balance check**: tell it what an Account holds now ("GCash 4,750") and that's the Account set up. Later Balance checks re-anchor it, and any difference nothing explains shows as Unaccounted.
- **Catch-up**: after a Gap of 3+ days with nothing logged, it offers a two-minute Catch-up: current Balances, then Transfers and big one-offs, then rough Estimates for the rest. Items you log later fill in an Estimate instead of double counting.
- **Optional Categories**: start with a small starter set or none; add, rename or remove them in chat. Anything without a Category shows as Uncategorized.
- **Ask anything**: totals by Category, Account or month; Balances; finding past entries.
- **Fix mistakes**: "undo", delete, or edit any entry.
- **Guided setup**: three short steps on first use (currency and city, where your money sits, Categories).
- **Export**: a CSV of everything, through a download link that expires in 15 minutes.

Domain language is defined in [GLOSSARY.md](GLOSSARY.md), and design decisions are in [docs/adr/](docs/adr/).

## How it works

Claude connects to the server as a custom connector on claude.ai. Sign-in is GitHub OAuth, limited to an allowlist. The server exposes five tools (`finance_status`, `finance_record`, `finance_report`, `finance_amend`, `finance_manage`; see [src/tools.ts](src/tools.ts)). Their descriptions and results carry all the guidance Claude gets, since claude.ai doesn't pass server instructions to the model. Everything logged is one row in D1, and Balances are computed on read rather than stored.

## Fork and deploy your own

You need a Cloudflare account (the free tier is plenty), a GitHub account and a claude.ai account that can add custom connectors.

1. Fork the repo and clone it, then run `npm install`.
2. Create the storage and note the ids:
   ```bash
   npx wrangler d1 create finance-tracker
   npx wrangler kv namespace create OAUTH_KV
   ```
3. Edit `wrangler.jsonc` with your own values: `account_id`, the D1 `database_id`, the KV `id`, `MCP_RESOURCE` (`https://finance-tracker.<your-subdomain>.workers.dev/mcp`), `ALLOWED_USERS` (`github:<your numeric id>`, from `gh api users/<login> --jq .id`) and the default currency and timezone. Then run `npm run cf-typegen`.
4. Create a GitHub OAuth app with the callback `https://finance-tracker.<your-subdomain>.workers.dev/callback`, then set the Worker secrets:
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put COOKIE_ENCRYPTION_KEY   # e.g. openssl rand -hex 32
   ```
5. Add a repo secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Workers KV Storage: Edit) and push to `main`. CI deploys (see [Deploying](#deploying)).
6. On claude.ai, add a custom connector with your `MCP_RESOURCE` URL and sign in with GitHub. Connectors sync to the Claude mobile and desktop apps. Then say "set up my finance tracker".

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in a GitHub OAuth app for http://localhost:8788/callback
npx wrangler d1 migrations apply DB --local
npm run dev                      # http://localhost:8788/mcp
npm test                         # vitest in the Workers runtime
npm run type-check
```

Run `npm run cf-typegen` after changing `wrangler.jsonc`.

### Conversation tests

`test/e2e/` runs the real tools locally for one fixed test user (no sign-in) and drives headless Claude (the `claude` CLI) against them, to check how chats actually read:

```bash
npx wrangler d1 migrations apply DB --local -c test/e2e/wrangler.jsonc
npx wrangler dev -c test/e2e/wrangler.jsonc        # http://localhost:8790/mcp
curl localhost:8790/reset                          # wipe the test user
python3 test/e2e/turn.py new "lunch 250 gcash"     # prints tool calls, say, reply, session id
python3 test/e2e/turn.py <session> "php, manila"   # next turn
test/e2e/call.sh finance_status '{}'               # one raw tool call
```

## Deploying

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): type-check, tests, apply D1 migrations (`migrations/`), then `wrangler deploy`. Worker secrets live on the Worker, never in the repo. For a schema change, add the next numbered file to `migrations/`, and CI applies it before the deploy.

## Contributing

This is a solo project, but issues and ideas are welcome on [GitHub Issues](https://github.com/DrawdEA/finance-tracker/issues). For anything bigger than a small fix, open an issue before a pull request, since the design moves through decision records first. Use the terms in [GLOSSARY.md](GLOSSARY.md), and run `npm run type-check` and `npm test` before you push. [AGENTS.md](AGENTS.md) has the codebase's invariants, written for coding agents and just as useful for people.

Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## License

[MIT](LICENSE)
