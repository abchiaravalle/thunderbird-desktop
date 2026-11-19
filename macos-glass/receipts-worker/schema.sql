CREATE TABLE IF NOT EXISTS opens (
  rid     TEXT NOT NULL,
  t       INTEGER NOT NULL,
  kind    TEXT,
  city    TEXT,
  region  TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS opens_rid_t ON opens (rid, t);
CREATE INDEX IF NOT EXISTS opens_t ON opens (t);
