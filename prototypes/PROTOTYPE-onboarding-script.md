# PROTOTYPE: first-run onboarding script (issue 10) — throwaway, not a spec

Empty deployment: no Accounts, no Categories. Connector added, Skill installed.

## Path A: user starts with setup

**User:** set up my finance tracker

> `finance_status` → `accounts: [], categories: []`, `next: "Empty deployment: ask where the user's money sits and its Balance now; each answer is a first Balance check."`

**Claude:** Let's set you up (~1 min). Where does your money sit, and what's in each right now? e.g. "GCash 4,750, BPI 20,000, cash 800"

**User:** gcash 4750, bpi 20k, wallet 800

> `finance_record [{balance_check GCash 4750}, {balance_check BPI 20000}, {balance_check Cash 800}]`
> → `summary: "Set up 3 Accounts: GCash ₱4,750 · BPI ₱20,000 · Cash ₱800 (₱25,550)"`

**Claude:** Set up GCash ₱4,750 · BPI ₱20,000 · Cash ₱800.
How it works:
- Tell me things like "jeep 40", "salary 30k to bpi", "moved 2k bpi to gcash".
- Categories (Food, Transport, Bills…) are optional; I'll suggest one the first time it fits, or you can skip them.
- Miss a few days? I'll offer a quick Catch-up with rough totals.
- Say "undo" anytime.

Spent anything today?

**User:** lunch 250 gcash

> Skill: a new Category would fit → ask before writing (tool-surface rule)

**Claude:** ₱250 lunch · GCash. Start a Food Category for it? (yes / no / "no categories")

**User:** yes

> `finance_manage add_category {Food, spending}` → `finance_record [{spending 250, GCash, Food}]`

**Claude:** Logged ₱250 Food · GCash. GCash now ₱4,500.

## Path B: user logs straight away

**User:** spent 250 on lunch with gcash

> `finance_status` → empty, `next: …first Balance check…`

**Claude:** First time here. How much is in GCash right now, after lunch? Any other places your money sits?

**User:** 4500, that's it

> `finance_record [{spending 250, GCash}, {balance_check GCash 4500}]` (spending logged first: 4,500 is already after lunch, ADR 0002)

**Claude:** Set up GCash ₱4,500 and logged ₱250 lunch. File it under Food?
…then the same "how it works" lines, shortened to two.

## Script rules this implies (for the Skill / `next` hints)

1. Detect first run from `finance_status` (no Accounts), not from the Skill.
2. One question for all Accounts and Balances at once; "cash" → Account "Cash".
3. Explain in ≤4 bullets, after setup, not before. No Category list dump.
4. Categories: suggest one at first fit, from the Skill's list; "no categories" stops further offers for the chat (stated in Skill; nothing stored).
5. End on a prompt to log the first Transaction. Target ≤3 user messages to the first Transaction.
6. If the user logs before setup, ask the Balance "right now, after that", and record the Transaction before the check.

## React to

- A. One combined "where's your money + Balances" question?
- B. Explain after setup in 4 bullets?
- C. Categories offered one at a time on first fit (not a list up front)?
- D. "no categories" only lasts the chat (no stored preference)?
