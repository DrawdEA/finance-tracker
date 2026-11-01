# PROTOTYPE: Catch-up script (issue 9) — throwaway, not a spec

Setup: 2 Accounts (GCash, Bank); Categories Food, Transport, Bills, Salary. Last logged item Tue 21 Oct. Today Sat 1 Nov.

---

**User:** jeep 40 gcash

> `finance_status` → `today: 2026-11-01`, tracked GCash ₱6,200 · Bank ₱18,000, `gap: {from: 2026-10-22, to: 2026-10-31, days: 10}`
> `finance_record [{spending 40, GCash, Transport}]` → `summary: "Logged ₱40 Transport · GCash · Sat 1 Nov"`

**Claude:** Logged ₱40 Transport · GCash.
Nothing logged 22–31 Oct (10 days). Quick Catch-up? ~2 min.

**User:** sure

**Claude:** What's in each right now?
- GCash (I have ₱6,160)
- Bank (I have ₱18,000)

**User:** gcash 2100, bank 31000

**Claude:** So GCash is down ₱4,060 and Bank up ₱13,000 since 21 Oct.
Any money moved between them, or anything big (salary, rent, bills)?

**User:** salary 15k into bank on the 30th, moved 2k bank to gcash, paid internet 1500 from gcash on the 25th

**Claude:** Roughly what did the rest of GCash go to? e.g. "mostly food, some grab". Fine to skip.

**User:** mostly food maybe 2000, rest grab

**Claude:** Here's the Catch-up, 22–31 Oct:
- Salary ₱15,000 → Bank · Thu 30 Oct
- Transfer ₱2,000 Bank → GCash
- Bills ₱1,500 · GCash · Sat 25 Oct
- Food ~₱2,000 · GCash (Estimate)
- Transport ~₱2,560 · GCash (Estimate, the rest)
- Balance checks: GCash ₱2,100 · Bank ₱31,000
Nothing left Unaccounted. Save?

**User:** yes

> `finance_record` one batch, in this order: Transfer → Income/Spending → Estimates → Balance checks last (ADR 0002)
> Estimates use Period 22–31 Oct (the Gap), so today's jeep sits outside them and isn't double counted.
> → `summary: "Caught up 22–31 Oct: 7 items, GCash ₱2,100, Bank ₱31,000, Unaccounted ₱0"`

**Claude:** Caught up through today. GCash ₱2,100 · Bank ₱31,000. Undo if anything's off.

---

## Script rules this implies (for the Skill)

1. **Trigger:** `finance_status` Gap ≥3 days → offer once per chat, after handling what the user came for. User can also say "catch up".
2. **Balances first, recorded last.** Ask every open Account's current Balance up front (fast, exact), show the change vs tracked, then explain the change. The batch still writes Balance checks last.
3. **Then exact knowns:** Transfers and big one-offs (salary, rent, bills), with dates if the user gives them; else the Gap's last day.
4. **Then one open question per Account** for the rest → Estimates by Category, Period = the Gap. Never walk every Category. "Skip" leaves it Unaccounted, which is fine. A Category the user doesn't have yet gets added in the same yes.
5. **Fill-the-rest:** if the user says "rest is X", that Estimate = remaining change, so Unaccounted is 0.
6. **One summary, one yes, one batch.** Show Unaccounted per Account if non-zero.
7. **Fast path:** "just balances" → Balance checks only; the whole change is Unaccounted.
8. Target ≤6 user messages, ~2 min.

## React to

- A. Balances first (vs Transfers → Estimates → Balance as in issue 5 rule 7; record order unchanged)?
- B. One open "what did the rest go to?" per Account, not per Category?
- C. Offer after handling the user's message, once per chat?
- D. Accounts the user doesn't know the Balance of (e.g. cash): skip them, no check → Gap stays for that Account?
