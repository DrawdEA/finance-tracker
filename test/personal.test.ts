import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { record, status } from "../src/ledger";
import { identity, isAllowed, upsertUser } from "../src/utils";

const defaults = { currency: "PHP", timezone: "Asia/Manila" };
const check = (account: string, balance: number) => ({ kind: "balance_check" as const, account, balance });

describe("personal server (ADR 0004)", () => {
	it("lets in only the listed identities", () => {
		const config = { ALLOWED_USERS: "github:99942301" };
		expect(isAllowed(config, "github:99942301")).toBe(true);
		expect(isAllowed(config, "github:1")).toBe(false);
	});

	it("reads identities from old and new grants", () => {
		expect(identity({ githubId: 99942301 })).toBe("github:99942301");
		expect(identity({ provider: "github", subject: "99942301" })).toBe("github:99942301");
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
	it("walks the setup screens in order and finishes on setup_categories", async () => {
		const { setProfile, setupCategories } = await import("../src/manage");
		const { setupNext } = await import("../src/ledger");
		const user = await upsertUser(env.DB, "github", "onboarding-test");
		const screen = async () => (await setupNext(env.DB, user, defaults))?.say.split("\n").find((l) => l.startsWith("Step"));

		expect(await screen()).toBe("Step 1 of 3 · Currency and city");
		expect(await setupCategories(env.DB, user, defaults, "starter")).toMatchObject({ ok: false, error: expect.stringMatching(/currency and city.*Account/) });
		const logged = await record(env.DB, user, defaults, [{ kind: "spending", amount: 250, account: "GCash" }, check("GCash", 4500)]);
		expect(logged.ok && logged.say).toBe("✓ Spent ₱250 from GCash\n✓ Set up GCash: ₱4,500");
		expect(await screen()).toBe("Step 1 of 3 · Currency and city"); // path B logged first; profile still missing
		await setProfile(env.DB, user, defaults, { currency: "PHP", timezone: "Asia/Manila" });
		expect(await screen()).toBe("Step 3 of 3 · Categories");

		const done = await setupCategories(env.DB, user, defaults, "starter");
		expect(done.ok && done.say).toMatch(/^Categories added\. You're all set!.*What have you spent today\?$/s);
		expect(await setupNext(env.DB, user, defaults)).toBeUndefined();
		expect(await status(env.DB, user, defaults)).toMatchObject({
			data: { categories: { spending: ["Bills", "Food", "Fun", "Groceries", "Shopping", "Transport"], income: ["Salary"] } },
		});
	});

	it("adds several Categories in one call", async () => {
		const { addCategories } = await import("../src/manage");
		const user = await upsertUser(env.DB, "github", "batch-categories");
		expect(await addCategories(env.DB, user, { names: ["Food", "Transport", "food"], flow: "spending" })).toMatchObject({
			ok: true,
			summary: "Added Food, Transport (spending). Skipped: Food already exists.",
		});
	});
});
