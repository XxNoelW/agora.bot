-- Account sync for Agora. Apply this to the D1 database bound as DB.
-- There is no chat, model, or routine table in this Worker.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created INTEGER,
  last_seen INTEGER
);

CREATE TABLE sync (
  account_id TEXT,
  kind TEXT CHECK (kind IN ('chats', 'memory', 'settings')),
  data TEXT,
  version INTEGER,
  updated INTEGER,
  PRIMARY KEY (account_id, kind)
);

-- Optional. A failed write here does not fail a sync.
-- Share rate limits reuse this table. account_id is a daily hash, not an IP address.
CREATE TABLE IF NOT EXISTS usage (
  account_id TEXT,
  day TEXT,
  syncs INTEGER DEFAULT 0,
  PRIMARY KEY (account_id, day)
);

-- Read-only chat snapshots. No account. The id is unguessable.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  data TEXT,
  created INTEGER
);

-- Anonymous daily counts. No visitor id, cookie, or IP.
CREATE TABLE IF NOT EXISTS stats (
  day TEXT,
  type TEXT,
  key TEXT,
  count INTEGER,
  PRIMARY KEY (day, type, key)
);

-- Opt-in training turns. Emails and phone numbers are removed before insert.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  created INTEGER,
  rating INTEGER,
  lang TEXT,
  data TEXT,
  used INTEGER DEFAULT 0
);
