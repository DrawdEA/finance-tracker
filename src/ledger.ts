import { day, isIsoDate, isTimezone, money, todayIn, toMinor } from "./format";

/** What a tool hands back to the model: a one-line summary, item ids, data and a next-step hint. */
export type Result =
	| { ok: true; summary: string; ids?: string[]; data?: unknown; next?: string }
	| { ok: false; error: string; problems?: Problem[]; hint?: string };

type Problem = { item: number; error: string; hint?: string };

export type Defaults = { currency: string; timezone: string };

type Profile = { currency: string; timezone: string; set: boolean };

export type BalanceCheckInput = {
	kind: "balance_check";
	account: string;
	balance: number;
	date?: string;
	close?: boolean;
};

const ASK_PROFILE_AND_ACCOUNTS =
	"New user, nothing set up yet. In ONE short message, welcome them and ask: (1) their currency and city (for dates), and (2) where their money sits and how much is in each place right now, e.g. \"GCash 4,750, BPI 20k, wallet 800\". Then call finance_manage set_profile, then ONE finance_record call with a balance_check per place (wallet or cash → \"Cash\"). Don't list Categories.";

const ASK_ACCOUNTS =
	"No Accounts yet. Ask in ONE short message where their money sits and how much is in each place right now, e.g. \"GCash 4,750, BPI 20k, wallet 800\". Then ONE finance_record call with a balance_check per place (wallet or cash → \"Cash\"). Don't list Categories.";

const AFTER_FIRST_SETUP =
	"First Accounts are set up. Explain in at most 4 short bullets: log by just saying things like \"jeep 40\", \"salary 30k to bpi\", \"moved 2k bpi to gcash\"; Categories are optional and you'll suggest one when it fits; if they skip a few days you'll offer a quick Catch-up with rough totals; \"undo\" works anytime. Then ask if they spent anything today.";

async function profile(db: D1Database, userId: number, defaults: Defaults): Promise<Profile> {
	const row = await db
		.prepare("SELECT currency, timezone FROM users WHERE id = ?")
		.bind(userId)
		.first<{ currency: string | null; timezone: string | null }>();
	return {
		currency: row?.currency ?? defaults.currency,
		timezone: row?.timezone ?? defaults.timezone,
		set: Boolean(row?.currency && row?.timezone),
	};
}

type AccountState = {
	id: number;
	name: string;
	balance: number;
	lastCheck: string;
	firstCheck: string;
	closed: boolean;
};

/** Every Account with its Balance: its latest Balance check by (date, log order). */
async function accounts(db: D1Database, userId: number): Promise<AccountState[]> {
	const { results } = await db
		.prepare(
			`WITH checks AS (
				SELECT account_id, amount, date, closes,
					ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY date DESC, id DESC) AS latest,
					MIN(date) OVER (PARTITION BY account_id) AS first_check
				FROM items WHERE user_id = ? AND kind = 'balance_check'
			)
			SELECT a.id, a.name, c.amount AS balance, c.date AS last_check, c.first_check, c.closes
			FROM accounts a JOIN checks c ON c.account_id = a.id AND c.latest = 1
			WHERE a.user_id = ? ORDER BY a.name`,
		)
		.bind(userId, userId)
		.all<{ id: number; name: string; balance: number; last_check: string; first_check: string; closes: number }>();
	return results.map((r) => ({
		id: r.id,
		name: r.name,
		balance: r.balance,
		lastCheck: r.last_check,
		firstCheck: r.first_check,
		closed: r.closes === 1,
	}));
}

export async function status(db: D1Database, userId: number, defaults: Defaults): Promise<Result> {
	const [me, all, categories, recent] = await Promise.all([
		profile(db, userId, defaults),
		accounts(db, userId),
		db
			.prepare("SELECT name, flow FROM categories WHERE user_id = ? AND hidden = 0 ORDER BY name")
			.bind(userId)
			.all<{ name: string; flow: string }>(),
		db
			.prepare(
				`SELECT i.id, i.kind, i.date, i.amount, i.closes, a.name AS account
				FROM items i JOIN accounts a ON a.id = i.account_id
				WHERE i.user_id = ? ORDER BY i.id DESC LIMIT 5`,
			)
			.bind(userId)
			.all<{ id: number; kind: string; date: string; amount: number; closes: number; account: string }>(),
	]);
	const today = todayIn(me.timezone);
	const open = all.filter((a) => !a.closed);
	const total = open.reduce((sum, a) => sum + a.balance, 0);
	const next = all.length > 0 ? undefined : me.set ? ASK_ACCOUNTS : ASK_PROFILE_AND_ACCOUNTS;
	return {
		ok: true,
		summary:
			open.length === 0
				? "No Accounts yet."
				: `${open.length} Account${open.length === 1 ? "" : "s"}, ${money(total, me.currency)} in all.`,
		data: {
			today: `${today} (${day(today).split(" ")[0]})`,
			currency: me.currency,
			timezone: me.timezone,
			accounts: open.map((a) => ({ name: a.name, balance: money(a.balance, me.currency), last_check: a.lastCheck })),
			closed_accounts: all.filter((a) => a.closed).map((a) => a.name),
			categories: {
				spending: categories.results.filter((c) => c.flow === "spending").map((c) => c.name),
				income: categories.results.filter((c) => c.flow === "income").map((c) => c.name),
			},
			recent: recent.results.map(
				(r) =>
					`e${r.id} ${r.kind === "balance_check" ? (r.closes ? "Closed" : "Balance check") : r.kind} · ${r.account} ${money(r.amount, me.currency)} · ${day(r.date)}`,
			),
		},
		next,
	};
}

