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
CREATE TABLE usage (
  account_id TEXT,
  day TEXT,
  syncs INTEGER DEFAULT 0,
  PRIMARY KEY (account_id, day)
);
