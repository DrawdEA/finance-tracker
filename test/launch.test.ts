import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ITEM_CAP, record, status } from "../src/ledger";
import { deleteAccount } from "../src/manage";
import { throttled } from "../src/tools";
import { identity, isAllowed, upsertUser } from "../src/utils";

const defaults = { currency: "PHP", timezone: "Asia/Manila" };
const check = (account: string, balance: number) => ({ kind: "balance_check" as const, account, balance });

describe("delete_account (#22)", () => {
	it("needs an explicit confirm, then leaves nothing for that user and signs them out", async () => {
		const user = await upsertUser(env.DB, "google", "sub-1");
		const other = await upsertUser(env.DB, "google", "sub-2");
		await record(env.DB, user, defaults, [check("GCash", 100)]);
		await record(env.DB, other, defaults, [check("GCash", 100)]);
		let signedOut = false;
		const signOut = async () => {
			signedOut = true;
		};

		const warning = await deleteAccount(env.DB, user, undefined, signOut);
		expect(warning).toMatchObject({ ok: false, hint: expect.stringMatching(/1 logged items across 1 Accounts.*confirm: "DELETE"/) });
		expect(signedOut).toBe(false);

		expect(await deleteAccount(env.DB, user, "DELETE", signOut)).toMatchObject({ ok: true });
		expect(signedOut).toBe(true);
		for (const table of ["items", "batches", "categories", "accounts"]) {
			const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).bind(user).first<{ n: number }>();
			expect(row!.n, table).toBe(0);
		}
		expect(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(user).first()).toBeNull();
		expect(await status(env.DB, other, defaults)).toMatchObject({ summary: "1 Account, ₱100 in all." });
	});

	it("serves the privacy note", async () => {
		const res = await SELF.fetch("https://example.com/privacy");
		expect(res.status).toBe(200);
		expect(await res.text()).toMatch(/delete your finance tracker account/);
	});
});

describe("sign-up and abuse limits (#21)", () => {
	it("allows only listed identities until sign-up opens", () => {
		const config = { SIGNUP: "allowlist", ALLOWED_USERS: "github:99942301, google:abc" };
		expect(isAllowed(config, "github:99942301")).toBe(true);
		expect(isAllowed(config, "google:abc")).toBe(true);
		expect(isAllowed(config, "github:1")).toBe(false);
		expect(isAllowed({ ...config, SIGNUP: "open" }, "github:1")).toBe(true);
	});

	it("reads identities from old and new grants", () => {
		expect(identity({ githubId: 99942301 })).toBe("github:99942301");
		expect(identity({ provider: "google", subject: "abc" })).toBe("google:abc");
	});

	it("throttles one user without touching others", async () => {
		const counts = new Map<string, number>();
		const limiter = {
			limit: async ({ key }: { key: string }) => {
				counts.set(key, (counts.get(key) ?? 0) + 1);
				return { success: counts.get(key)! <= 60 };
			},
		} as RateLimit;
		const run = async () => ({ ok: true as const, summary: "ran" });
		for (let i = 0; i < 60; i++) await throttled(limiter, 1, run);
		expect(await throttled(limiter, 1, run)).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
		expect(await throttled(limiter, 2, run)).toMatchObject({ ok: true });
	});

	it("refuses to log past the storage cap", async () => {
		const user = await upsertUser(env.DB, "github", "cap-test");
		await record(env.DB, user, defaults, [check("GCash", 100)]);
		await env.DB.prepare(
			`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2)
			INSERT INTO items (user_id, batch_id, kind, date, amount, account_id)
			SELECT ?1, batch_id, 'spending', date, 1, account_id FROM n, (SELECT batch_id, date, account_id FROM items WHERE user_id = ?1 LIMIT 1)`,
		)
			.bind(user, ITEM_CAP - 1)
			.run();
		expect(await record(env.DB, user, defaults, [check("GCash", 5)])).toMatchObject({ ok: false, error: expect.stringMatching(/limit of 50,000/) });
	});
});

describe("export (#24)", () => {
	it("serves one CSV of everything through a short-lived link", async () => {
		const { createExportLink } = await import("../src/export");
		const user = await upsertUser(env.DB, "github", "export-test");
		await record(env.DB, user, defaults, [check("GCash", 100), { kind: "spending", amount: 12.5, account: "GCash", note: 'Jollibee, "large"' }]);
		const link = await createExportLink(env.OAUTH_KV, user, "https://example.com");
		const res = await SELF.fetch(link);
		expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
		const rows = (await res.text()).trim().split("\r\n");
		expect(rows[0]).toBe("id,kind,date,start_date,amount,currency,flow,account,to_account,category,note,closes_account");
		expect(rows).toHaveLength(3);
		expect(rows[2]).toMatch(/,spending,.*,12\.50,PHP,,GCash,,,"Jollibee, ""large""",$/);
		expect((await SELF.fetch("https://example.com/export/nope")).status).toBe(404);
	});
});

describe("guided onboarding", () => {
	it("sends every finance call back to setup until complete_setup", async () => {
		const { setProfile, addCategories, completeSetup } = await import("../src/manage");
		const { setupNext } = await import("../src/ledger");
		const user = await upsertUser(env.DB, "github", "onboarding-test");
		const step = () => setupNext(env.DB, user, defaults);

		expect(await step()).toMatch(/before anything else.*Step 1 of 5/);
		expect(await completeSetup(env.DB, user, defaults)).toMatchObject({ ok: false, error: expect.stringMatching(/currency and city.*Account/) });
		await record(env.DB, user, defaults, [{ kind: "spending", amount: 250, account: "GCash" }, check("GCash", 4500)]);
		expect(await step()).toMatch(/Step 1 of 5/); // path B logged first; profile still missing
		await setProfile(env.DB, user, defaults, { currency: "PHP", timezone: "Asia/Manila" });
		expect(await step()).toMatch(/besides GCash.*Step 4 of 5/);
		expect(await addCategories(env.DB, user, { names: ["Food", "Transport", "food"], flow: "spending" })).toMatchObject({
			ok: true,
			summary: "Added Food, Transport (spending). Skipped: Food already exists.",
		});
		expect(await completeSetup(env.DB, user, defaults)).toMatchObject({ ok: true, summary: "Setup complete." });
		expect(await step()).toBeUndefined();
	});
});
