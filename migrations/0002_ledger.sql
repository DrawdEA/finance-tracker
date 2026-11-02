-- Per-user profile; NULL means the deployment default (DEFAULT_CURRENCY / DEFAULT_TIMEZONE).
ALTER TABLE users ADD COLUMN currency TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT;

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (user_id, name)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  flow TEXT NOT NULL CHECK (flow IN ('income', 'spending')),
  hidden INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, flow, name)
);

-- One per finance_record call; "undo" removes the latest.
CREATE TABLE batches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Everything the user logs. id is the log sequence: on the same date, lower id
-- comes first (ADR 0002). AUTOINCREMENT so ids are never reused after a delete.
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'spending', 'transfer', 'estimate', 'balance_check')),
  date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0), -- minor units; a Balance check's stated Balance
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, -- a Transfer's source
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  note TEXT,
  closes INTEGER NOT NULL DEFAULT 0 -- Balance check that closes its Account
);

CREATE INDEX items_by_account ON items (user_id, account_id, date, id);
