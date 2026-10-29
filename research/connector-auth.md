# Connector auth: claude.ai custom connectors + Cloudflare MCP OAuth template (GitHub, DrawdEA only)

Research for #2. Sources checked 2026-10-29. Throwaway branch; never merged.

## Answer

- **Yes, it works across surfaces.** Add the Worker URL once as a custom connector on claude.ai (Customize > Connectors). The same connector and the same OAuth grant serve web, Desktop, iOS/Android and Claude Code (when Claude Code is logged in with the claude.ai account). [1][2][3]
- **Start from** `npm create cloudflare@latest -- finance-tracker --template=cloudflare/ai/demos/remote-mcp-github-oauth`. It uses `@cloudflare/workers-oauth-provider` ^1.2.4 with DCR at `/register`, which is what Claude needs. [4]
- **The template does not restrict sign-in.** Its `ALLOWED_USERNAMES` only hides one demo tool; any GitHub user can finish OAuth. Add a check in `/callback` that rejects every GitHub user id except `99942301` (DrawdEA) **before** `completeAuthorization()`. [5]
- **Set `refreshTokenIdleTTL`.** The provider's default grant lifetime is a fixed 30 days, after which you would have to reconnect every month. [6][7]

## How claude.ai authenticates to a remote MCP server

Anthropic's docs say one connector infrastructure backs claude.ai, Desktop, mobile, Cowork and Claude Code. [1][3]

- **Transport:** Streamable HTTP (legacy SSE also works). [1]
- **Auth spec versions:** 2025-03-26, 2025-06-18 and 2025-11-25. [1]
- **Sign-in start:** Claude needs a `401` carrying `WWW-Authenticate: Bearer resource_metadata="…"`. It ignores that header on a `200`. If the pointer is missing, it probes `/.well-known/oauth-protected-resource[/<path>]`. [3]
- **PRM `resource`** must equal the URL exactly as typed into Claude, path included. Claude uses only the first entry of `authorization_servers`. [3]
- **Client registration**, in the order Claude prefers:
  1. Claude's hosted CIMD, used only if the AS advertises `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`.
  2. DCR (RFC 7591) via `registration_endpoint`. This is the fallback.
  3. A client ID the user enters by hand.

  In the add dialog these are "Use Claude's published identity", "Register automatically" and "Use your own OAuth client". [3][2]
- **PKCE:** always S256. The AS should advertise `code_challenge_methods_supported: ["S256"]`. [3]
- **Scopes:** Claude takes them from `scope` on the 401, falling back to PRM `scopes_supported`. It appends `offline_access` only if the AS lists it. [3]
- **Redirect URIs:**
  - Hosted apps (web, Desktop, **mobile**, Cowork) use exactly `https://claude.ai/api/mcp/auth_callback`.
  - Claude Code, when added directly with `claude mcp add`, uses a loopback `http://localhost:<ephemeral>/callback` or `http://127.0.0.1:<ephemeral>/callback`, so the server must match it ignoring the port. [3]
- **Token endpoint:**
  - Must accept `application/x-www-form-urlencoded`.
  - Must return `invalid_grant` for a dead refresh token.
  - Must rotate refresh tokens, because DCR clients are public clients.
  - Claude refreshes on a `401`, and also proactively up to 5 minutes before expiry. [3]
- **Timeouts:** 10 s for discovery, registration and token endpoints; 30 s for refresh. [3]
- **Egress:** Anthropic connects from `160.79.104.0/21`, so a WAF must not block that range. [3]
- **Auth settings are frozen:** to change them you remove the connector and add it again. [2]
- **Tool limits on hosted apps:** about 150k characters per result and 240 s per call. [1]

### Where this leaves our two OAuth hops

```
Claude (claude.ai broker) --OAuth 2.1 + DCR + PKCE--> Worker (workers-oauth-provider = our AS + MCP resource)
Worker /authorize --OAuth--> GitHub (upstream IdP) --> Worker /callback --> completeAuthorization --> https://claude.ai/api/mcp/auth_callback
```

- **No claude.ai URL is registered at GitHub.** DCR registers `https://claude.ai/api/mcp/auth_callback` with our own provider automatically.
- **The GitHub OAuth App's callback is `https://<worker>/callback`.** [5]
- **Use a second GitHub OAuth App for local dev**, with callback `http://localhost:8788/callback`. [5]

## The template: `cloudflare/ai/demos/remote-mcp-github-oauth`

Last updated 2026-10-22. At that point it moved to `workers-oauth-provider` 1.2.4, MCP SDK v2 (`@modelcontextprotocol/server` 2.3.1) and a stateless `createMcpHandler` from `agents`, and gained the `MCP_RESOURCE` var. [4][8]

