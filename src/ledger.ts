import { addDays, day, isIsoDate, money, period, todayIn, toMinor } from "./format";
import * as hints from "./hints";
import { balances, gap, unaccountedAt } from "./queries";

/** What a tool hands back to the model: a one-line summary, item ids, data and a next-step hint. */
export type Result =
	| { ok: true; summary: string; say?: string; ids?: string[]; data?: unknown; next?: string }
	| { ok: false; error: string; problems?: Problem[]; hint?: string };

export type Problem = { item: number; error: string; hint?: string };

export type Defaults = { currency: string; timezone: string };

export type Profile = { currency: string; timezone: string; set: boolean; onboarded: boolean };

type Flow = "income" | "spending";

export type ItemInput =
	| { kind: Flow; amount: number; account: string; date?: string; category?: string; note?: string }
	| { kind: "transfer"; amount: number; from: string; to: string; date?: string; note?: string }
	| { kind: "estimate"; flow: Flow; amount: number; start: string; end: string; account: string; category?: string; note?: string }
	| { kind: "balance_check"; account: string; balance: number; date?: string; close?: boolean };

export async function profile(db: D1Database, userId: number, defaults: Defaults): Promise<Profile> {
	const row = await db
		.prepare("SELECT currency, timezone, onboarded_at FROM users WHERE id = ?")
		.bind(userId)
		.first<{ currency: string | null; timezone: string | null; onboarded_at: string | null }>();
	return {
		currency: row?.currency ?? defaults.currency,
		timezone: row?.timezone ?? defaults.timezone,
		set: Boolean(row?.currency && row?.timezone),
		onboarded: Boolean(row?.onboarded_at),
	};
}

/** The setup screen to send the user back to, or undefined once setup is complete. */
export async function setupNext(db: D1Database, userId: number, defaults: Defaults): Promise<hints.Screen | undefined> {
	const me = await profile(db, userId, defaults);
	if (me.onboarded) return undefined;
	if (!me.set) return hints.SETUP_WELCOME;
	const hasAccount = await db.prepare("SELECT 1 FROM accounts WHERE user_id = ? LIMIT 1").bind(userId).first();
	return hasAccount ? hints.SETUP_CATEGORIES : hints.setupMoney(me.currency);
}

// ---------------------------------------------------------------------------
// Describing items

/** An item as stored, with names joined in. */
type ItemRow = {
	id: number;
	batch_id: number;
	kind: ItemInput["kind"];
	date: string;
	start_date: string | null;
	amount: number;
	flow: Flow | null;
	note: string | null;
	closes: number;
	account_id: number;
	to_account_id: number | null;
	account: string;
	to_account: string | null;
	category: string | null;
};

const ITEM_SELECT = `SELECT i.id, i.batch_id, i.kind, i.date, i.start_date, i.amount, i.flow, i.note, i.closes,
	i.account_id, i.to_account_id, a.name AS account, t.name AS to_account, c.name AS category
	FROM items i JOIN accounts a ON a.id = i.account_id
	LEFT JOIN accounts t ON t.id = i.to_account_id LEFT JOIN categories c ON c.id = i.category_id`;

type Describable = Pick<ItemRow, "kind" | "date" | "start_date" | "amount" | "flow" | "note" | "account" | "to_account" | "category"> & {
	closes: number | boolean;
};

/** "Spending ₱250 · Food · GCash · Sat 1 Nov · "lunch"" */
export function describe(it: Describable, currency: string): string {
	const amount = money(it.amount, currency);
	const note = it.note ? ` · "${it.note}"` : "";
	switch (it.kind) {
		case "income":
		case "spending":
			return `${it.kind === "income" ? "Income" : "Spending"} ${amount} · ${it.category ?? "Uncategorized"} · ${it.account} · ${day(it.date)}${note}`;
		case "transfer":
			return `Transfer ${amount} · ${it.account} → ${it.to_account} · ${day(it.date)}${note}`;
		case "estimate":
			return `Estimate ~${amount} ${it.flow} · ${it.category ?? "Uncategorized"} · ${it.account} · ${period(it.start_date!, it.date)}${note}`;
		case "balance_check":
			return it.closes ? `Closed ${it.account} · ${day(it.date)}` : `Balance check ${it.account} ${amount} · ${day(it.date)}`;
	}
}

