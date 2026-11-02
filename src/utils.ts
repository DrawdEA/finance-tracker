export type Provider = "github";

// Context from the auth process, encrypted & stored in the auth token
// and provided to MCP handlers through getMcpAuthContext()
export type Props = {
	// Internal users.id; missing on grants issued before the users table existed.
	userId?: number;
	provider?: Provider;
	// The provider's immutable user id (GitHub's numeric id).
	subject?: string;
	// Older grants carry only this.
	githubId?: number;
};

/** "github:99942301" for a grant's props, old or new. */
export function identity(props: Props): string {
	return props.provider ? `${props.provider}:${props.subject}` : `github:${props.githubId}`;
}

/** Personal server (ADR 0004): only identities on ALLOWED_USERS (comma-separated "provider:id") get in. */
export function isAllowed(env: Pick<Env, "ALLOWED_USERS">, id: string): boolean {
	return env.ALLOWED_USERS.split(",").map((s) => s.trim()).includes(id);
}

/** Find or create the user for a sign-in identity and return its internal id. */
export async function upsertUser(db: D1Database, provider: string, providerUserId: string) {
	const row = await db
		.prepare(
			`INSERT INTO users (provider, provider_user_id) VALUES (?, ?)
			 ON CONFLICT (provider, provider_user_id) DO UPDATE SET provider = excluded.provider
			 RETURNING id`,
		)
		.bind(provider, providerUserId)
		.first<{ id: number }>();
	return row!.id;
}
