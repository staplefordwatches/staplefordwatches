CREATE TABLE IF NOT EXISTS dispatch_emails (
  order_key TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  watch_name TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  tracking_url TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'failed', 'uncertain')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS dispatch_emails_created_at ON dispatch_emails(created_at DESC);
