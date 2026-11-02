import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { amend, type Defaults, type Result, record, status } from "./ledger";
import { addCategory, deleteAccount, removeCategory, renameAccount, renameCategory, setProfile } from "./manage";
import { report } from "./report";

function reply(result: Result) {
	const { ok, ...body } = result;
	return { content: [{ type: "text" as const, text: JSON.stringify(body) }], isError: !ok };
}

const amount = z.number().describe("Positive, in the user's currency; the kind gives the direction.");
const date = z.string().optional().describe("YYYY-MM-DD from finance_status today; omit for today.");
const flow = z.enum(["income", "spending"]);
const note = z.string().optional().describe("Merchant or detail.");

const item = z.discriminatedUnion("kind", [
	z.object({ kind: z.enum(["income", "spending"]), amount, account: z.string(), date, category: z.string().optional(), note }),
	z.object({ kind: z.literal("transfer"), amount, from: z.string(), to: z.string(), date, note }),
	z.object({
		kind: z.literal("estimate"),
		flow,
		amount: amount.describe("Approximate total for the Period."),
		start: z.string(),
		end: z.string(),
		account: z.string(),
		category: z.string().optional(),
		note,
	}),
	z.object({
		kind: z.literal("balance_check"),
		account: z.string(),
		balance: z.number(),
		date,
		close: z.boolean().optional().describe("Only with balance 0: closes the Account."),
	}),
]);

/** Per-user throttle (#21): past it, a friendly refusal instead of the call. */
export async function throttled(limiter: RateLimit, userId: number, run: () => Promise<Result>): Promise<Result> {
	const { success } = await limiter.limit({ key: String(userId) });
	if (success) return run();
	return { ok: false, error: "Too many finance tracker calls in the last minute.", hint: "Tell the user to wait a minute, then try again." };
}

export type Deps = {
	db: D1Database;
	userId: number;
	defaults: Defaults;
	limiter: RateLimit;
	/** Revoke every grant this user holds, so the next call needs a fresh sign-in. */
	signOut: () => Promise<void>;
	/** A 15-minute download link to the user's CSV export. */
	exportLink: () => Promise<string>;
};

