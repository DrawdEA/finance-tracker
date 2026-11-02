import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIn } from "../src/format";
import { amend, type ItemInput, type Result, record, status } from "../src/ledger";
import { addCategory, removeCategory, renameAccount, renameCategory, setProfile, setupCategories } from "../src/manage";
import { report } from "../src/report";
import { upsertUser } from "../src/utils";

const defaults = { currency: "PHP", timezone: "Asia/Manila" };
const today = todayIn(defaults.timezone);
let user: number;

beforeEach(async () => {
	user = await upsertUser(env.DB, "github", String(Math.random()));
});

const log = (...items: ItemInput[]) => record(env.DB, user, defaults, items);
const check = (account: string, balance: number, date?: string): ItemInput => ({ kind: "balance_check", account, balance, date });
const spend = (amount: number, account: string, extra: { date?: string; category?: string; note?: string } = {}): ItemInput => ({
	kind: "spending",
	amount,
	account,
	...extra,
});

function ok(result: Result) {
	if (!result.ok) throw new Error(JSON.stringify(result));
	return result as Extract<Result, { ok: true }> & { data: any };
}

async function balanceOf(name: string) {
	const { data } = ok(await status(env.DB, user, defaults));
	return data.accounts.find((a: { name: string }) => a.name === name)?.balance;
}

describe("Income, Spending and Transfers (#13)", () => {
	it('"lunch 250 gcash" lowers GCash by 250', async () => {
		await log(check("GCash", 4750));
		const result = ok(await log(spend(250, "gcash", { note: "lunch" })));
		expect(result.summary).toBe('Spent ₱250 from GCash ("lunch") · Now: GCash ₱4,500');
		expect(await balanceOf("GCash")).toBe("₱4,500");
	});

	it("path B: Spending, then a first Balance check, in one batch", async () => {
		ok(await log(spend(250, "GCash"), check("GCash", 4500)));
		expect(await balanceOf("GCash")).toBe("₱4,500");
	});

	it("a Transfer moves Balance and isn't Income or Spending", async () => {
		await log(check("BPI", 20000), check("GCash", 1000));
		await log({ kind: "transfer", amount: 2000, from: "BPI", to: "GCash" });
		expect(await balanceOf("BPI")).toBe("₱18,000");
		expect(await balanceOf("GCash")).toBe("₱3,000");
		const totals = ok(await report(env.DB, user, defaults, { view: "totals", from: today, to: today }));
		expect(totals.summary).toMatch(/spent ₱0, received ₱0/);
	});

	it("rejects unknown Accounts and Categories, wrong flows and same-Account Transfers, with hints", async () => {
		await log(check("GCash", 100));
		await addCategory(env.DB, user, { name: "Salary", flow: "income" });
		const result = await log(
			spend(10, "Maya"),
			spend(10, "GCash", { category: "Food" }),
			spend(10, "GCash", { category: "salary" }),
			{ kind: "transfer", amount: 5, from: "GCash", to: "gcash" },
		);
		expect(result).toMatchObject({
			ok: false,
			problems: [
				{ item: 0, error: expect.stringMatching(/No Account named "Maya". Known: GCash/), hint: expect.stringMatching(/balance_check/) },
				{ item: 1, error: 'No spending Category "Food".', hint: expect.stringMatching(/Suggested spending Categories: Food/) },
				{ item: 2, error: "Salary is an Income Category, not spending." },
				{ item: 3, error: "A Transfer needs two different Accounts." },
			],
		});
	});

	it("rejects items before an Account's setup and on a closed Account", async () => {
		await log(check("GoSave", 100, "2026-01-10"));
		expect(await log(spend(10, "GoSave", { date: "2026-01-09" }))).toMatchObject({ ok: false });
		await log(spend(100, "GoSave", { date: "2026-01-11" }), { kind: "balance_check", account: "GoSave", balance: 0, date: "2026-01-12", close: true });
		expect(await log(spend(10, "GoSave"))).toMatchObject({ ok: false, problems: [{ error: "GoSave is closed." }] });
	});

	it("manages Categories and Accounts", async () => {
		await log(check("GCash", 1000));
		ok(await addCategory(env.DB, user, { name: "Food", flow: "spending" }));
		expect(await addCategory(env.DB, user, { name: "food", flow: "spending" })).toMatchObject({ ok: false });
		await log(spend(100, "GCash", { category: "food" }));
		ok(await renameCategory(env.DB, user, { name: "Food", new_name: "Eating out" }));
		expect(ok(await removeCategory(env.DB, user, { name: "Eating out" })).summary).toMatch(/history keeps/);
		expect(ok(await status(env.DB, user, defaults)).data.categories.spending).toEqual([]);
		expect(ok(await addCategory(env.DB, user, { name: "Eating out", flow: "spending" })).summary).toMatch(/Brought back/);
		ok(await addCategory(env.DB, user, { name: "Gifts", flow: "spending" }));
		expect(ok(await removeCategory(env.DB, user, { name: "Gifts" })).summary).toBe("Removed Gifts.");
		ok(await renameAccount(env.DB, user, { name: "gcash", new_name: "GCash Wallet" }));
		expect(await balanceOf("GCash Wallet")).toBe("₱900");
	});
});

