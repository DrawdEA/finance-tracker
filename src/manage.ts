import { isTimezone, todayIn } from "./format";
import { STARTER_CATEGORIES, setupDone } from "./hints";
import { type Defaults, profile, type Result } from "./ledger";

type Flow = "income" | "spending";

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

type Cat = { id: number; name: string; flow: Flow; hidden: number };

/** Visible Categories called `name`, narrowed to `flow` when given; an error when none or ambiguous. */
async function findCategory(db: D1Database, userId: number, name: string, flow?: Flow): Promise<Cat | Result> {
	const { results } = await db
		.prepare("SELECT id, name, flow, hidden FROM categories WHERE user_id = ? AND name = ? AND hidden = 0")
		.bind(userId, name.trim())
		.all<Cat>();
	const matches = results.filter((c) => !flow || c.flow === flow);
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) return { ok: false, error: `${matches[0].name} is both an Income and a Spending Category.`, hint: "Say which with flow." };
	const known = await db
		.prepare("SELECT name, flow FROM categories WHERE user_id = ? AND hidden = 0 ORDER BY flow, name")
		.bind(userId)
		.all<{ name: string; flow: Flow }>();
	return {
		ok: false,
		error: `No Category "${name}".`,
		hint: `Known: ${known.results.map((c) => `${c.name} (${c.flow})`).join(", ") || "none yet"}.`,
	};
}

const isResult = (value: Cat | Result): value is Result => "ok" in value;

function cleanName(name: string | undefined): string | Result {
	const clean = name?.trim().replace(/\s+/g, " ");
	if (!clean) return { ok: false, error: "Give a name." };
	if (clean.length > 40) return { ok: false, error: "Names are at most 40 characters." };
	return clean;
}

/** add_category with one name or several (a starter set during setup). */
export async function addCategories(db: D1Database, userId: number, input: { name?: string; names?: string[]; flow?: Flow }): Promise<Result> {
	const names = input.names?.length ? input.names : [input.name ?? ""];
	if (names.length === 1) return addCategory(db, userId, { name: names[0], flow: input.flow });
	const results = [];
	for (const name of names) results.push(await addCategory(db, userId, { name, flow: input.flow }));
	const done = results.filter((r) => r.ok).map((r) => (r as { summary: string }).summary.replace(/ \((income|spending)\)\.$/, "").replace(/^(Added|Brought back) /, ""));
	const failed = results.filter((r) => !r.ok).map((r) => (r as { error: string }).error);
	if (done.length === 0) return { ok: false, error: failed.join(" ") };
	return { ok: true, summary: `Added ${done.join(", ")} (${input.flow}).${failed.length ? ` Skipped: ${failed.join(" ")}` : ""}` };
}

export async function addCategory(db: D1Database, userId: number, input: { name?: string; flow?: Flow }): Promise<Result> {
	const name = cleanName(input.name);
	if (typeof name !== "string") return name;
	if (!input.flow) return { ok: false, error: "Say whether it's an income or a spending Category (flow)." };
	const existing = await db
		.prepare("SELECT id, name, hidden FROM categories WHERE user_id = ? AND flow = ? AND name = ?")
		.bind(userId, input.flow, name)
		.first<{ id: number; name: string; hidden: number }>();
	if (existing && !existing.hidden) return { ok: false, error: `${existing.name} already exists.` };
	if (existing) {
		await db.prepare("UPDATE categories SET hidden = 0 WHERE id = ?").bind(existing.id).run();
		return { ok: true, summary: `Brought back ${existing.name} (${input.flow}).` };
	}
	await db.prepare("INSERT INTO categories (user_id, name, flow) VALUES (?, ?, ?)").bind(userId, name, input.flow).run();
	return { ok: true, summary: `Added ${name} (${input.flow}).` };
}

