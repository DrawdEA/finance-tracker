# finance-tracker

Chat-first personal finance tracker: log money by talking to Claude, through a remote MCP server on Cloudflare Workers + D1. Domain language: [GLOSSARY.md](GLOSSARY.md); decisions: [docs/adr/](docs/adr/).

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in a GitHub OAuth app for http://localhost:8788/callback
npx wrangler d1 migrations apply DB --local
npm run dev                      # http://localhost:8788/mcp
```

Run `npx wrangler types` after changing `wrangler.jsonc`, and `npm run type-check` before pushing.

## Deploying

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): type-check, apply D1 migrations (`migrations/`), then `wrangler deploy`. It needs the repo secret `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Workers KV Storage: Edit, on the account in `wrangler.jsonc`).

Worker secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`) live on the Worker, not in the repo; set them once with `wrangler secret put`.

New schema: add a numbered file to `migrations/`; CI applies it before the deploy.
