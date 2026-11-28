-- Apply this to an existing agora-cloud D1 database.
-- Safe to run more than once. It does not change accounts or sync.

CREATE TABLE IF NOT EXISTS usage (
  account_id TEXT,
  day TEXT,
  syncs INTEGER DEFAULT 0,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  data TEXT,
  created INTEGER
);

CREATE TABLE IF NOT EXISTS stats (
  day TEXT,
  type TEXT,
  key TEXT,
  count INTEGER,
  PRIMARY KEY (day, type, key)
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  created INTEGER,
  rating INTEGER,
  lang TEXT,
  data TEXT,
  used INTEGER DEFAULT 0
);
