import { isIsoDate, money, period, todayIn } from "./format";
import { type Defaults, describe, profile, type Result } from "./ledger";
import { balances, totalRows } from "./queries";

type Flow = "income" | "spending";
type Kind = Flow | "transfer" | "estimate" | "balance_check";

export type ReportInput = {
	view: "totals" | "balances" | "entries";
	from?: string;
	to?: string;
	group_by?: "category" | "account" | "month";
	account?: string;
	category?: string;
	kind?: Kind;
	text?: string;
};

const ENTRY_LIMIT = 50;

export async function report(db: D1Database, userId: number, defaults: Defaults, input: ReportInput): Promise<Result> {
	const me = await profile(db, userId, defaults);
	const today = todayIn(me.timezone);
	const to = input.to ?? today;
	const from = input.from ?? (input.view === "entries" ? "0000-01-01" : `${to.slice(0, 8)}01`);
	for (const date of [from, to]) {
		if (date !== "0000-01-01" && !isIsoDate(date)) return { ok: false, error: `"${date}" isn't a date.`, hint: "Use YYYY-MM-DD." };
	}
	if (from > to) return { ok: false, error: `from ${from} is after to ${to}.` };

	if (input.view === "balances") {
		const all = await balances(db, userId);
		const open = all.filter((a) => !a.closed);
		const total = open.reduce((sum, a) => sum + a.balance, 0);
		return {
			ok: true,
			summary: open.length
				? `${open.map((a) => `${a.name} ${money(a.balance, me.currency)}`).join(" · ")} (${money(total, me.currency)} in all)`
				: "No Accounts yet.",
			data: {
				accounts: open.map((a) => ({ name: a.name, balance: money(a.balance, me.currency), last_check: a.lastCheck })),
				closed_accounts: all.filter((a) => a.closed).map((a) => a.name),
			},
		};
	}

	if (input.view === "entries") return entries(db, userId, me.currency, { ...input, from, to });
	return totals(db, userId, me.currency, { ...input, from, to });
}

async function entries(db: D1Database, userId: number, currency: string, input: ReportInput & { from: string; to: string }): Promise<Result> {
	const where = ["i.user_id = ?", "i.date BETWEEN ? AND ?"];
	const binds: unknown[] = [userId, input.from, input.to];
	if (input.account) {
		where.push("(a.name = ? OR t.name = ?)");
		binds.push(input.account.trim(), input.account.trim());
	}
	if (input.category) {
		if (/^uncategori[sz]ed$/i.test(input.category.trim())) where.push("i.category_id IS NULL AND i.kind IN ('income', 'spending', 'estimate')");
		else {
			where.push("c.name = ?");
			binds.push(input.category.trim());
		}
	}
	if (input.kind) {
		where.push("i.kind = ?");
		binds.push(input.kind);
	}
	if (input.text) {
		where.push("i.note LIKE ?");
		binds.push(`%${input.text.trim()}%`);
	}
	const { results } = await db
		.prepare(
			`SELECT i.id, i.kind, i.date, i.start_date, i.amount, i.flow, i.note, i.closes,
				a.name AS account, t.name AS to_account, c.name AS category
			FROM items i JOIN accounts a ON a.id = i.account_id
			LEFT JOIN accounts t ON t.id = i.to_account_id LEFT JOIN categories c ON c.id = i.category_id
			WHERE ${where.join(" AND ")} ORDER BY i.date DESC, i.id DESC LIMIT ${ENTRY_LIMIT + 1}`,
		)
		.bind(...binds)
		.all<Parameters<typeof describe>[0] & { id: number }>();
	const more = results.length > ENTRY_LIMIT;
	const rows = results.slice(0, ENTRY_LIMIT);
	return {
		ok: true,
		summary: rows.length ? `${rows.length}${more ? "+" : ""} item${rows.length === 1 ? "" : "s"}, newest first.` : "No items match.",
		ids: rows.map((r) => `e${r.id}`),
		data: { entries: rows.map((r) => `e${r.id} ${describe(r, currency)}`), more },
	};
}

async function totals(db: D1Database, userId: number, currency: string, input: ReportInput & { from: string; to: string }): Promise<Result> {
	const [rows, accounts, categories] = await Promise.all([
		totalRows(db, userId, input.from, input.to),
		db.prepare("SELECT id, name FROM accounts WHERE user_id = ?").bind(userId).all<{ id: number; name: string }>(),
		db.prepare("SELECT id, name FROM categories WHERE user_id = ?").bind(userId).all<{ id: number; name: string }>(),
	]);
	const accountName = new Map(accounts.results.map((a) => [a.id, a.name]));
	const categoryName = new Map(categories.results.map((c) => [c.id, c.name]));
	const label = (r: (typeof rows)[number]) =>
		r.source === "unaccounted" ? "Unaccounted" : r.category_id ? categoryName.get(r.category_id)! : "Uncategorized";

	const lower = (s?: string) => s?.trim().toLowerCase();
	if (input.account && !accounts.results.some((a) => lower(a.name) === lower(input.account))) {
		return { ok: false, error: `No Account named "${input.account}". Known: ${accounts.results.map((a) => a.name).join(", ") || "none yet"}.` };
	}
	const picked = rows.filter(
		(r) =>
			(!input.account || lower(accountName.get(r.account_id)) === lower(input.account)) &&
			(!input.category || lower(label(r)) === lower(input.category)) &&
			(!input.kind || r.flow === input.kind) &&
			(!input.text || (r.note ?? "").toLowerCase().includes(lower(input.text)!)),
	);

	const groupBy = input.group_by ?? "category";
	const keyOf = (r: (typeof rows)[number]) =>
		groupBy === "account" ? accountName.get(r.account_id)! : groupBy === "month" ? r.date.slice(0, 7) : label(r);
	const side = (flow: Flow) => {
		const lines = new Map<string, { amount: number; estimated: number }>();
		let total = 0;
		for (const r of picked.filter((r) => r.flow === flow)) {
			const line = lines.get(keyOf(r)) ?? { amount: 0, estimated: 0 };
			line.amount += r.amount;
			if (r.source === "estimate") line.estimated += r.amount;
			lines.set(keyOf(r), line);
			total += r.amount;
		}
		const sorted = [...lines].sort(([a, x], [b, y]) => (groupBy === "month" ? a.localeCompare(b) : y.amount - x.amount));
		return {
			total,
			lines: sorted.map(([name, l]) => ({
				name,
				amount: money(l.amount, currency),
				...(l.estimated > 0 && { estimated: money(l.estimated, currency) }),
			})),
		};
	};
	const income = side("income");
	const spending = side("spending");
	const span = period(input.from, input.to);
	const parts = [
		...(input.kind !== "income" ? [`spent ${money(spending.total, currency)}`] : []),
		...(input.kind !== "spending" ? [`received ${money(income.total, currency)}`] : []),
	];
	const filters = [input.category, input.account, input.text && `"${input.text}"`].filter(Boolean).join(", ");
	return {
		ok: true,
		summary: `${span}${filters ? ` (${filters})` : ""}: ${parts.join(", ")}.`,
		data: {
			from: input.from,
			to: input.to,
			spending: { total: money(spending.total, currency), lines: spending.lines },
			income: { total: money(income.total, currency), lines: income.lines },
			net: `${income.total - spending.total < 0 ? "−" : ""}${money(Math.abs(income.total - spending.total), currency)}`,
		},
	};
}
