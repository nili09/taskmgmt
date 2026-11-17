-- Tandem schema, phase 1.
-- The events table is the source of truth. The other tables are current-state
-- projections that can be rebuilt from events alone.

CREATE TABLE users (
  email      TEXT PRIMARY KEY,           -- lowercased; the identity key everywhere
  name       TEXT,                       -- null until the person confirms it on first run
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,         -- client-generated, sortable
  title        TEXT NOT NULL,
  description  TEXT,
  owner_email  TEXT NOT NULL,
  due_date     TEXT,                     -- YYYY-MM-DD, no time zone
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,            -- UTC ISO 8601
  completed_at TEXT,
  archived_at  TEXT,
  updated_at   TEXT NOT NULL             -- server_at of the latest event on this task
);
CREATE INDEX tasks_owner ON tasks (owner_email);

CREATE TABLE items (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks (id),
  text       TEXT NOT NULL,
  position   TEXT NOT NULL,              -- sortable string, assigned by the client
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  removed_at TEXT                        -- items are hidden, never deleted
);
CREATE INDEX items_task ON items (task_id);

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks (id),
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX notes_task ON notes (task_id);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,           -- also the key of the bytes in KV, added later
  task_id    TEXT NOT NULL REFERENCES tasks (id),
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  added_by   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX attachments_task ON attachments (task_id);

CREATE TABLE events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        TEXT,                   -- null for events that belong to no task
  actor_email    TEXT NOT NULL,
  actor_name     TEXT,                   -- the name at the time of the change
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL CHECK (json_valid(payload)),
  client_at      TEXT NOT NULL,          -- when the person did it on their device
  server_at      TEXT NOT NULL,          -- when the server recorded it, UTC
  mutation_id    TEXT NOT NULL UNIQUE
);
CREATE INDEX events_task ON events (task_id, seq);

-- Append-only, enforced by the database.
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The last event sequence I have seen on each task. Per-user view state, not part of the record.
CREATE TABLE read_cursors (
  email    TEXT NOT NULL,
  task_id  TEXT NOT NULL REFERENCES tasks (id),
  last_seq INTEGER NOT NULL,
  PRIMARY KEY (email, task_id)
);
