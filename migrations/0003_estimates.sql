-- Estimates: `date` is the Period's last day (when it counts), start_date its first.
ALTER TABLE items ADD COLUMN start_date TEXT;
ALTER TABLE items ADD COLUMN flow TEXT CHECK (flow IN ('income', 'spending'));

CREATE INDEX items_by_batch ON items (user_id, batch_id);
CREATE INDEX items_by_to_account ON items (user_id, to_account_id) WHERE to_account_id IS NOT NULL;