export function registerTools(server: McpServer, { db, userId, defaults, limiter, signOut, exportLink }: Deps) {
	const guarded = async (run: () => Promise<Result>) => reply(await throttled(limiter, userId, run));

	server.registerTool(
		"finance_status",
		{
			description:
				"Money tracker overview: balances, Accounts, Categories, recent items, Gaps. Call FIRST in any chat about the user's money (spent, paid, received, balance, how much, budget, catch up), before other finance_* tools; once per chat is enough. Gives `today` for resolving dates like \"yesterday\". Always follow its `next` hint: it carries onboarding for new users and the Catch-up script. Mention a Gap once per chat, after handling the user's request.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => guarded(() => status(db, userId, defaults)),
	);

	server.registerTool(
		"finance_record",
		{
			description:
				"Log money: spent/paid/bought (spending), received/salary (income), moved between Accounts (transfer), a rough total over a span (estimate, for catching up), and what an Account holds now (balance_check; the first one sets that Account up). items[] saves all-or-nothing, in order; on the same date, later items count after earlier ones. Account: if only one is open use it, otherwise ask; never invent one. Category is optional: map words to an existing one (lunch → Food); if none fits, ask once whether to add one (finance_manage add_category) unless the user declined Categories this chat. A transfer fee is a separate spending item. Save straight away when clear; ask first only if the Account, amount, date or a new Category is unclear. Then reply in one short line from `summary` and mention they can say \"undo\". On an error nothing is saved: fix and resend, or ask.",
			inputSchema: z.object({ items: z.array(item).min(1).max(50) }),
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		},
		async ({ items }) => guarded(() => record(db, userId, defaults, items)),
	);

	server.registerTool(
		"finance_report",
		{
			description:
				"Answer money questions. view totals: how much spent/received, grouped by category, account or month (itemized Transactions plus the unfilled part of Estimates, marked estimated; Unaccounted and Uncategorized are their own lines; Transfers excluded). view balances: what each Account holds. view entries: find items, newest first, with ids for finance_amend. from/to are YYYY-MM-DD (default: this month). Answer in a line or two; don't dump the data.",
			inputSchema: z.object({
				view: z.enum(["totals", "balances", "entries"]),
				from: z.string().optional(),
				to: z.string().optional(),
				group_by: z.enum(["category", "account", "month"]).optional(),
				account: z.string().optional(),
				category: z.string().optional().describe("A Category, Uncategorized, or Unaccounted (totals)."),
				kind: z.enum(["income", "spending", "transfer", "estimate", "balance_check"]).optional(),
				text: z.string().optional().describe("Search notes."),
			}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (input) => guarded(() => report(db, userId, defaults, input)),
	);

	server.registerTool(
		"finance_amend",
		{
			description:
				"Fix logged items: undo, delete, edit. {undo: \"last\"} removes the whole latest finance_record call (\"undo\", \"scratch that\"). {ids: [\"e42\"], delete: true} removes items. {id: \"e42\", set: {...}} edits one item (only the fields given); its kind can't change, so delete and re-log instead. Ids come from finance_record, finance_status recent, or finance_report entries. Deletes are permanent and there's no undo of an undo; `removed` lists what went, so it can be re-logged. Confirm in one short line.",
			inputSchema: z.object({
				undo: z.literal("last").optional(),
				ids: z.array(z.string()).optional(),
				delete: z.boolean().optional(),
				id: z.string().optional(),
				set: z
					.object({
						amount: z.number().optional(),
						balance: z.number().optional(),
						date: z.string().optional(),
						start: z.string().optional(),
						end: z.string().optional(),
						account: z.string().optional(),
						from: z.string().optional(),
						to: z.string().optional(),
						flow: flow.optional(),
						category: z.string().nullable().optional().describe("null clears it."),
						note: z.string().nullable().optional(),
						close: z.boolean().optional(),
					})
					.optional(),
			}),
			annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		},
		async (input) => guarded(() => amend(db, userId, defaults, input)),
	);

	server.registerTool(
		"finance_manage",
		{
			description:
				"Finance tracker settings. set_profile: currency (ISO code) and timezone (IANA name from their city, e.g. Manila → Asia/Manila); currency locks once anything is logged. add_category {name, flow}: only after the user agrees. rename_category / rename_account {name, new_name}. remove_category {name}: hidden if used, deleted if not. delete_account: permanently deletes ALL the user's data and signs them out; only when they ask, and call with confirm: \"DELETE\" only after they explicitly say yes to the warning. export: a 15-minute download link to a CSV of everything logged. Privacy: /privacy on this server. Accounts are created by a first balance_check and closed by a balance_check of 0 with close: true (finance_record).",
			inputSchema: z.object({
				action: z.enum(["set_profile", "add_category", "rename_category", "remove_category", "rename_account", "delete_account", "export"]),
				name: z.string().optional(),
				new_name: z.string().optional(),
				flow: flow.optional(),
				currency: z.string().optional(),
				timezone: z.string().optional(),
				confirm: z.string().optional().describe('delete_account only: "DELETE", after the user explicitly said yes.'),
			}),
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		},
		async (input) =>
			guarded(async () => {
				switch (input.action) {
					case "set_profile":
						return setProfile(db, userId, defaults, input);
					case "add_category":
						return addCategory(db, userId, input);
					case "rename_category":
						return renameCategory(db, userId, input);
					case "remove_category":
						return removeCategory(db, userId, input);
					case "rename_account":
						return renameAccount(db, userId, input);
					case "delete_account":
						return deleteAccount(db, userId, input.confirm, signOut);
					case "export":
						return {
							ok: true,
							summary: `CSV of everything logged, link valid 15 minutes: ${await exportLink()}`,
							next: "Give the user the link as-is; it downloads a CSV (one row per item) and expires in 15 minutes.",
						};
				}
			}),
	);
}
