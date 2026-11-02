// The `next` hints in tool results. There's no claude.ai Skill (ADR 0003), so these
// carry the onboarding (issue 10) and Catch-up (issue 9) scripts.

import type { Gap } from "./queries";
import { period } from "./format";

// Setup is a fixed sequence of screens, like an app's: the server owns the copy (`say`), and
// Claude shows it as written. Every tool result carries the current screen until setup is done
// (tools.ts), so any finance chat goes back to setup first.

export type Screen = { say: string; next: string };

const RULES =
	"Setup isn't finished: show `say` to the user exactly as written, before anything else, and wait for their answer. Never fill in settings or Accounts from memory or other tools (Todoist, notes); only what they tell you counts. If they mentioned a Transaction before setup, say once (first screen only): \"I'll log that once you're set up.\", and log it in the setup finance_record call.";

export const STARTER_CATEGORIES = {
	spending: ["Food", "Groceries", "Transport", "Bills", "Shopping", "Fun"],
	income: ["Salary"],
};

export const SETUP_WELCOME: Screen = {
	say: `Welcome to Finance Tracker! Before anything else, let's get you set up. It takes about a minute.

Step 1 of 3 · Currency and city
What currency do you use, and which city are you in? (e.g. "PHP, Manila")`,
	next: `${RULES} On their answer, call finance_manage set_profile (ISO currency; IANA timezone from the city). Its result has the next screen.`,
};

/** Examples in the user's own terms: Philippine accounts for PHP, generic ones otherwise. */
function examples(currency: string) {
	return currency === "PHP"
		? { money: "GCash 4,750, BPI 20k, cash 800", logs: ['"jeep 40"', '"salary 30k to BPI"', '"moved 2k BPI to GCash"'] }
		: { money: "checking 3,200, savings 10k, cash 80", logs: ['"coffee 5"', '"paycheck 2k to checking"', '"moved 500 checking to savings"'] };
}

export function setupMoney(currency: string): Screen {
	return {
		say: `Step 2 of 3 · Your money
Where do you keep money, and roughly how much is in each right now? Rough is fine. (e.g. "${examples(currency).money}")`,
		next: `${RULES} On their answer, make ONE finance_record call: any Transaction they mentioned first, then a balance_check per place (wallet or cash → "Cash"; amounts like 20k → 20000). Its result has the next screen.`,
	};
}

export const SETUP_CATEGORIES: Screen = {
	say: `Step 3 of 3 · Categories
Want to sort your money into categories? I'll start you with ${STARTER_CATEGORIES.spending.join(", ")}, plus ${STARTER_CATEGORIES.income.join(", ")} for income. They're optional, and you can change them anytime.
Reply "yes" or "skip".`,
	next: `${RULES} On their answer, call finance_manage setup_categories with choice "starter" (yes, sure, ok) or "skip" (no, skip). If they name their own Categories, use choice "starter" only if they agreed to the set, then add theirs with add_category.`,
};

export function setupDone(added: boolean, currency: string): Screen {
	return {
		say: `${added ? "Categories added. " : ""}You're all set! Here's how it works:
• Just tell me what happened: ${examples(currency).logs.join(", ")}
• Ask anything: "how much did I spend this week?"
• Missed a few days? I'll help you catch up with rough totals
• Made a mistake? Say "undo"

What have you spent today?`,
		next: "Show `say` exactly as written, ending on its last question. If the user asked something before setup, answer it in one short line BEFORE `say`. If they mentioned a Transaction during setup that isn't logged yet, log it now and confirm it in one line before `say`.",
	};
}

export function catchUp(gap: Gap): string {
	const span = period(gap.from, gap.to);
	return `Nothing logged ${span} (${gap.days} days). After handling what the user asked, offer a quick Catch-up ONCE this chat (~2 min); also if they say "catch up". If yes: (1) in one message ask every open Account's Balance right now, showing the Balance you have; then show how each changed. (2) Ask for Transfers and big one-offs in ${span} (salary, rent, bills), with dates if they know them, else ${gap.to}. (3) Per Account, ask once what the rest mostly went to (fine to skip); never walk through every Category. "The rest is X" means that Estimate takes whatever change is left, so Unaccounted is 0. (4) Show ONE summary: items, Estimates (~) over ${span}, Unaccounted per Account if not 0; ask once to save; offer to add any new Category in the same yes. (5) On yes: ONE finance_record call ordered Transfers, Income/Spending, Estimates (start ${gap.from}, end ${gap.to}), Balance checks LAST (dated today). "Just balances" → only the Balance checks. Skip an Account whose Balance they don't know.`;
}

const SUGGESTED = {
	spending: "Food (eating out), Groceries, Transport, Bills (utilities, phone, internet, rent), Subscriptions, Shopping, Health, Fun, Gifts, Other",
	income: "Salary, Side income, Allowance, Interest, Gifts, Other",
};

export function unknownCategory(flow: "income" | "spending", known: string[]): string {
	return `Known ${flow} Categories: ${known.join(", ") || "none yet"}. Ask whether to add it (finance_manage add_category, then log again), use a known one, or log it without a Category. Suggested ${flow} Categories: ${SUGGESTED[flow]}.`;
}

export const UNKNOWN_ACCOUNT = "A new Account starts with a balance_check of what it holds now (it can go in the same finance_record call, after the Transactions). Never guess an Account; ask.";
