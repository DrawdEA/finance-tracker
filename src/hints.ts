// The `next` hints in tool results. There's no claude.ai Skill (ADR 0003), so these
// carry the onboarding (issue 10) and Catch-up (issue 9) scripts.

import type { Gap } from "./queries";
import { period } from "./format";

export const ASK_PROFILE_AND_ACCOUNTS =
	"New user: run setup step by step before anything else, one short question per message. Step 1 of 5: welcome them in one line (they log money just by chatting with you), then ask their currency and city (for dates). If they already mentioned a Transaction, keep it for step 3. Then call finance_manage set_profile; its result has the next step.";

export const ASK_ACCOUNTS =
	"Setup step 2 of 5: ask where their money sits, names only (bank accounts, e-wallets like GCash or Maya, cash). Step 3 of 5: ask roughly how much is in each right now; rough is fine, they can skip any they don't know and add places later. Then ONE finance_record call: any Transaction they already mentioned first, then a balance_check per place (wallet or cash → \"Cash\"). Its result has the next step.";

export const AFTER_FIRST_SETUP = `Setup step 4 of 5: ask once whether they want Categories, to see where money goes. If yes, propose a short starter set that fits them, from: Food (eating out), Groceries, Transport, Bills, Subscriptions, Shopping, Health, Fun; income: Salary, Side income; add what they agree to with ONE finance_manage add_category call (names, flow). If no, fine; don't offer again this chat. Step 5 of 5: explain in at most 3 short bullets: log by just saying things like "jeep 40", "salary 30k to bpi", "moved 2k bpi to gcash"; skipped days get a quick Catch-up; "undo" works anytime. Then ask what they've spent today (or confirm the Transaction already logged).`;

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
