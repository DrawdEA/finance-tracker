# finance-tracker

Chat-first personal finance tracker: log money by talking to Claude, through a remote MCP server on Cloudflare Workers + D1. A personal server for its owner only (ADR 0004): the code is open, the deployment is not. Domain language: [GLOSSARY.md](GLOSSARY.md); decisions: [docs/adr/](docs/adr/).

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in a GitHub OAuth app for http://localhost:8788/callback
npx wrangler d1 migrations apply DB --local
npm run dev                      # http://localhost:8788/mcp
```

### Conversation tests

`test/e2e/` runs the real tools locally for one fixed test user (no sign-in) and drives headless Claude against them, to check how chats actually read:

```bash
npx wrangler d1 migrations apply DB --local -c test/e2e/wrangler.jsonc
npx wrangler dev -c test/e2e/wrangler.jsonc        # http://localhost:8790/mcp
curl localhost:8790/reset                          # wipe the test user
python3 test/e2e/turn.py new "lunch 250 gcash"     # prints tool calls, say, reply, session id
python3 test/e2e/turn.py <session> "php, manila"   # next turn
test/e2e/call.sh finance_status '{}'               # one raw tool call
```

Run `npm run cf-typegen` after changing `wrangler.jsonc`, and `npm run type-check` before pushing.

## Deploying

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): type-check, apply D1 migrations (`migrations/`), then `wrangler deploy`. It needs the repo secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Workers KV Storage: Edit, on the account in `wrangler.jsonc`).

Worker secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`) live on the Worker, not in the repo; set them once with `wrangler secret put`.

New schema: add a numbered file to `migrations/`; CI applies it before the deploy.

## Sign-in

GitHub OAuth (callback `/callback`), limited to `ALLOWED_USERS` in `wrangler.jsonc` (comma-separated `provider:id`; the owner's numeric GitHub id).