- **`src/index.ts`:**
  - Builds `new OAuthProvider({ apiRoute: "/mcp", apiHandler, authorizeEndpoint: "/authorize", tokenEndpoint: "/token", clientRegistrationEndpoint: "/register", defaultHandler: GitHubHandler, resourceMetadata: { resource: env.MCP_RESOURCE } })`.
  - DCR is on. CIMD is off (`clientIdMetadataDocumentEnabled` defaults to `false`).
  - Tools read the signed-in user with `getMcpAuthContext()?.props`. [5][6]
- **`src/github-handler.ts` (Hono app):**
  - `/authorize` shows a consent dialog, using CSRF tokens and an approved-client cookie.
  - It then redirects (302) to GitHub with `scope: "read:user"`.
  - `/callback` validates the state against KV plus a `__Host-` session-binding cookie, exchanges the code, calls `octokit.rest.users.getAuthenticated()`, then calls `completeAuthorization({ userId: login, props: { accessToken, email, login, name } })`. [5]
- **`wrangler.jsonc`:**
  - KV binding `OAUTH_KV` (`wrangler kv namespace create OAUTH_KV`).
  - Required secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`.
  - `vars.MCP_RESOURCE`, which must be set to the deployed `https://<name>.<sub>.workers.dev/mcp`. Every token is bound to it.
  - The `ai` binding is only for the demo image tool and can be deleted. [4]
- **Outdated README advice:** it says to connect Claude Desktop through `mcp-remote` in `claude_desktop_config.json`. Ignore that and add a custom connector on claude.ai instead. [4]

### Provider facts that matter (workers-oauth-provider)

| Fact | Detail | Source |
| --- | --- | --- |
| Access token TTL | 1 h by default | [7] |
| Grant lifetime | `refreshTokenTTL` is **30 days, absolute**, however often it is refreshed. Set `refreshTokenIdleTTL` (seconds) so the lifetime slides while in use | [6][7] |
| Refresh tokens | Rotate on use. The previous token stays valid until its replacement is first used, which satisfies Claude's rotation requirement | [6] |
| DCR clients | Expire after 90 days (`clientRegistrationTTL`), but are renewed whenever a token request comes after half that lifetime | [6] |
| Re-authorizing | `completeAuthorization()` revokes the same user's earlier grants for the same client and resource. Reconnecting does not pile up grants | [6] |
| Loopback redirects | Matching ignores the port for `localhost`, `127.0.0.0/8` and `::1` (RFC 8252 §7.3), so a direct `claude mcp add` loopback flow passes | [7] |
| Plain `http` | Accepted only on loopback, so `wrangler dev` on `localhost:8788` works | [6] |

## Restricting to DrawdEA only

The template's `ALLOWED_USERNAMES` only decides whether `generateImage` is registered. All GitHub users can authenticate and get the other tools. [5] For a single-user finance ledger:

