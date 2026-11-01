import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { type Props, upsertUser } from "./utils";

function createServer() {
	const server = new McpServer({
		name: "finance-tracker",
		version: "0.0.1",
	});
	const props = getMcpAuthContext()?.props as Props | undefined;

	server.registerTool(
		"echo",
		{
			description:
				"Echo a message back from the finance tracker server, with the signed-in GitHub login and server time. Use to test the connector.",
			inputSchema: z.object({ message: z.string() }),
		},
		async ({ message }) => ({
			content: [
				{
					text: `echo: ${message}\nuser: ${props?.login} (#${props?.userId})\nserver time: ${new Date().toISOString()}`,
					type: "text",
				},
			],
		}),
	);

	return server;
}

const mcpHandler = createMcpHandler(createServer);
const apiHandler = {
	async fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		// Re-check the allowlist on every MCP request, not just at sign-in.
		const props = (ctx as ExecutionContext & { props?: Props }).props;
		if (!props || String(props.githubId) !== env.ALLOWED_GITHUB_ID) {
			return new Response("Forbidden", { status: 403 });
		}
		// Grants from before the users table carry no userId; resolve it here.
		props.userId ??= await upsertUser(env.DB, "github", String(props.githubId));
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

export default new OAuthProvider<Env>({
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
	// The URL MCP clients connect to. Every token is bound to it.
	resourceMetadata: { resource: env.MCP_RESOURCE },
	// Sliding expiry: the grant lives while used and ends after 90 idle days.
	refreshTokenIdleTTL: 90 * 24 * 60 * 60,
});
