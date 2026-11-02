-- Set when setup is finished (finance_manage complete_setup); until then every status and record result resumes it.
ALTER TABLE users ADD COLUMN onboarded_at TEXT;
