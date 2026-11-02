import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Defaults, type Result, record, setProfile, status } from "./ledger";

function reply(result: Result) {
	const { ok, ...body } = result;
	return { content: [{ type: "text" as const, text: JSON.stringify(body) }], isError: !ok };
}

export function registerTools(server: McpServer, db: D1Database, userId: number, defaults: Defaults) {
	server.registerTool(
		"finance_status",
		{
			description:
				"Money, spending, balances, budget: the finance tracker's overview. Call this FIRST in any chat about the user's money, before other finance_* tools. Returns today's date, Accounts with Balances, Categories and recent items; follow its `next` hint when present.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => reply(await status(db, userId, defaults)),
	);

	server.registerTool(
		"finance_record",
		{
			description:
				"Log money. Balance check: what an Account holds right now (\"GCash has 4,750\"); the first one for a name sets that Account up. items[] is saved all-or-nothing. balance is a plain positive number in the user's currency; date is YYYY-MM-DD (omit for today; resolve \"yesterday\" from finance_status's today). Use proper names (GCash, BPI, Cash). Close an Account with balance 0 and close: true. Save straight away, then repeat `summary` briefly in your own words; ask first only if the Account or amount is unclear.",
			inputSchema: z.object({
				items: z
					.array(
						z.object({
							kind: z.enum(["balance_check"]),
							account: z.string(),
							balance: z.number(),
							date: z.string().optional(),
							close: z.boolean().optional(),
						}),
					)
					.min(1)
					.max(50),
			}),
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		},
		async ({ items }) => reply(await record(db, userId, defaults, items)),
	);

	server.registerTool(
		"finance_manage",
		{
			description:
				"Finance tracker settings. set_profile: the user's currency (ISO code, e.g. PHP) and timezone (IANA name; map their city, e.g. Manila → Asia/Manila). Currency can't change once anything is logged.",
			inputSchema: z.object({
				action: z.enum(["set_profile"]),
				currency: z.string().optional(),
				timezone: z.string().optional(),
			}),
			annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		},
		async ({ currency, timezone }) => reply(await setProfile(db, userId, defaults, { currency, timezone })),
	);
}