describe("Estimates, Unaccounted and Gap (#14)", () => {
	it("saves the issue 9 Catch-up batch with ₱0 Unaccounted", async () => {
		await addCategory(env.DB, user, { name: "Food", flow: "spending" });
		await addCategory(env.DB, user, { name: "Transport", flow: "spending" });
		await addCategory(env.DB, user, { name: "Bills", flow: "spending" });
		await addCategory(env.DB, user, { name: "Salary", flow: "income" });
		await log(check("GCash", 6200, "2026-10-21"), check("Bank", 18000, "2026-10-21"));
		await log(spend(40, "GCash", { date: "2026-11-01", category: "Transport" }));

		const result = ok(
			await log(
				{ kind: "transfer", amount: 2000, from: "Bank", to: "GCash", date: "2026-10-31" },
				{ kind: "income", amount: 15000, account: "Bank", category: "Salary", date: "2026-10-30" },
				spend(1500, "GCash", { category: "Bills", date: "2026-10-25" }),
				{ kind: "estimate", flow: "spending", amount: 2000, start: "2026-10-22", end: "2026-10-31", account: "GCash", category: "Food" },
				{ kind: "estimate", flow: "spending", amount: 2560, start: "2026-10-22", end: "2026-10-31", account: "GCash", category: "Transport" },
				check("GCash", 2100, "2026-11-01"),
				check("Bank", 31000, "2026-11-01"),
			),
		);
		expect(result.summary).not.toMatch(/Unaccounted/);
		expect(await balanceOf("GCash")).toBe("₱2,100");
		expect(await balanceOf("Bank")).toBe("₱31,000");

		// Totals for the month equal the Balance change minus Transfers.
		const totals = ok(await report(env.DB, user, defaults, { view: "totals", from: "2026-10-22", to: "2026-11-01" }));
		expect(totals.data.spending.total).toBe("₱6,100");
		expect(totals.data.income.total).toBe("₱15,000");
		expect(totals.data.net).toBe("₱8,900"); // (2,100 − 6,200) + (31,000 − 18,000)
		expect(totals.data.spending.lines).toContainEqual({ name: "Food", amount: "₱2,000", estimated: "₱2,000" });
	});

	it("a forgotten Transaction inside an Estimate's Period shrinks the Estimate, not the Balance", async () => {
		await log(check("GCash", 5000, "2026-10-01"));
		await log({ kind: "estimate", flow: "spending", amount: 2000, start: "2026-10-02", end: "2026-10-10", account: "GCash" });
		expect(await balanceOf("GCash")).toBe("₱3,000");
		await log(spend(500, "GCash", { date: "2026-10-05" }));
		expect(await balanceOf("GCash")).toBe("₱3,000");
		const totals = ok(await report(env.DB, user, defaults, { view: "totals", from: "2026-10-01", to: "2026-10-31" }));
		expect(totals.data.spending.lines).toEqual([{ name: "Uncategorized", amount: "₱2,000", estimated: "₱1,500" }]);
	});

	it("rejects overlapping Estimates and Periods that cross a Balance check", async () => {
		await log(check("GCash", 5000, "2026-10-01"));
		const first = ok(await log({ kind: "estimate", flow: "spending", amount: 100, start: "2026-10-02", end: "2026-10-05", account: "GCash" }));
		await log(check("GCash", 4000, "2026-10-20"));
		const result = await log(
			{ kind: "estimate", flow: "spending", amount: 100, start: "2026-10-04", end: "2026-10-08", account: "GCash" },
			{ kind: "estimate", flow: "spending", amount: 100, start: "2026-10-15", end: "2026-10-25", account: "GCash" },
		);
		expect(result).toMatchObject({
			ok: false,
			problems: [
				{ item: 0, error: expect.stringContaining(`Estimate ${first.ids![0]}`) },
				{ item: 1, error: expect.stringContaining("crosses GCash's Balance check on 2026-10-20"), hint: expect.stringMatching(/ending 2026-10-19/) },
			],
		});
	});

	it("derives Unaccounted between Balance checks", async () => {
		await log(check("GCash", 1000, "2026-10-01"));
		await log(spend(200, "GCash", { date: "2026-10-02" }));
		expect(ok(await log(check("GCash", 500, "2026-10-03"))).summary).toBe("Checked GCash ₱500 on Sat 3 Oct · Unaccounted: GCash −₱300");
		const totals = ok(await report(env.DB, user, defaults, { view: "totals", from: "2026-10-01", to: "2026-10-31" }));
		expect(totals.data.spending.lines).toContainEqual({ name: "Unaccounted", amount: "₱300" });
	});

	it("shows a Gap after 3 empty days, not after 2", async () => {
		await log(check("GCash", 1000, addDays(today, -3)));
		expect(ok(await status(env.DB, user, defaults)).data.gap).toBeUndefined();

		const other = await upsertUser(env.DB, "github", String(Math.random()));
		await record(env.DB, other, defaults, [check("GCash", 1000, addDays(today, -4))]);
		expect(ok(await status(env.DB, other, defaults)).next).toBeUndefined(); // setup comes first
		await setProfile(env.DB, other, defaults, { currency: "PHP", timezone: "Asia/Manila" });
		await setupCategories(env.DB, other, defaults, "skip");
		const result = ok(await status(env.DB, other, defaults));
		expect(result.data.gap).toEqual({ from: addDays(today, -3), to: addDays(today, -1), days: 3 });
		expect(result.next).toMatch(/Catch-up/);
	});

	it("an Estimate Period fills the Gap", async () => {
		await log(check("GCash", 1000, addDays(today, -10)));
		await log({ kind: "estimate", flow: "spending", amount: 100, start: addDays(today, -9), end: addDays(today, -1), account: "GCash" });
		expect(ok(await status(env.DB, user, defaults)).data.gap).toBeUndefined();
	});
});

