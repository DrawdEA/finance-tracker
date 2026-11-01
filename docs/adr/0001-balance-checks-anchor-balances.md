# Balance checks anchor Balances; Unaccounted is derived, never stored

An Account's Balance is its latest Balance check plus every Transaction, Transfer and Estimate since, and the difference between two Balance checks that nothing explains is computed as Unaccounted rather than written down as an entry. We chose this because tracking lapses are the normal case: forgotten Transactions and Estimates get logged after the fact, and a stored "difference" entry would double count them, while a derived remainder shrinks on its own and the checked Balance stays true.

## Consequences

- Estimates are likewise totals that itemized Transactions fill in, not amounts added on top; the un-itemized remainder is also derived.
- An Estimate's Period may not cross a Balance check on the same Account, so every derived remainder sits cleanly between two anchors.
- An Account's first Balance check is how it is set up; there is no separate opening balance.
