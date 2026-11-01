# Same-day order is log order

Transactions, Transfers, Estimates and Balance checks carry a date, not a time, so when a Balance check and other entries share a date, the order they were logged decides which side of the anchor they fall on. We chose this over treating a Balance check as end-of-day (or start-of-day) because both real flows come out right: in onboarding the user states a Balance "now" and then logs lunch, which belongs after the check; in a Catch-up, Transfers and Estimates are logged first and the Balance check last, so they belong before it. A fixed time-of-day rule gets one of the two wrong.

## Consequences

- Every logged item keeps a log sequence alongside its date; Balances are computed in (date, sequence) order.
- Editing an item's date keeps its sequence. A forgotten same-day Transaction logged after an evening Balance check counts after it (showing up later as Unaccounted Income); re-logging that Balance check puts it back in order.
