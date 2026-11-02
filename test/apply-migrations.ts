import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";

await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);
