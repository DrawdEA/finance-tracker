import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { todayIn } from "../src/format";
import { record, setProfile, status } from "../src/ledger";
import { upsertUser } from "../src/utils";

const defaults = { currency: "PHP", timezone: "Asia/Manila" };
const today = todayIn(defaults.timezone);
let user: number;

beforeEach(async () => {
	user = await upsertUser(env.DB, "github", String(Math.random()));
});

const check = (account: string, balance: number, extra: { date?: string; close?: boolean } = {}) => ({
	kind: "balance_check" as const,
	account,
	balance,
	...extra,
});

async function overview() {
	const result = await status(env.DB, user, defaults);
	if (!result.ok) throw new Error(result.error);
	return result as typeof result & { data: { accounts: { name: string; balance: string }[]; closed_accounts: string[] } };
}

describe("first run", () => {
	it("asks for currency, city and Accounts on an empty deployment", async () => {
		const result = await overview();
		expect(result.summary).toBe("No Accounts yet.");
		expect(result.next).toMatch(/currency and city/);
	});

	it("skips the currency question once a profile is set", async () => {
		await setProfile(env.DB, user, defaults, { currency: "PHP", timezone: "Asia/Manila" });
		expect((await overview()).next).not.toMatch(/currency/);
	});

	it("sets up three Accounts in one call and explains how logging works", async () => {
		const result = await record(env.DB, user, defaults, [check("GCash", 4750), check("BPI", 20000), check("Cash", 800)]);
		expect(result).toMatchObject({ ok: true, summary: "Set up GCash ₱4,750 · set up BPI ₱20,000 · set up Cash ₱800" });
		expect(result.ok && result.ids).toHaveLength(3);
		expect(result.ok && result.next).toMatch(/at most 4 short bullets/);

		const after = await overview();
		expect(after.summary).toBe("3 Accounts, ₱25,550 in all.");
		expect(after.data.accounts.map((a) => `${a.name} ${a.balance}`)).toEqual(["BPI ₱20,000", "Cash ₱800", "GCash ₱4,750"]);
		expect(after.next).toBeUndefined();
	});
});

describe("Balance checks", () => {
	it("anchors the Balance on the latest check by date, then log order", async () => {
		await record(env.DB, user, defaults, [check("GCash", 1000, { date: "2026-01-01" })]);
		await record(env.DB, user, defaults, [check("gcash", 2000)]);
		await record(env.DB, user, defaults, [check("GCash", 1500, { date: "2026-01-05" })]);
		expect((await overview()).data.accounts).toEqual([{ name: "GCash", balance: "₱2,000", last_check: today }]);
	});

	it("matches Account names case-insensitively", async () => {
		await record(env.DB, user, defaults, [check("GCash", 1000)]);
		const result = await record(env.DB, user, defaults, [check("gcash", 900)]);
		expect(result).toMatchObject({ ok: true, summary: "Checked GCash ₱900" });
	});

	it("closes an Account only at zero, and a later check reopens it", async () => {
		await record(env.DB, user, defaults, [check("GoSave", 500, { date: "2026-01-01" })]);
		expect(await record(env.DB, user, defaults, [check("GoSave", 5, { close: true })])).toMatchObject({ ok: false });

		await record(env.DB, user, defaults, [check("GoSave", 0, { close: true, date: "2026-01-02" })]);
		expect((await overview()).data).toMatchObject({ accounts: [], closed_accounts: ["GoSave"] });

		await record(env.DB, user, defaults, [check("GoSave", 100)]);
		expect((await overview()).data).toMatchObject({ accounts: [{ name: "GoSave" }], closed_accounts: [] });
	});

	it("rejects the whole batch when any item is wrong, with a hint", async () => {
		const result = await record(env.DB, user, defaults, [check("GCash", 100), check("Visa", -5000)]);
		expect(result).toMatchObject({
			ok: false,
			error: "Nothing was saved.",
			problems: [{ item: 1, hint: expect.stringMatching(/Credit cards/) }],
		});
		expect((await overview()).data.accounts).toEqual([]);
	});

	it("rejects future dates, bad dates, and dates before an Account's setup", async () => {
		await record(env.DB, user, defaults, [check("GCash", 100, { date: "2026-03-01" })]);
		const result = await record(env.DB, user, defaults, [
			check("GCash", 100, { date: "2999-01-01" }),
			check("GCash", 100, { date: "yesterday" }),
			check("GCash", 100, { date: "2026-02-01" }),
			check("GCash", 1.234),
		]);
		expect(result.ok === false && result.problems?.map((p) => p.item)).toEqual([0, 1, 2, 3]);
	});

	it("keeps each user's Accounts separate", async () => {
		const other = await upsertUser(env.DB, "github", "someone-else");
		await record(env.DB, other, defaults, [check("GCash", 999)]);
		expect((await overview()).data.accounts).toEqual([]);
	});
});

describe("profile", () => {
	it("locks currency once anything is logged", async () => {
		expect(await setProfile(env.DB, user, defaults, { currency: "usd", timezone: "America/New_York" })).toMatchObject({ ok: true });
		await record(env.DB, user, defaults, [check("Chase", 100)]);
		expect(await setProfile(env.DB, user, defaults, { currency: "EUR" })).toMatchObject({ ok: false });
		expect(await setProfile(env.DB, user, defaults, { timezone: "Europe/London" })).toMatchObject({ ok: true });
		expect((await overview()).data.accounts).toEqual([{ name: "Chase", balance: "$100", last_check: expect.any(String) }]);
	});

	it("rejects unknown timezones and malformed currencies", async () => {
		expect(await setProfile(env.DB, user, defaults, { timezone: "Manila" })).toMatchObject({ ok: false });
		expect(await setProfile(env.DB, user, defaults, { currency: "pesos" })).toMatchObject({ ok: false });
	});
});
