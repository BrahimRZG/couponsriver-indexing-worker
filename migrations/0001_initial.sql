-- D1 migration: initial schema
-- Mirrors the SQLite schema created by IndexingDb.initSchema() in src/db.ts.
-- Apply with: wrangler d1 migrations apply couponsriver-indexing-db

CREATE TABLE IF NOT EXISTS urls (
  url                  TEXT    PRIMARY KEY,
  last_seen_at         TEXT    NOT NULL,
  first_seen_at        TEXT    NOT NULL,
  last_submitted_at    TEXT,
  last_status          INTEGER,
  last_hash            TEXT,
  lastmod_from_sitemap TEXT,
  change_count         INTEGER NOT NULL DEFAULT 0,
  submit_count         INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at       TEXT    NOT NULL,
  finished_at      TEXT,
  target_site      TEXT    NOT NULL,
  discovered_count INTEGER DEFAULT 0,
  fetched_count    INTEGER DEFAULT 0,
  new_count        INTEGER DEFAULT 0,
  changed_count    INTEGER DEFAULT 0,
  unchanged_count  INTEGER DEFAULT 0,
  submitted_count  INTEGER DEFAULT 0,
  failed_count     INTEGER DEFAULT 0,
  dry_run          INTEGER NOT NULL DEFAULT 1
);
