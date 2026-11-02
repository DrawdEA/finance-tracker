// Optional secret: Google sign-in stays off until it's set (wrangler types only sees required secrets).
declare namespace Cloudflare {
	interface Env {
		GOOGLE_CLIENT_SECRET?: string;
	}
}
