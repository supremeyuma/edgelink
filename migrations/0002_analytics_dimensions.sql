-- Analytics dimensions. The base rollups table answers totals; these tables
-- answer "top referrers" and "device split" without scanning raw events.
CREATE TABLE IF NOT EXISTS referrer_rollups (
  link_id TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  referrer_host TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (link_id, bucket_hour, referrer_host)
);

CREATE INDEX IF NOT EXISTS ix_referrer_rollups_link_bucket
  ON referrer_rollups (link_id, bucket_hour);

CREATE TABLE IF NOT EXISTS device_rollups (
  link_id TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  device TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (link_id, bucket_hour, device)
);

CREATE INDEX IF NOT EXISTS ix_device_rollups_link_bucket
  ON device_rollups (link_id, bucket_hour);
