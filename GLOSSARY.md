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
An optional label for what a Transaction or Estimate was for or came from (e.g. food, transport), from a flat list the user builds up. Each Category belongs to either Income or Spending; Transfers have none. Income or Spending with no Category counts as Uncategorized, which is not a Category but is counted like one. Unaccounted is not a Category either.
_Avoid_: Tag, type, subcategory

**Transfer**:
Money moved from one Account to another; neither Income nor Spending.
_Avoid_: Move, top-up

### Where money sits

**Account**:
A real place money physically sits (e.g. a bank account, GCash, a savings pocket with its own Balance, cash in a wallet), with a Balance the user can check. Never negative when checked, so a credit card or loan is not an Account. Closed by a final Balance check of zero that the user marks as closing (an Account merely at zero stays open); its history stays, and a later Balance check reopens it.
_Avoid_: Basket, wallet, envelope, fund

**Balance**:
How much money an Account holds: its latest Balance check plus every Transaction, Transfer and Estimate since.
_Avoid_: Total, amount left

**Balance check**:
The user stating an Account's actual Balance on a date. It anchors the Balance; the first one sets the Account up, and nothing on that Account may be dated before it. On its own date it comes after whatever was logged before it and before whatever is logged after it.
_Avoid_: Reconciliation, correction, sync, opening balance

**Unaccounted**:
The part of an Account's change between two Balance checks that no Transaction, Transfer or Estimate explains.
_Avoid_: Discrepancy, miscellaneous, unknown

### Catching up

**Estimate**:
An approximate total of Income or Spending for one Category (or Uncategorized) and Account across a Period. Exact Transactions with the same Category, Account and Period count toward that total, never on top of it.
_Avoid_: Guess, lump sum, approximation

**Period**:
The span of dates, start to end, that an Estimate covers.
_Avoid_: Range, window

**Gap**:
A run of days with no Transaction, Balance check or Estimate Period covering them.
_Avoid_: Missing days, lapse

**Catch-up**:
A chat flow that fills a Gap with Estimates.
_Avoid_: Backfill, reconciliation
