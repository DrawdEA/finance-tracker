// Local-only harness for conversation tests: the real tools for one fixed test user, no sign-in.
// Run with test/e2e/wrangler.jsonc; never deployed.
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { registerTools } from "../../src/tools";
import { upsertUser } from "../../src/utils";

let userId: number;

const mcpHandler = createMcpHandler(() => {
	const server = new McpServer({ name: "finance-tracker", version: "e2e" });
	registerTools(server, {
		db: env.DB,
		userId,
		defaults: { currency: env.DEFAULT_CURRENCY, timezone: env.DEFAULT_TIMEZONE },
		limiter: { limit: async () => ({ success: true }) } as RateLimit,
		signOut: async () => {},
		exportLink: async () => "https://example.com/export/test",
	});
	return server;
});

export default {
	async fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		userId ??= await upsertUser(env.DB, "e2e", "tester");
		if (new URL(request.url).pathname === "/reset") {
			await env.DB.batch([
				...["items", "batches", "categories", "accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId)),
				env.DB.prepare("UPDATE users SET currency = NULL, timezone = NULL, onboarded_at = NULL WHERE id = ?").bind(userId),
			]);
			return new Response("reset");
		}
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;