/** One confirmation line the app shows: "✓ Spent ₱40 on Transport from GCash · jeep". */
function sayLine(it: Describable & { newAccount?: boolean }, currency: string, today: string): string {
	const amount = money(it.amount, currency);
	const tail = `${it.note ? ` · ${it.note}` : ""}${it.date === today ? "" : ` · ${day(it.date)}`}`;
	const category = it.category ? ` on ${it.category}` : "";
	switch (it.kind) {
		case "income":
			return `✓ Received ${amount}${it.category ? ` ${it.category}` : ""} into ${it.account}${tail}`;
		case "spending":
			return `✓ Spent ${amount}${category} from ${it.account}${tail}`;
		case "transfer":
			return `✓ Moved ${amount} from ${it.account} to ${it.to_account}${tail}`;
		case "estimate":
			return `✓ About ${amount}${category || " uncategorized"} ${it.flow === "income" ? "into" : "from"} ${it.account} over ${period(it.start_date!, it.date)}`;
		case "balance_check":
			if (it.closes) return `✓ Closed ${it.account}`;
			return `✓ ${it.newAccount ? "Set up" : "Checked"} ${it.account}: ${amount}${it.date === today ? "" : ` · ${day(it.date)}`}`;
	}
}

/** Short verb phrase for a record summary: "spent ₱250 Food from GCash". */
function phrase(it: Describable & { newAccount?: boolean }, currency: string, today: string): string {
	const amount = money(it.amount, currency);
	const on = it.date === today ? "" : ` on ${day(it.date)}`;
	const note = it.note ? ` ("${it.note}")` : "";
	const category = it.category ? ` ${it.category}` : "";
	switch (it.kind) {
		case "income":
			return `received ${amount}${category} into ${it.account}${on}${note}`;
		case "spending":
			return `spent ${amount}${category} from ${it.account}${on}${note}`;
		case "transfer":
			return `moved ${amount} ${it.account} → ${it.to_account}${on}${note}`;
		case "estimate":
			return `estimated ~${amount}${category || " Uncategorized"} ${it.flow === "income" ? "into" : "from"} ${it.account} over ${period(it.start_date!, it.date)}`;
		case "balance_check":
			if (it.closes) return `closed ${it.account}`;
			return `${it.newAccount ? "set up" : "checked"} ${it.account} ${amount}${on}`;
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function signed(minor: number, currency: string): string {
	return `${minor < 0 ? "−" : "+"}${money(Math.abs(minor), currency)}`;
}

export const parseId = (id: string): number | null => {
	const match = /^e?(\d+)$/i.exec(id.trim());
	return match ? Number(match[1]) : null;
};

// ---------------------------------------------------------------------------
// Validation context: the user's Accounts (with their Balance checks), Categories and Estimates

type Check = { date: string; seq: number; closes: boolean };
type Acct = { name: string; checks: Check[]; existingFirst?: string; isNew?: boolean };
type Cat = { id: number; name: string; flow: Flow; hidden: boolean };
type Est = { id: number; seq: number; account: string; flow: Flow; category: number | null; start: string; end: string };

type Ctx = { today: string; currency: string; accounts: Map<string, Acct>; categories: Cat[]; estimates: Est[] };

/** Sequence for items not yet saved: after every saved item, in batch order. */
const PENDING = 2 ** 40;

const key = (name: string) => name.trim().toLowerCase();
const before = (a: { date: string; seq: number }, b: { date: string; seq: number }) =>
	a.date < b.date || (a.date === b.date && a.seq < b.seq);

async function loadCtx(db: D1Database, userId: number, me: Profile, excludeId = 0): Promise<Ctx> {
	const [accounts, checks, categories, estimates] = await db.batch([
		db.prepare("SELECT id, name FROM accounts WHERE user_id = ?").bind(userId),
		db
			.prepare("SELECT account_id, date, id, closes FROM items WHERE user_id = ? AND kind = 'balance_check' AND id != ? ORDER BY date, id")
			.bind(userId, excludeId),
		db.prepare("SELECT id, name, flow, hidden FROM categories WHERE user_id = ? ORDER BY name").bind(userId),
		db
			.prepare("SELECT id, account_id, flow, category_id, start_date, date FROM items WHERE user_id = ? AND kind = 'estimate' AND id != ?")
			.bind(userId, excludeId),
	]);
	const byId = new Map<number, Acct>();
	const ctx: Ctx = { today: todayIn(me.timezone), currency: me.currency, accounts: new Map(), categories: [], estimates: [] };
	for (const a of accounts.results as { id: number; name: string }[]) {
		const acct: Acct = { name: a.name, checks: [] };
		byId.set(a.id, acct);
		ctx.accounts.set(key(a.name), acct);
	}
	for (const c of checks.results as { account_id: number; date: string; id: number; closes: number }[]) {
		const acct = byId.get(c.account_id)!;
		acct.checks.push({ date: c.date, seq: c.id, closes: c.closes === 1 });
		acct.existingFirst ??= c.date;
	}
	ctx.categories = (categories.results as { id: number; name: string; flow: Flow; hidden: number }[]).map((c) => ({
		...c,
		hidden: c.hidden === 1,
	}));
	ctx.estimates = (estimates.results as { id: number; account_id: number; flow: Flow; category_id: number | null; start_date: string; date: string }[]).map(
		(e) => ({ id: e.id, seq: e.id, account: key(byId.get(e.account_id)!.name), flow: e.flow, category: e.category_id, start: e.start_date, end: e.date }),
	);
	return ctx;
}

/** Make a Balance check known to the context before validating, so items in the same batch can use its Account. */
function registerCheck(ctx: Ctx, name: string, check: Check) {
	if (!name.trim() || !isIsoDate(check.date)) return;
	let acct = ctx.accounts.get(key(name));
	if (!acct) {
		acct = { name: name.trim(), checks: [], isNew: true };
		ctx.accounts.set(key(name), acct);
	}
	acct.checks.push(check);
	acct.checks.sort((a, b) => (before(a, b) ? -1 : 1));
}

/** A validated item, ready to insert or update. */
type Row = Describable & { category_id: number | null; newAccount: boolean };

type Issue = { error: string; hint?: string };

function validate(ctx: Ctx, item: ItemInput, seq: number): { issues: Issue[]; row?: Row } {
	const issues: Issue[] = [];
	const add = (error: string, hint?: string) => issues.push({ error, hint });
	const openNames = () =>
		[...ctx.accounts.values()].filter((a) => a.checks.length && !a.checks[a.checks.length - 1].closes).map((a) => a.name);

	const amountOf = (value: number, allowZero: boolean): number => {
		const minor = toMinor(value);
		if (minor === null) {
			add(value < 0 ? "Amounts are positive; the kind gives the direction." : "Amount must be a number with at most 2 decimals.");
			return 0;
		}
		if (minor === 0 && !allowZero) add("Amount must be more than 0.");
		return minor;
	};

	const dateOf = (value: string | undefined, label = "date"): string => {
		const date = value ?? ctx.today;
		if (!isIsoDate(date)) add(`${label} "${date}" isn't a date.`, "Use YYYY-MM-DD, resolved from finance_status today.");
		else if (date > ctx.today) add(`${label} ${date} is in the future (today is ${ctx.today}).`);
		return date;
	};

	const useAccount = (name: string, at: string): Acct | undefined => {
		const acct = ctx.accounts.get(key(name));
		if (!acct || acct.checks.length === 0) {
			add(`No Account named "${name}". Known: ${openNames().join(", ") || "none yet"}.`, hints.UNKNOWN_ACCOUNT);
			return undefined;
		}
		if (isIsoDate(at) && at < acct.checks[0].date) {
			add(`${acct.name} was set up on ${acct.checks[0].date}; nothing can be dated before that.`);
		} else {
			const earlier = acct.checks.filter((c) => before(c, { date: at, seq }));
			const latest = earlier[earlier.length - 1];
			if (latest?.closes) add(`${acct.name} is closed.`, "A balance_check of what it holds now reopens it.");
		}
		return acct;
	};

	const useCategory = (name: string | undefined, flow: Flow): Cat | null | undefined => {
		if (!name?.trim()) return null;
		const visible = ctx.categories.filter((c) => !c.hidden);
		const match = visible.find((c) => c.flow === flow && key(c.name) === key(name));
		if (match) return match;
		const other = visible.find((c) => key(c.name) === key(name));
		if (other) {
			add(`${other.name} is ${other.flow === "income" ? "an Income" : "a Spending"} Category, not ${flow}.`);
		} else {
			add(
				`No ${flow} Category "${name.trim()}".`,
				hints.unknownCategory(
					flow,
					visible.filter((c) => c.flow === flow).map((c) => c.name),
				),
			);
		}
		return undefined;
	};

	const note = "note" in item && item.note?.trim() ? item.note.trim().slice(0, 200) : null;

	switch (item.kind) {
		case "income":
		case "spending": {
			const amount = amountOf(item.amount, false);
			const date = dateOf(item.date);
			const acct = useAccount(item.account, date);
			const category = useCategory(item.category, item.kind);
			if (!acct || category === undefined || issues.length) return { issues };
			return {
				issues,
				row: { kind: item.kind, date, start_date: null, amount, flow: null, note, closes: false, account: acct.name, to_account: null, category: category?.name ?? null, category_id: category?.id ?? null, newAccount: false },
			};
		}
		case "transfer": {
			const amount = amountOf(item.amount, false);
			const date = dateOf(item.date);
			const from = useAccount(item.from, date);
			const to = useAccount(item.to, date);
			if (from && to && from === to) add("A Transfer needs two different Accounts.");
			if (!from || !to || issues.length) return { issues };
			return {
				issues,
				row: { kind: "transfer", date, start_date: null, amount, flow: null, note, closes: false, account: from.name, to_account: to.name, category: null, category_id: null, newAccount: false },
			};
		}
		case "estimate": {
			const amount = amountOf(item.amount, false);
			const start = dateOf(item.start, "start");
			const end = dateOf(item.end, "end");
			if (isIsoDate(start) && isIsoDate(end) && start > end) add(`start ${start} is after end ${end}.`);
			const acct = useAccount(item.account, start);
			const category = useCategory(item.category, item.flow);
			if (!acct || category === undefined || issues.length) return { issues };
			const categoryId = category?.id ?? null;
			const overlap = ctx.estimates.find(
				(e) => e.account === key(acct.name) && e.flow === item.flow && e.category === categoryId && e.start <= end && start <= e.end,
			);
			if (overlap) {
				add(
					`Overlaps ${overlap.id ? `Estimate e${overlap.id}` : "another Estimate in this call"} (${period(overlap.start, overlap.end)}) for the same Category and Account.`,
					overlap.id ? `Edit e${overlap.id} with finance_amend instead, or use a Period that doesn't overlap.` : "Merge them into one Estimate.",
				);
			}
			const crossed = acct.checks.find((c) => (start < c.date && c.date < end) || (c.date === end && c.seq < seq));
			if (crossed) {
				add(
					`The Period crosses ${acct.name}'s Balance check on ${crossed.date}.`,
					`Split it there: one Estimate ending ${addDays(crossed.date, -1)}, one starting ${crossed.date}.`,
				);
			}
			if (issues.length) return { issues };
			ctx.estimates.push({ id: 0, seq, account: key(acct.name), flow: item.flow, category: categoryId, start, end });
			return {
				issues,
				row: { kind: "estimate", date: end, start_date: start, amount, flow: item.flow, note, closes: false, account: acct.name, to_account: null, category: category?.name ?? null, category_id: categoryId, newAccount: false },
			};
		}
		case "balance_check": {
			const name = item.account.trim();
			if (!name) add("Account name is empty.");
			const minor = toMinor(item.balance);
			if (minor === null) {
				if (item.balance < 0) add("A Balance check can't be negative.", "Credit cards and loans aren't Accounts here.");
				else add("Balance must be a number with at most 2 decimals.");
			}
			if (item.close && minor !== 0) add("Only a Balance check of 0 can close an Account.");
			const date = dateOf(item.date);
			const acct = ctx.accounts.get(key(name));
			if (acct?.existingFirst && isIsoDate(date) && date < acct.existingFirst) {
				add(`${acct.name} was set up on ${acct.existingFirst}; nothing can be dated before that.`);
			}
			if (issues.length) return { issues };
			return {
				issues,
				row: { kind: "balance_check", date, start_date: null, amount: minor!, flow: null, note: null, closes: Boolean(item.close), account: acct?.name ?? name, to_account: null, category: null, category_id: null, newAccount: Boolean(acct?.isNew) },
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Account invariants after deleting or editing Balance checks

type AcctItem = { id: number; kind: string; date: string; start_date: string | null; account_id: number; to_account_id: number | null };

/** Problems an Account would have with these items: nothing before its first check, no Estimate crossed by a check. */
function accountProblems(name: string, accountId: number, items: AcctItem[]): string | undefined {
	const own = items.filter((i) => i.account_id === accountId || i.to_account_id === accountId);
	const checks = own.filter((i) => i.kind === "balance_check").sort((a, b) => (before({ date: a.date, seq: a.id }, { date: b.date, seq: b.id }) ? -1 : 1));
	const others = own.filter((i) => i.kind !== "balance_check");
	if (others.length === 0) return undefined;
	if (checks.length === 0) return `${name} would have no Balance check left but still has ${others.length} item(s); delete those first.`;
	const earliest = others.map((o) => o.start_date ?? o.date).sort()[0];
	if (earliest < checks[0].date) return `${name} would have items from ${earliest}, before its first Balance check (${checks[0].date}).`;
	for (const e of others.filter((o) => o.kind === "estimate" && o.account_id === accountId)) {
		const crossed = checks.find((c) => (e.start_date! < c.date && c.date < e.date) || (c.date === e.date && c.id < e.id));
		if (crossed) return `${name}'s Balance check on ${crossed.date} would fall inside Estimate e${e.id} (${period(e.start_date!, e.date)}).`;
	}
	return undefined;
}

async function itemsOfAccounts(db: D1Database, userId: number, accountIds: number[]): Promise<AcctItem[]> {
	const marks = accountIds.map(() => "?").join(",");
	const { results } = await db
		.prepare(
			`SELECT id, kind, date, start_date, account_id, to_account_id FROM items
			WHERE user_id = ? AND (account_id IN (${marks}) OR to_account_id IN (${marks}))`,
		)
		.bind(userId, ...accountIds, ...accountIds)
		.all<AcctItem>();
	return results;
}

/** Balances of the given open Accounts: ["GCash ₱4,500", …]. */
async function nowBalances(db: D1Database, userId: number, names: Set<string>, currency: string): Promise<string[]> {
	if (names.size === 0) return [];
	const all = await balances(db, userId);
	return all.filter((a) => names.has(key(a.name)) && !a.closed).map((a) => `${a.name} ${money(a.balance, currency)}`);
}

/** ["Balance: GCash ₱4,500"] for a say, or [] when nothing to show. */
async function balanceLine(db: D1Database, userId: number, names: Set<string>, currency: string): Promise<string[]> {
	const list = await nowBalances(db, userId, names, currency);
	return list.length ? [`${list.length === 1 ? "Balance" : "Balances"}: ${list.join(" · ")}`] : [];
}

/** " · Now: GCash ₱4,500" for summaries. */
async function nowLine(db: D1Database, userId: number, names: Set<string>, currency: string): Promise<string> {
	const list = await nowBalances(db, userId, names, currency);
	return list.length ? ` · Now: ${list.join(", ")}` : "";
}

const DELETE_ORPHANS = (db: D1Database, userId: number) => [
	db
		.prepare("DELETE FROM accounts WHERE user_id = ?1 AND NOT EXISTS (SELECT 1 FROM items WHERE items.account_id = accounts.id OR items.to_account_id = accounts.id)")
		.bind(userId),
	db.prepare("DELETE FROM batches WHERE user_id = ?1 AND NOT EXISTS (SELECT 1 FROM items WHERE items.batch_id = batches.id)").bind(userId),
];

// ---------------------------------------------------------------------------
// Tools

export async function status(db: D1Database, userId: number, defaults: Defaults): Promise<Result> {
	const me = await profile(db, userId, defaults);
	const today = todayIn(me.timezone);
	const [all, categories, recent, found, usage] = await Promise.all([
		balances(db, userId),
		db
			.prepare("SELECT name, flow FROM categories WHERE user_id = ? AND hidden = 0 ORDER BY name")
			.bind(userId)
			.all<{ name: string; flow: string }>(),
		db.prepare(`${ITEM_SELECT} WHERE i.user_id = ? ORDER BY i.id DESC LIMIT 5`).bind(userId).all<ItemRow>(),
		gap(db, userId, today),
		// Spending per Account over the last 60 days, for the default Account.
		db
			.prepare(
				`SELECT a.name, COUNT(i.id) AS n, MIN(f.id) AS first FROM accounts a
				LEFT JOIN items i ON i.account_id = a.id AND i.kind = 'spending' AND i.date >= ?2
				LEFT JOIN items f ON f.account_id = a.id
				WHERE a.user_id = ?1 GROUP BY a.id ORDER BY n DESC, first ASC`,
			)
			.bind(userId, addDays(today, -60))
			.all<{ name: string }>(),
	]);
	const open = all.filter((a) => !a.closed);
	const total = open.reduce((sum, a) => sum + a.balance, 0);
	const openNames = new Set(open.map((a) => a.name));
	const defaultAccount = usage.results.find((u) => openNames.has(u.name))?.name;
	// Setup steps override this in tools.ts until setup is complete.
	const next = found && me.onboarded ? hints.catchUp(found) : undefined;
	return {
		ok: true,
		summary:
			open.length === 0
				? "No Accounts yet."
				: `${open.length} Account${open.length === 1 ? "" : "s"}, ${money(total, me.currency)} in all.`,
		data: {
			today: `${today} (${day(today).split(" ")[0]})`,
			currency: me.set ? me.currency : "not set yet",
			timezone: me.set ? me.timezone : "not set yet",
			accounts: open.map((a) => ({ name: a.name, balance: money(a.balance, me.currency), last_check: a.lastCheck })),
			...(defaultAccount && { default_account: defaultAccount }),
			closed_accounts: all.filter((a) => a.closed).map((a) => a.name),
			categories: {
				spending: categories.results.filter((c) => c.flow === "spending").map((c) => c.name),
				income: categories.results.filter((c) => c.flow === "income").map((c) => c.name),
			},
			recent: recent.results.map((r) => `e${r.id} ${describe(r, me.currency)}`),
			...(found && { gap: found }),
		},
		next,
	};
}

export async function record(db: D1Database, userId: number, defaults: Defaults, items: ItemInput[]): Promise<Result> {
	const me = await profile(db, userId, defaults);
	const ctx = await loadCtx(db, userId, me);
	items.forEach((item, i) => {
		if (item.kind === "balance_check") registerCheck(ctx, item.account, { date: item.date ?? ctx.today, seq: PENDING + i, closes: Boolean(item.close) });
	});

	const problems: Problem[] = [];
	const rows: Row[] = [];
	items.forEach((item, i) => {
		const { issues, row } = validate(ctx, item, PENDING + i);
		problems.push(...issues.map((issue) => ({ item: i, ...issue })));
		if (row) rows.push(row);
	});
	if (problems.length > 0) return { ok: false, error: "Nothing was saved.", problems };

	const batch = [db.prepare("INSERT INTO batches (user_id) VALUES (?)").bind(userId)];
	for (const name of new Set(rows.filter((r) => r.newAccount).map((r) => r.account))) {
		batch.push(db.prepare("INSERT OR IGNORE INTO accounts (user_id, name) VALUES (?, ?)").bind(userId, name));
	}
	const firstItem = batch.length;
	for (const r of rows) {
		batch.push(
			db
				.prepare(
					`INSERT INTO items (user_id, batch_id, kind, date, start_date, amount, account_id, to_account_id, category_id, flow, note, closes)
					VALUES (?1, (SELECT max(id) FROM batches WHERE user_id = ?1), ?2, ?3, ?4, ?5,
						(SELECT id FROM accounts WHERE user_id = ?1 AND name = ?6),
						(SELECT id FROM accounts WHERE user_id = ?1 AND name = ?7), ?8, ?9, ?10, ?11)
					RETURNING id`,
				)
				.bind(userId, r.kind, r.date, r.start_date, r.amount, r.account, r.to_account, r.category_id, r.flow, r.note, r.closes ? 1 : 0),
		);
	}
	const results = await db.batch<{ id: number }>(batch);
	const newIds = results.slice(firstItem).map((r) => r.results[0].id);

	// Balances of Accounts that Transactions moved, and Unaccounted at each new Balance check.
	// An Account checked in this call already shows its Balance on the check's line.
	const checked = new Set(rows.filter((r) => r.kind === "balance_check").map((r) => key(r.account)));
	const moved = new Set(
		rows
			.filter((r) => r.kind !== "balance_check")
			.flatMap((r) => [key(r.account), ...(r.to_account ? [key(r.to_account)] : [])])
			.filter((name) => !checked.has(name)),
	);
	const checkIds = newIds.filter((_, i) => rows[i].kind === "balance_check");
	const [nowList, unaccounted] = await Promise.all([nowBalances(db, userId, moved, me.currency), unaccountedAt(db, userId, checkIds)]);
	const now = nowList.length ? ` · Now: ${nowList.join(", ")}` : "";
	const unaccountedLine = checkIds
		.map((id) => [rows[newIds.indexOf(id)].account, unaccounted.get(id) ?? 0] as const)
		.filter(([, amount]) => amount !== 0)
		.map(([account, amount]) => `${account} ${signed(amount, me.currency)}`)
		.join(", ");

	return {
		ok: true,
		summary:
			capitalize(rows.map((r) => phrase(r, me.currency, ctx.today)).join("; ")) +
			now +
			(unaccountedLine ? ` · Unaccounted: ${unaccountedLine}` : ""),
		say: [
			...rows.map((r) => sayLine(r, me.currency, ctx.today)),
			...(nowList.length ? [`${nowList.length === 1 ? "Balance" : "Balances"}: ${nowList.join(" · ")}`] : []),
			...(unaccountedLine ? [`Unaccounted since the last check: ${unaccountedLine}`] : []),
		].join("\n"),
		ids: newIds.map((id) => `e${id}`),
	};
}

export type AmendInput = {
	undo?: "last";
	ids?: string[];
	delete?: boolean;
	id?: string;
	set?: {
		amount?: number;
		balance?: number;
		date?: string;
		start?: string;
		end?: string;
		account?: string;
		from?: string;
		to?: string;
		flow?: Flow;
		category?: string | null;
		note?: string | null;
		close?: boolean;
	};
};

export async function amend(db: D1Database, userId: number, defaults: Defaults, input: AmendInput): Promise<Result> {
	const me = await profile(db, userId, defaults);
	if (input.undo === "last") {
		const { results } = await db
			.prepare(`${ITEM_SELECT} WHERE i.user_id = ?1 AND i.batch_id = (SELECT max(batch_id) FROM items WHERE user_id = ?1) ORDER BY i.id`)
			.bind(userId)
			.all<ItemRow>();
		if (results.length === 0) return { ok: false, error: "Nothing to undo." };
		return remove(db, userId, me, results, "Undid");
	}
	if (input.ids?.length && input.delete) {
		const ids = input.ids.map(parseId);
		if (ids.some((id) => id === null)) return { ok: false, error: "Ids look like e42.", hint: "Find them with finance_report view entries." };
		const { results } = await db
			.prepare(`${ITEM_SELECT} WHERE i.user_id = ? AND i.id IN (${ids.map(() => "?").join(",")}) ORDER BY i.id`)
			.bind(userId, ...ids)
			.all<ItemRow>();
		const missing = ids.filter((id) => !results.some((r) => r.id === id));
		if (missing.length) return { ok: false, error: `No item ${missing.map((id) => `e${id}`).join(", ")}.`, hint: "Find ids with finance_report view entries." };
		return remove(db, userId, me, results, "Deleted");
	}
	if (input.id && input.set) return edit(db, userId, me, input.id, input.set);
	return { ok: false, error: 'Give {undo: "last"}, {ids, delete: true} or {id, set}.' };
}

async function remove(db: D1Database, userId: number, me: Profile, rows: ItemRow[], verb: string): Promise<Result> {
	const gone = new Set(rows.map((r) => r.id));
	const checkAccounts = [...new Set(rows.filter((r) => r.kind === "balance_check").map((r) => r.account_id))];
	if (checkAccounts.length) {
		const remaining = (await itemsOfAccounts(db, userId, checkAccounts)).filter((i) => !gone.has(i.id));
		for (const id of checkAccounts) {
			const problem = accountProblems(rows.find((r) => r.account_id === id)!.account, id, remaining);
			if (problem) return { ok: false, error: `Nothing was deleted. ${problem}` };
		}
	}
	await db.batch([
		db.prepare(`DELETE FROM items WHERE user_id = ? AND id IN (${[...gone].map(() => "?").join(",")})`).bind(userId, ...gone),
		...DELETE_ORPHANS(db, userId),
	]);
	const touched = new Set(rows.flatMap((r) => [key(r.account), ...(r.to_account ? [key(r.to_account)] : [])]));
	return {
		ok: true,
		summary: `${verb} ${rows.length} item${rows.length === 1 ? "" : "s"}${await nowLine(db, userId, touched, me.currency)}`,
		say: [
			...rows.map((r) => `✓ ${verb}: ${sayLine(r, me.currency, todayIn(me.timezone)).slice(2)}`),
			...(await balanceLine(db, userId, touched, me.currency)),
		].join("\n"),
		data: { removed: rows.map((r) => `e${r.id} ${describe(r, me.currency)}`) },
	};
}

async function edit(db: D1Database, userId: number, me: Profile, rawId: string, set: NonNullable<AmendInput["set"]>): Promise<Result> {
	const id = parseId(rawId);
	const old = id === null ? null : await db.prepare(`${ITEM_SELECT} WHERE i.user_id = ? AND i.id = ?`).bind(userId, id).first<ItemRow>();
	if (!old || id === null) return { ok: false, error: `No item ${rawId}.`, hint: "Find ids with finance_report view entries." };

	const amount = set.amount ?? old.amount / 100;
	const category = set.category === null ? undefined : (set.category ?? old.category ?? undefined);
	const note = set.note === null ? undefined : (set.note ?? old.note ?? undefined);
	const input: ItemInput =
		old.kind === "transfer"
			? { kind: "transfer", amount, from: set.from ?? old.account, to: set.to ?? old.to_account!, date: set.date ?? old.date, note }
			: old.kind === "estimate"
				? { kind: "estimate", flow: set.flow ?? old.flow!, amount, start: set.start ?? old.start_date!, end: set.end ?? old.date, account: set.account ?? old.account, category, note }
				: old.kind === "balance_check"
					? { kind: "balance_check", account: set.account ?? old.account, balance: set.balance ?? old.amount / 100, date: set.date ?? old.date, close: set.close ?? old.closes === 1 }
					: { kind: old.kind, amount, account: set.account ?? old.account, date: set.date ?? old.date, category, note };

	const ctx = await loadCtx(db, userId, me, id);
	if (input.kind === "balance_check") {
		if (!ctx.accounts.has(key(input.account))) return { ok: false, error: `No Account named "${input.account}".`, hint: "To rename an Account use finance_manage rename_account." };
		registerCheck(ctx, input.account, { date: input.date!, seq: id, closes: Boolean(input.close) });
	}
	const { issues, row } = validate(ctx, input, id);
	if (!row) return { ok: false, error: "Nothing was changed.", problems: issues.map((issue) => ({ item: 0, ...issue })) };

	if (old.kind === "balance_check") {
		const newAccountId = (await db.prepare("SELECT id FROM accounts WHERE user_id = ? AND name = ?").bind(userId, row.account).first<{ id: number }>())!.id;
		const affected = [...new Set([old.account_id, newAccountId])];
		const items = (await itemsOfAccounts(db, userId, affected)).filter((i) => i.id !== id);
		items.push({ id, kind: "balance_check", date: row.date, start_date: null, account_id: newAccountId, to_account_id: null });
		for (const accountId of affected) {
			const problem = accountProblems(accountId === old.account_id ? old.account : row.account, accountId, items);
			if (problem) return { ok: false, error: `Nothing was changed. ${problem}` };
		}
	}

	await db.batch([
		db
			.prepare(
				`UPDATE items SET date = ?3, start_date = ?4, amount = ?5,
					account_id = (SELECT id FROM accounts WHERE user_id = ?1 AND name = ?6),
					to_account_id = (SELECT id FROM accounts WHERE user_id = ?1 AND name = ?7),
					category_id = ?8, flow = ?9, note = ?10, closes = ?11
				WHERE user_id = ?1 AND id = ?2`,
			)
			.bind(userId, id, row.date, row.start_date, row.amount, row.account, row.to_account, row.category_id, row.flow, row.note, row.closes ? 1 : 0),
		...DELETE_ORPHANS(db, userId),
	]);
	const touched = new Set([key(old.account), key(row.account), ...[old.to_account, row.to_account].filter((n): n is string => !!n).map(key)]);
	return {
		ok: true,
		summary: `Changed e${id}: ${describe(row, me.currency)}${await nowLine(db, userId, touched, me.currency)}`,
		say: [`✓ Updated: ${sayLine(row, me.currency, todayIn(me.timezone)).slice(2)}`, ...(await balanceLine(db, userId, touched, me.currency))].join("\n"),
		data: { before: describe(old, me.currency) },
	};
}
