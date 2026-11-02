// Derived numbers: Balances, effective Estimates, Unaccounted and Gap are computed
// from items on every read, never stored (ADR 0001). ?1 is always the user id.

import { addDays } from "./format";

/** Each Estimate with its effective amount: what itemized Transactions in its Period haven't filled. */
const EST = `est AS (
	SELECT e.id, e.account_id, e.category_id, e.flow, e.start_date, e.date, e.note, e.amount,
		MAX(0, e.amount - COALESCE((
			SELECT SUM(t.amount) FROM items t
			WHERE t.user_id = ?1 AND t.account_id = e.account_id AND t.kind = e.flow
				AND t.category_id IS e.category_id AND t.date BETWEEN e.start_date AND e.date
		), 0)) AS effective
	FROM items e WHERE e.user_id = ?1 AND e.kind = 'estimate'
)`;

/** Every change to an Account's Balance, at (date, log sequence). An Estimate counts on its last day. */
const EFF = `eff(acc, d, seq, delta) AS (
	SELECT account_id, date, id, CASE kind WHEN 'income' THEN amount ELSE -amount END
	FROM items WHERE user_id = ?1 AND kind IN ('income', 'spending', 'transfer')
	UNION ALL
	SELECT to_account_id, date, id, amount FROM items WHERE user_id = ?1 AND kind = 'transfer'
	UNION ALL
	SELECT account_id, date, id, CASE flow WHEN 'income' THEN effective ELSE -effective END FROM est
)`;

/** Unaccounted between each Balance check and the one before it on the same Account. */
const UNACC = `ch AS (
	SELECT account_id, date, id, amount,
		LAG(date) OVER w AS pd, LAG(id) OVER w AS ps, LAG(amount) OVER w AS pa
	FROM items WHERE user_id = ?1 AND kind = 'balance_check'
	WINDOW w AS (PARTITION BY account_id ORDER BY date, id)
),
unacc AS (
	SELECT ch.account_id, ch.date, ch.id, ch.amount - ch.pa - COALESCE((
		SELECT SUM(delta) FROM eff
		WHERE eff.acc = ch.account_id AND (eff.d, eff.seq) > (ch.pd, ch.ps) AND (eff.d, eff.seq) < (ch.date, ch.id)
	), 0) AS amount
	FROM ch WHERE ch.pa IS NOT NULL
)`;

export type AccountState = {
	id: number;
	name: string;
	balance: number;
	lastCheck: string;
	firstCheck: string;
	closed: boolean;
};

/** Every Account with its Balance: latest Balance check plus everything after it in (date, log order). */
export async function balances(db: D1Database, userId: number): Promise<AccountState[]> {
	const { results } = await db
		.prepare(
			`WITH ${EST}, ${EFF},
			checks AS (
				SELECT account_id, amount, date, id, closes,
					ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY date DESC, id DESC) AS latest,
					MIN(date) OVER (PARTITION BY account_id) AS first_check
				FROM items WHERE user_id = ?1 AND kind = 'balance_check'
			)
			SELECT a.id, a.name, c.date AS last_check, c.first_check, c.closes,
				c.amount + COALESCE((
					SELECT SUM(delta) FROM eff WHERE eff.acc = a.id AND (eff.d, eff.seq) > (c.date, c.id)
				), 0) AS balance
			FROM accounts a JOIN checks c ON c.account_id = a.id AND c.latest = 1
			WHERE a.user_id = ?1 ORDER BY a.name`,
		)
		.bind(userId)
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

/** Unaccounted for the Balance checks with these ids (0 for an Account's first check). */
export async function unaccountedAt(db: D1Database, userId: number, checkIds: number[]): Promise<Map<number, number>> {
	if (checkIds.length === 0) return new Map();
	const { results } = await db
		.prepare(
			`WITH ${EST}, ${EFF}, ${UNACC}
			SELECT id, amount FROM unacc WHERE id IN (${checkIds.map(() => "?").join(",")})`,
		)
		.bind(userId, ...checkIds)
		.all<{ id: number; amount: number }>();
	return new Map(results.map((r) => [r.id, r.amount]));
}

export type TotalRow = {
	source: "itemized" | "estimate" | "unaccounted";
	flow: "income" | "spending";
	account_id: number;
	category_id: number | null;
	date: string;
	amount: number;
	note: string | null;
};

/** Income and Spending in [from, to]: itemized Transactions, effective Estimates, Unaccounted. Transfers excluded. */
export async function totalRows(db: D1Database, userId: number, from: string, to: string): Promise<TotalRow[]> {
	const { results } = await db
		.prepare(
			`WITH ${EST}, ${EFF}, ${UNACC}
			SELECT 'itemized' AS source, kind AS flow, account_id, category_id, date, amount, note
			FROM items WHERE user_id = ?1 AND kind IN ('income', 'spending') AND date BETWEEN ?2 AND ?3
			UNION ALL
			SELECT 'estimate', flow, account_id, category_id, date, effective, note
			FROM est WHERE effective > 0 AND date BETWEEN ?2 AND ?3
			UNION ALL
			SELECT 'unaccounted', CASE WHEN amount > 0 THEN 'income' ELSE 'spending' END, account_id, NULL, date, ABS(amount), NULL
			FROM unacc WHERE amount != 0 AND date BETWEEN ?2 AND ?3`,
		)
		.bind(userId, from, to)
		.all<TotalRow>();
	return results;
}

export type Gap = { from: string; to: string; days: number };

/** The latest run of 3+ days before today with no Transaction, Balance check or Estimate Period on it. */
export async function gap(db: D1Database, userId: number, today: string): Promise<Gap | undefined> {
	const since = addDays(today, -180);
	const { results } = await db
		.prepare(
			`SELECT COALESCE(start_date, date) AS s, date AS e FROM items
			WHERE user_id = ?1 AND date >= ?2 GROUP BY s, e`,
		)
		.bind(userId, since)
		.all<{ s: string; e: string }>();
	if (results.length === 0) return undefined;
	const covered = new Set<string>();
	let first = today;
	for (const { s, e } of results) {
		if (s < first) first = s;
		for (let d = s < since ? since : s; d <= e; d = addDays(d, 1)) covered.add(d);
	}
	const yesterday = addDays(today, -1);
	let end: string | undefined;
	for (let d = yesterday; d >= first; d = addDays(d, -1)) {
		if (!covered.has(d)) {
			end ??= d;
			continue;
		}
		if (end) {
			const days = daysBetween(addDays(d, 1), end) + 1;
			if (days >= 3) return { from: addDays(d, 1), to: end, days };
			end = undefined;
		}
	}
	return undefined;
}

function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
