import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { exportCsv, exportUserId } from "./export";
import { isAllowed, type Props, type Provider, upsertUser } from "./utils";
import {
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

type Upstream = {
	label: string;
	authorizeUrl: string;
	tokenUrl: string;
	scope: string;
	callback: string;
	clientId: () => string | undefined;
	clientSecret: () => string | undefined;
	/** The provider's immutable user id, from the token response. */
	subject: (token: Record<string, string>) => Promise<string>;
};

const UPSTREAMS: Record<Provider, Upstream> = {
	github: {
		label: "GitHub",
		authorizeUrl: "https://github.com/login/oauth/authorize",
		tokenUrl: "https://github.com/login/oauth/access_token",
		scope: "read:user",
		callback: "/callback",
		clientId: () => env.GITHUB_CLIENT_ID,
		clientSecret: () => env.GITHUB_CLIENT_SECRET,
		async subject(token) {
			const res = await fetch("https://api.github.com/user", {
				headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": "finance-tracker", Accept: "application/vnd.github+json" },
			});
			if (!res.ok) throw new Error(`GitHub user lookup failed: ${res.status}`);
			return String(((await res.json()) as { id: number }).id);
		},
	},
};

const enabled = () => (Object.keys(UPSTREAMS) as Provider[]).filter((p) => UPSTREAMS[p].clientId() && UPSTREAMS[p].clientSecret());

app.get("/export/:token", async (c) => {
	const userId = await exportUserId(c.env.OAUTH_KV, c.req.param("token"));
	if (!userId) return c.text("This export link has expired. Ask Claude for a new one.", 404);
	const csv = await exportCsv(c.env.DB, userId, { currency: c.env.DEFAULT_CURRENCY, timezone: c.env.DEFAULT_TIMEZONE });
	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="finance-tracker-${new Date().toISOString().slice(0, 10)}.csv"`,
			"Cache-Control": "no-store",
		},
	});
});

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	if (!oauthReqInfo.clientId) {
		return c.text("Invalid request", 400);
	}
	const { token: csrfToken, setCookie } = generateCSRFProtection();
	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId),
		csrfToken,
		providers: enabled().map((id) => ({ id, label: UPSTREAMS[id].label })),
		server: {
			description: "Personal finance tracker.",
			logo: `${new URL(c.req.url).origin}/favicon.ico`,
			name: "Finance Tracker",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();
		validateCSRFToken(formData, c.req.raw);

		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}
		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}
		if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
			return c.text("Invalid request", 400);
		}
		const provider = formData.get("provider") as Provider;
		if (!enabled().includes(provider)) {
			return c.text("Unknown sign-in provider", 400);
		}

		// Create OAuth state and bind it to this user's session
		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie } = await bindStateToSession(stateToken);
		const upstream = UPSTREAMS[provider];
		const location = new URL(upstream.authorizeUrl);
		location.searchParams.set("client_id", upstream.clientId()!);
		location.searchParams.set("redirect_uri", new URL(upstream.callback, c.req.url).href);
		location.searchParams.set("scope", upstream.scope);
		location.searchParams.set("state", stateToken);
		location.searchParams.set("response_type", "code");
		return new Response(null, { status: 302, headers: { Location: location.href, "Set-Cookie": setCookie } });
	} catch (error: any) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text(`Internal server error: ${error.message}`, 500);
	}
});

/**
 * OAuth callback from GitHub: exchange the code, look up the provider's
 * immutable user id, gate it, and hand the MCP client a token for our internal user.
 *
 * SECURITY: validateOAuthState checks the state is in KV (we created it) and matches
 * the __Host-CONSENTED_STATE cookie (this browser consented), so an attacker's state
 * token can't be injected into a victim's flow.
 */
for (const provider of Object.keys(UPSTREAMS) as Provider[]) {
	const upstream = UPSTREAMS[provider];
	app.get(upstream.callback, async (c) => {
		let oauthReqInfo: AuthRequest;
		let clearSessionCookie: string;
		try {
			const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
			oauthReqInfo = result.oauthReqInfo;
			clearSessionCookie = result.clearCookie;
		} catch (error: any) {
			if (error instanceof OAuthError) {
				return error.toResponse();
			}
			return c.text("Internal server error", 500);
		}
		if (!oauthReqInfo.clientId) {
			return c.text("Invalid OAuth request data", 400);
		}
		const code = c.req.query("code");
		if (!code || !enabled().includes(provider)) {
			return c.text("Sign-in was cancelled or failed.", 400);
		}

		const res = await fetch(upstream.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: new URLSearchParams({
				client_id: upstream.clientId()!,
				client_secret: upstream.clientSecret()!,
				code,
				grant_type: "authorization_code",
				redirect_uri: new URL(upstream.callback, c.req.url).href,
			}),
		});
		const token = (await res.json()) as Record<string, string>;
		if (!res.ok || token.error) {
			console.log(`${provider} token exchange failed`, token.error);
			return c.text("Sign-in failed; try again.", 502);
		}
		const subject = await upstream.subject(token);

		if (!isAllowed(c.env, `${provider}:${subject}`)) {
			return c.text("This is a personal server; only its owner can sign in.", 403);
		}
		const userId = await upsertUser(c.env.DB, provider, subject);

		const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
			metadata: { label: `${upstream.label} user` },
			// Available through getMcpAuthContext() in MCP handlers. Provider tokens are never kept.
			props: { userId, provider, subject } satisfies Props,
			request: oauthReqInfo,
			scope: oauthReqInfo.scope,
			userId: String(userId),
		});
		const headers = new Headers({ Location: redirectTo });
		if (clearSessionCookie) {
			headers.set("Set-Cookie", clearSessionCookie);
		}
		return new Response(null, { status: 302, headers });
	});
}

export { app as AuthHandler };