1. **Gate in `/callback`.** Right after `getAuthenticated()`, if `user.data.id !== 99942301` (DrawdEA's immutable numeric id from `gh api users/DrawdEA`), return `403` and never call `completeAuthorization()`. No grant or token is ever issued to anyone else. Match on the numeric `id`, not `login`: logins can be renamed and the freed name reclaimed by someone else. Keep the id in a `vars` entry such as `ALLOWED_GITHUB_ID`.
2. **Defence in depth in `apiHandler`.** Refuse any request whose `props` id is not the allowed one, which covers grants minted before the gate existed.
3. **Trim props and scope.**
   - We don't call GitHub after sign-in, so drop `accessToken` from `props`; don't keep a GitHub token in KV.
   - `GET /user` works with an empty GitHub scope (public data only). `read:user` is harmless but unnecessary.
4. **Optional hardening.** Use `clientRegistrationCallback` to refuse DCR registrations whose `redirect_uris` aren't `https://claude.ai/api/mcp/auth_callback` or loopback. This is not required, because the GitHub id gate already decides who gets in. [6]

## Surfaces

| Surface | Works? | How | Source |
| --- | --- | --- | --- |
| claude.ai web | Yes | Customize > Connectors > Add custom connector. Choose "Register automatically" (DCR), or leave the default: CIMD falls back to DCR when it isn't advertised | [2][3] |
| Claude Desktop | Yes | Same account connector; nothing local | [9] |
| Claude iOS/Android | Yes, as a connector added on web or Desktop. A connected connector "is available in your conversations on the web, desktop, and mobile"; mobile supports remote connectors | [9] |
| Claude Code (terminal, IDE, cloud) | Yes, automatically, when logged in with the claude.ai subscription (not `ANTHROPIC_API_KEY`). It appears as `claude.ai <name>` in `/mcp`. Auth is done once on claude.ai, so the Worker never sees a loopback redirect | [10] |
| Claude Code via `claude mcp add --transport http <name> <url>/mcp` | Also works (DCR, loopback matching any port), but it is a separate grant and it hides the claude.ai connector for the same URL. Not needed | [10][7] |

## Gotchas

- **Mobile tool surfacing bugs.**
  - Custom OAuth connectors have had iOS-only failures where OAuth and `tools/list` succeed but no tools appear in mobile chat.
  - [#472](https://github.com/anthropics/claude-ai-mcp/issues/472) is closed (fixed in an app release).
  - [#893](https://github.com/anthropics/claude-ai-mcp/issues/893) (iOS, Aug 2026) is still open.
  - [#1087](https://github.com/anthropics/claude-ai-mcp/issues/1087): on iOS, the approval card offers only "Allow once", even when "Always allow" is saved.
  - Mitigation: set the tools to **Always allow** in the connector's Tool permissions on web, and test on the phone early (the throwaway deploy).
- **Avoid CIMD.**
  - Claude's CIMD document at `claude.ai/oauth/mcp-oauth-client-metadata` has returned Cloudflare bot challenges (403) to server-side fetches from datacenter IPs ([#650](https://github.com/anthropics/claude-ai-mcp/issues/650), open).
  - CIMD also needs the `global_fetch_strictly_public` flag.
  - Keep the template's DCR-only setup.
- **`MCP_RESOURCE` must match exactly.** Set it to the exact URL pasted into Claude (`https://…workers.dev/mcp`; trailing slash and path matter). A mismatch breaks token audience checks. [3][6]
- **Don't put a WAF or Cloudflare Access in front of the Worker.** Bot Fight Mode or Access can block Anthropic's egress or the broker. [#980](https://github.com/anthropics/claude-ai-mcp/issues/980) covers Cloudflare Access managed OAuth failing on claude.ai but working in Claude Code. [3]
- **Use 302 redirects.** claude.ai rejected 307 redirects on the OAuth callback hop ([#250](https://github.com/anthropics/claude-ai-mcp/issues/250)). The template already uses 302.
- **No MCP sessions to rely on.** claude.ai may open a new `Mcp-Session-Id` per tool call ([#583](https://github.com/anthropics/claude-ai-mcp/issues/583)). The template's stateless handler is the right shape; keep all state in D1.
- **Auth settings can't be edited.** Changing them means removing and re-adding the connector, then reconnecting. [2]
- **A 403 on `initialize` after a good OAuth flow is our bug, not Claude's.** That is how Anthropic closed [#582](https://github.com/anthropics/claude-ai-mcp/issues/582), a Workers + workers-oauth-provider + GitHub setup: its resource server rejected its own tokens. Check `MCP_RESOURCE` and audience first.
- **Spec drift.** workers-oauth-provider 1.2 targets MCP auth 2026-07-28, which deprecates DCR for new implementations. Claude documents support up to 2025-11-25 and still uses DCR. They interoperate today; recheck when upgrading either. [1][6]

## Uncertain / not verified

- **Not tested end to end.** Nobody has run the full flow on a real phone yet. Whether GitHub sign-in inside Claude mobile's in-app browser keeps an existing GitHub session (you may need to type your password and 2FA once) is not documented. The throwaway deploy should prove this.
- **Adding from mobile.** The current docs don't say whether a custom connector can be *added* from the mobile app, only that mobile uses remote connectors. Assume you add it on web or Desktop.

## Sources

1. Anthropic, Build an MCP server for Claude: https://claude.com/docs/connectors/building.md
2. Anthropic, Add a connector that isn't in the directory: https://claude.com/docs/connectors/custom/add-unlisted.md
3. Anthropic, Authentication for connectors: https://claude.com/docs/connectors/building/authentication.md
4. Cloudflare template README, package.json and wrangler.jsonc: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth
5. Template source: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/index.ts and https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/github-handler.ts
6. workers-oauth-provider, Authorization server reference: https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md
7. workers-oauth-provider source (`DEFAULT_*_TTL`, `isValidRedirectUri`): https://github.com/cloudflare/workers-oauth-provider/blob/main/src/oauth-provider.ts
8. Cloudflare, MCP authorization docs: https://developers.cloudflare.com/agents/model-context-protocol/authorization/
9. Anthropic, Get started with connectors ("Where connectors work"): https://claude.com/docs/connectors/overview.md
10. Claude Code, MCP ("Use MCP servers from claude.ai", OAuth flags): https://code.claude.com/docs/en/mcp
11. MCP authorization spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