describe("finance_report (#15)", () => {
	it('answers "how much on food in October" in one call', async () => {
		await addCategory(env.DB, user, { name: "Food", flow: "spending" });
		await log(check("GCash", 5000, "2026-09-30"));
		await log(spend(250, "GCash", { category: "Food", date: "2026-10-03" }), spend(150, "GCash", { category: "Food", date: "2026-10-20" }), spend(99, "GCash", { date: "2026-10-21" }));
		const result = ok(await report(env.DB, user, defaults, { view: "totals", from: "2026-10-01", to: "2026-10-31", category: "food" }));
		expect(result.summary).toBe("1–31 Oct (food): spent ₱400, received ₱0.");
	});

	it("lists entries newest first with ids, and groups totals by month and account", async () => {
		await log(check("GCash", 5000, "2026-09-01"), check("BPI", 100, "2026-09-01"));
		await log(spend(10, "GCash", { date: "2026-09-05", note: "jeep" }), spend(20, "BPI", { date: "2026-10-05", note: "Jollibee" }));
		const entries = ok(await report(env.DB, user, defaults, { view: "entries", text: "jolli" }));
		expect(entries.data.entries).toEqual([expect.stringMatching(/^e\d+ Spending ₱20 · Uncategorized · BPI · Mon 5 Oct · "Jollibee"$/)]);
		const byMonth = ok(await report(env.DB, user, defaults, { view: "totals", from: "2026-09-01", to: "2026-10-31", group_by: "month" }));
		expect(byMonth.data.spending.lines).toEqual([
			{ name: "2026-09", amount: "₱10" },
			{ name: "2026-10", amount: "₱20" },
		]);
		const balances = ok(await report(env.DB, user, defaults, { view: "balances" }));
		expect(balances.summary).toBe("BPI ₱80 · GCash ₱4,990 (₱5,070 in all)");
	});
});

