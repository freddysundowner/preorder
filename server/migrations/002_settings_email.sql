CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  provider_id TEXT,
  status      TEXT NOT NULL DEFAULT 'queued',
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS error TEXT;
