-- Creative Lab Studios data store (D1 database "creative-lab-hq"). Safe to run again.
CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll, updated);
CREATE INDEX IF NOT EXISTS docs_updated ON docs(updated);
CREATE TABLE IF NOT EXISTS deleted (path TEXT PRIMARY KEY, coll TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS deleted_coll ON deleted(coll, at);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type TEXT, size INTEGER, name TEXT, at INTEGER);
