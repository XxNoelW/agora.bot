-- Community agents. Apply this to the existing agora-cloud D1 database.
-- Safe to run more than once. Redeploy workers/agora-cloud/index.js after applying it.
-- A published row is only a definition: name, emoji, description, instructions, tools, examples.
-- It does not store chats, memory, files, pages, or account secrets.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  instructions TEXT NOT NULL,
  lang TEXT,
  tools TEXT,
  examples TEXT,
  installs INTEGER DEFAULT 0,
  created INTEGER,
  reports INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0
);
