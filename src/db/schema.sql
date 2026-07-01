CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  list_date       TEXT NOT NULL,
  priority        TEXT NOT NULL,
  task            TEXT NOT NULL,
  project         TEXT,
  source          TEXT,
  est_minutes     INTEGER,
  due_date        TEXT,
  notes           TEXT,
  done            INTEGER DEFAULT 0,
  done_at         TEXT,
  sort_order      INTEGER,
  carry_count     INTEGER DEFAULT 0,
  original_date   TEXT,
  user_modified   INTEGER DEFAULT 0,
  resurface_date  TEXT,
  status          TEXT DEFAULT 'active',
  external_id     TEXT,
  source_url      TEXT,
  identity_hash   TEXT,
  owner_name      TEXT,
  owner_category  TEXT,
  original_source TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_date ON tasks(list_date);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
CREATE INDEX IF NOT EXISTS idx_tasks_resurface ON tasks(resurface_date);
CREATE INDEX IF NOT EXISTS idx_tasks_external ON tasks(source, external_id);
CREATE INDEX IF NOT EXISTS idx_tasks_identity ON tasks(identity_hash);

CREATE TABLE IF NOT EXISTS lists (
  list_date         TEXT PRIMARY KEY,
  meeting_hours     REAL,
  available_hours   REAL,
  last_refreshed_at TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  list_date    TEXT NOT NULL,
  title        TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  is_optional  INTEGER DEFAULT 0,
  needs_prep   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_meetings_list_date ON meetings(list_date);
