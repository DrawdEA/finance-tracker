# Finance Tracker

A single-user record of money coming in and going out, logged by chatting with Claude, that stays usable even after stretches of not tracking.

## Language

### Money movements

**Transaction**:
An exact amount of money moving in or out on one date.
_Avoid_: Entry, record, expense

**Income**:
A Transaction where money comes in.
_Avoid_: Earning, deposit

**Spending**:
A Transaction where money goes out.
_Avoid_: Expense, purchase, payment

**Category**:
A label for what a Transaction or Estimate was for or came from (e.g. food, transport), chosen from a fixed list the user owns.
_Avoid_: Tag, type

**Transfer**:
Money moved from one Account to another; neither Income nor Spending.
_Avoid_: Move, top-up

### Where money sits

**Account**:
A real place money physically sits (e.g. a bank account, GCash, cash in a wallet), with a Balance the user can check.
_Avoid_: Basket, wallet, envelope, fund

**Balance**:
How much money an Account holds: its opening amount plus every Transaction, Transfer and Estimate touching it.
_Avoid_: Total, amount left

**Balance check**:
The user stating an Account's actual Balance at a point in time; any difference from the tracked Balance becomes an Estimate.
_Avoid_: Reconciliation, correction, sync

### Catching up

**Estimate**:
An approximate amount of Income or Spending for one Category and Account across a Period, given when exact Transactions weren't logged.
_Avoid_: Guess, lump sum, approximation

**Period**:
The span of dates, start to end, that an Estimate covers.
_Avoid_: Range, window

**Gap**:
The days since the user last logged that no Transaction or Estimate accounts for.
_Avoid_: Missing days, lapse

**Catch-up**:
A chat flow that fills a Gap with Estimates.
_Avoid_: Backfill, reconciliation
