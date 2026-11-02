import { env } from "cloudflare:workers";
import OAuthProvider, { getOAuthApi, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { AuthHandler } from "./auth-handler";
import { registerTools } from "./tools";
import { identity, isAllowed, type Props, upsertUser } from "./utils";

function createServer() {
	const server = new McpServer({
		name: "finance-tracker",
		version: "0.2.0",
	});
	// apiHandler guarantees props and props.userId before this runs.
	const props = getMcpAuthContext()?.props as Props;
	const userId = props.userId!;
	registerTools(server, {
		db: env.DB,
		userId,
		defaults: { currency: env.DEFAULT_CURRENCY, timezone: env.DEFAULT_TIMEZONE },
		limiter: env.RATE_LIMITER,
		signOut: async () => {
			const oauth = getOAuthApi(options, env);
			const { items } = await oauth.listUserGrants(String(userId));
			await Promise.all(items.map((grant) => oauth.revokeGrant(grant.id, String(userId))));
		},
	});
	return server;
}

const mcpHandler = createMcpHandler(createServer);
const apiHandler = {
	async fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		// Re-check the allowlist on every MCP request, not just at sign-in.
		const props = (ctx as ExecutionContext & { props?: Props }).props;
		if (!props || !isAllowed(env, identity(props))) {
			return new Response("Forbidden", { status: 403 });
		}
		// Grants from before the users table carry no userId; resolve it here.
		props.userId ??= await upsertUser(env.DB, "github", String(props.githubId));
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

const options: OAuthProviderOptions<Env> = {
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: AuthHandler as any,
	tokenEndpoint: "/token",
	// The URL MCP clients connect to. Every token is bound to it.
	resourceMetadata: { resource: env.MCP_RESOURCE },
	// Sliding expiry: the grant lives while used and ends after 90 idle days.
	refreshTokenIdleTTL: 90 * 24 * 60 * 60,
};

export default new OAuthProvider<Env>(options);