describe("finance_amend (#16)", () => {
	it('"undo" after a 3-item batch removes all 3 and restores Balances', async () => {
		await log(check("GCash", 1000));
		await log(spend(10, "GCash"), spend(20, "GCash"), spend(30, "GCash"));
		expect(await balanceOf("GCash")).toBe("₱940");
		const result = ok(await amend(env.DB, user, defaults, { undo: "last" }));
		expect(result.summary).toBe("Undid 3 items · Now: GCash ₱1,000");
		expect(result.data.removed).toHaveLength(3);
	});

	it("undoing the first setup removes the Accounts too", async () => {
		await log(check("GCash", 1000), check("BPI", 5));
		ok(await amend(env.DB, user, defaults, { undo: "last" }));
		expect(ok(await status(env.DB, user, defaults)).summary).toBe("No Accounts yet.");
	});

	it("edits one item, keeping its kind and rules", async () => {
		await addCategory(env.DB, user, { name: "Food", flow: "spending" });
		await log(check("GCash", 1000, "2026-10-01"), check("BPI", 1000, "2026-10-01"));
		const { ids } = ok(await log(spend(100, "GCash", { date: "2026-10-02" })));
		const result = ok(await amend(env.DB, user, defaults, { id: ids![0], set: { amount: 150, category: "Food", account: "BPI" } }));
		expect(result.summary).toMatch(/Changed e\d+: Spending ₱150 · Food · BPI/);
		expect(await balanceOf("GCash")).toBe("₱1,000");
		expect(await balanceOf("BPI")).toBe("₱850");
		expect(await amend(env.DB, user, defaults, { id: ids![0], set: { date: "2026-09-01" } })).toMatchObject({ ok: false });
	});

	it("rejects an edit that would create an overlapping Estimate, with a hint", async () => {
		await log(check("GCash", 5000, "2026-10-01"));
		await log({ kind: "estimate", flow: "spending", amount: 100, start: "2026-10-02", end: "2026-10-05", account: "GCash" });
		const { ids } = ok(await log({ kind: "estimate", flow: "spending", amount: 100, start: "2026-10-10", end: "2026-10-12", account: "GCash" }));
		expect(await amend(env.DB, user, defaults, { id: ids![0], set: { start: "2026-10-04" } })).toMatchObject({
			ok: false,
			problems: [{ error: expect.stringMatching(/Overlaps Estimate e\d+/), hint: expect.stringMatching(/finance_amend/) }],
		});
	});

	it("won't delete a first Balance check that other items depend on", async () => {
		const setup = ok(await log(check("GCash", 1000, "2026-10-01")));
		await log(spend(10, "GCash", { date: "2026-10-02" }));
		expect(await amend(env.DB, user, defaults, { ids: setup.ids!, delete: true })).toMatchObject({ ok: false });
	});
});
