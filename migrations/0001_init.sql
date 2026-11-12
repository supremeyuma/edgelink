CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  owner_id TEXT,
  expires_at INTEGER,
  max_clicks INTEGER,
  clicks INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS click_events (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  country TEXT,
  referrer_host TEXT,
  device TEXT,
  ip_hash TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_click_events_link_ts ON click_events (link_id, ts);
CREATE INDEX IF NOT EXISTS ix_click_events_ts ON click_events (ts);

CREATE TABLE IF NOT EXISTS rollups (
  link_id TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  uniques INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  PRIMARY KEY (link_id, bucket_hour)
);
