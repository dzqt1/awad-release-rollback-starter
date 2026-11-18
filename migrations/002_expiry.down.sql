CREATE TABLE links_without_expiry (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  url        TEXT NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO links_without_expiry (id, code, url, hits, created_at)
SELECT id, code, url, hits, created_at FROM links;

DROP TABLE links;
ALTER TABLE links_without_expiry RENAME TO links;
DROP TABLE feature_flags;
