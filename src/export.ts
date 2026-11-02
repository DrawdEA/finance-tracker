// Export (#24): a short-lived link to one CSV of everything the user logged.

import { profile, type Defaults } from "./ledger";

const TTL_SECONDS = 15 * 60;

/** A random token in KV pointing at the user, valid 15 minutes. */
export async function createExportLink(kv: KVNamespace, userId: number, origin: string): Promise<string> {
	const token = crypto.randomUUID();
	await kv.put(`export:${token}`, String(userId), { expirationTtl: TTL_SECONDS });
	return `${origin}/export/${token}`;
}

export async function exportUserId(kv: KVNamespace, token: string): Promise<number | null> {
	const userId = await kv.get(`export:${token}`);
	return userId ? Number(userId) : null;
}

const COLUMNS = ["id", "kind", "date", "start_date", "amount", "currency", "flow", "account", "to_account", "category", "note", "closes_account"];

const cell = (value: unknown) => {
	const text = value === null || value === undefined ? "" : String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Every item, oldest first. An Estimate's date is its Period's last day; Category names include removed ones. */
export async function exportCsv(db: D1Database, userId: number, defaults: Defaults): Promise<string> {
	const me = await profile(db, userId, defaults);
	const { results } = await db
		.prepare(
			`SELECT i.id, i.kind, i.date, i.start_date, i.amount, i.flow, a.name AS account, t.name AS to_account,
				c.name AS category, i.note, i.closes
			FROM items i JOIN accounts a ON a.id = i.account_id
			LEFT JOIN accounts t ON t.id = i.to_account_id LEFT JOIN categories c ON c.id = i.category_id
			WHERE i.user_id = ? ORDER BY i.date, i.id`,
		)
		.bind(userId)
		.all<Record<string, string | number | null>>();
	const lines = results.map((r) =>
		[
			`e${r.id}`,
			r.kind,
			r.date,
			r.start_date,
			((r.amount as number) / 100).toFixed(2),
			me.currency,
			r.flow,
			r.account,
			r.to_account,
			r.category,
			r.note,
			r.closes ? "yes" : "",
		]
			.map(cell)
			.join(","),
	);
	return [COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}