export async function renameCategory(
	db: D1Database,
	userId: number,
	input: { name?: string; new_name?: string; flow?: Flow },
): Promise<Result> {
	const found = await findCategory(db, userId, input.name ?? "", input.flow);
	if (isResult(found)) return found;
	const name = cleanName(input.new_name);
	if (typeof name !== "string") return name;
	const clash = await db
		.prepare("SELECT 1 FROM categories WHERE user_id = ? AND flow = ? AND name = ? AND id != ?")
		.bind(userId, found.flow, name, found.id)
		.first();
	if (clash) return { ok: false, error: `There's already a ${found.flow} Category called ${name}.` };
	await db.prepare("UPDATE categories SET name = ? WHERE id = ?").bind(name, found.id).run();
	return { ok: true, summary: `Renamed ${found.name} to ${name}.` };
}

export async function removeCategory(db: D1Database, userId: number, input: { name?: string; flow?: Flow }): Promise<Result> {
	const found = await findCategory(db, userId, input.name ?? "", input.flow);
	if (isResult(found)) return found;
	const used = await db.prepare("SELECT 1 FROM items WHERE user_id = ? AND category_id = ? LIMIT 1").bind(userId, found.id).first();
	if (used) {
		await db.prepare("UPDATE categories SET hidden = 1 WHERE id = ?").bind(found.id).run();
		return { ok: true, summary: `Removed ${found.name}; its history keeps the name.` };
	}
	await db.prepare("DELETE FROM categories WHERE id = ?").bind(found.id).run();
	return { ok: true, summary: `Removed ${found.name}.` };
}

export async function renameAccount(db: D1Database, userId: number, input: { name?: string; new_name?: string }): Promise<Result> {
	const account = await db
		.prepare("SELECT id, name FROM accounts WHERE user_id = ? AND name = ?")
		.bind(userId, input.name?.trim() ?? "")
		.first<{ id: number; name: string }>();
	if (!account) {
		const known = await db.prepare("SELECT name FROM accounts WHERE user_id = ? ORDER BY name").bind(userId).all<{ name: string }>();
		return { ok: false, error: `No Account named "${input.name}". Known: ${known.results.map((a) => a.name).join(", ") || "none yet"}.` };
	}
	const name = cleanName(input.new_name);
	if (typeof name !== "string") return name;
	const clash = await db.prepare("SELECT 1 FROM accounts WHERE user_id = ? AND name = ? AND id != ?").bind(userId, name, account.id).first();
	if (clash) return { ok: false, error: `There's already an Account called ${name}.` };
	await db.prepare("UPDATE accounts SET name = ? WHERE id = ?").bind(name, account.id).run();
	return { ok: true, summary: `Renamed ${account.name} to ${name}.` };
}

/** Setup's last screen: add the starter Categories or skip them, then mark setup done. */
export async function setupCategories(db: D1Database, userId: number, defaults: Defaults, choice: string | undefined): Promise<Result> {
	if (choice !== "starter" && choice !== "skip") return { ok: false, error: 'choice must be "starter" or "skip".' };
	const me = await profile(db, userId, defaults);
	const hasAccount = await db.prepare("SELECT 1 FROM accounts WHERE user_id = ? LIMIT 1").bind(userId).first();
	const missing = [!me.set && "currency and city (set_profile)", !hasAccount && "at least one Account (a balance_check)"].filter(Boolean);
	if (missing.length) return { ok: false, error: `Setup still needs ${missing.join(" and ")}.` };
	const add = choice === "starter" ? (Object.entries(STARTER_CATEGORIES) as [Flow, string[]][]) : [];
	await db.batch([
		...add.flatMap(([flow, names]) =>
			names.map((name) =>
				db
					.prepare("INSERT INTO categories (user_id, name, flow) VALUES (?, ?, ?) ON CONFLICT (user_id, flow, name) DO UPDATE SET hidden = 0")
					.bind(userId, name, flow),
			),
		),
		db.prepare("UPDATE users SET onboarded_at = datetime('now') WHERE id = ? AND onboarded_at IS NULL").bind(userId),
	]);
	const done = setupDone(choice === "starter", me.currency);
	return { ok: true, summary: "Setup complete.", say: done.say, next: done.next };
}