export async function record(
	db: D1Database,
	userId: number,
	defaults: Defaults,
	items: BalanceCheckInput[],
): Promise<Result> {
	const me = await profile(db, userId, defaults);
	const today = todayIn(me.timezone);
	const known = new Map((await accounts(db, userId)).map((a) => [a.name.toLowerCase(), a]));
	const problems: Problem[] = [];
	const rows: { account: string; amount: number; date: string; closes: boolean; isNew: boolean }[] = [];

	items.forEach((item, i) => {
		const name = item.account.trim();
		const existing = known.get(name.toLowerCase());
		const amount = toMinor(item.balance);
		const date = item.date ?? today;
		if (!name) problems.push({ item: i, error: "Account name is empty." });
		if (amount === null) {
			problems.push({
				item: i,
				error: item.balance < 0 ? "A Balance check can't be negative." : "Balance must be a number with at most 2 decimals.",
				hint: item.balance < 0 ? "Credit cards and loans aren't Accounts here." : undefined,
			});
		}
		if (item.close && amount !== 0) {
			problems.push({ item: i, error: "Only a Balance check of 0 can close an Account." });
		}
		if (!isIsoDate(date)) {
			problems.push({ item: i, error: `"${date}" isn't a date.`, hint: "Use YYYY-MM-DD." });
		} else if (date > today) {
			problems.push({ item: i, error: `${date} is in the future (today is ${today}).` });
		} else if (existing && date < existing.firstCheck) {
			problems.push({
				item: i,
				error: `${existing.name} was set up on ${existing.firstCheck}; nothing can be dated before that.`,
			});
		}
		rows.push({ account: existing?.name ?? name, amount: amount ?? 0, date, closes: Boolean(item.close), isNew: !existing });
	});
	if (problems.length > 0) return { ok: false, error: "Nothing was saved.", problems };

	const batch = [db.prepare("INSERT INTO batches (user_id) VALUES (?)").bind(userId)];
	for (const name of new Set(rows.filter((r) => r.isNew).map((r) => r.account))) {
		batch.push(db.prepare("INSERT OR IGNORE INTO accounts (user_id, name) VALUES (?, ?)").bind(userId, name));
	}
	const firstItem = batch.length;
	for (const r of rows) {
		batch.push(
			db
				.prepare(
					`INSERT INTO items (user_id, batch_id, kind, date, amount, account_id, closes)
					VALUES (?1, (SELECT max(id) FROM batches WHERE user_id = ?1), 'balance_check', ?2, ?3,
						(SELECT id FROM accounts WHERE user_id = ?1 AND name = ?4), ?5)
					RETURNING id`,
				)
				.bind(userId, r.date, r.amount, r.account, r.closes ? 1 : 0),
		);
	}
	const results = await db.batch<{ id: number }>(batch);
	const ids = results.slice(firstItem).map((r) => `e${r.results[0].id}`);

	const parts = rows.map((r) => {
		const what = `${r.account} ${money(r.amount, me.currency)}`;
		if (r.closes) return `closed ${r.account}`;
		if (r.isNew) return `set up ${what}`;
		return `checked ${what}${r.date === today ? "" : ` on ${day(r.date)}`}`;
	});
	const summary = parts.join(" · ");
	return {
		ok: true,
		summary: summary.charAt(0).toUpperCase() + summary.slice(1),
		ids,
		next: known.size === 0 ? AFTER_FIRST_SETUP : undefined,
	};
}

export async function setProfile(
	db: D1Database,
	userId: number,
	defaults: Defaults,
	input: { currency?: string; timezone?: string },
): Promise<Result> {
	const me = await profile(db, userId, defaults);
	const currency = input.currency?.trim().toUpperCase();
	const timezone = input.timezone?.trim();
	if (!currency && !timezone) return { ok: false, error: "Give a currency, a timezone, or both." };
	if (currency && !/^[A-Z]{3}$/.test(currency)) {
		return { ok: false, error: `"${input.currency}" isn't a currency code.`, hint: "Use an ISO code like PHP or USD." };
	}
	if (timezone && !isTimezone(timezone)) {
		return { ok: false, error: `"${timezone}" isn't a timezone.`, hint: "Use an IANA name like Asia/Manila." };
	}
	if (currency && currency !== me.currency) {
		const logged = await db.prepare("SELECT 1 FROM items WHERE user_id = ? LIMIT 1").bind(userId).first();
		if (logged) {
			return { ok: false, error: `Currency is ${me.currency} and can't change once anything is logged.` };
		}
	}
	const next = { currency: currency ?? me.currency, timezone: timezone ?? me.timezone };
	await db
		.prepare("UPDATE users SET currency = ?, timezone = ? WHERE id = ?")
		.bind(next.currency, next.timezone, userId)
		.run();
	return { ok: true, summary: `Currency ${next.currency}, timezone ${next.timezone} (today is ${todayIn(next.timezone)}).` };
}
