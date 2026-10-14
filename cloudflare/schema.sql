-- Separate from the existing AI Worker. Apply to a dedicated D1 database.
CREATE TABLE IF NOT EXISTS workspace (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 payload TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS imports (
 id TEXT PRIMARY KEY,
 filename TEXT NOT NULL,
 raw_json TEXT NOT NULL,
 reviewed_json TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
