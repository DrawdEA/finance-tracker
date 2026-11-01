-- One row per sign-in identity; every other table hangs off users.id (ADR 0003).
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);
