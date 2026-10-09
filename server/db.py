import sqlite3, json, os
from pathlib import Path

DB_PATH = Path(os.getenv("DB_PATH", "data/workspace.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS workspace (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS imports (
            id TEXT PRIMARY KEY,
            filename TEXT,
            raw_json TEXT,
            reviewed_json TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)

def load_workspace():
    with get_conn() as c:
        row = c.execute("SELECT payload FROM workspace WHERE id=1").fetchone()
        return json.loads(row["payload"]) if row else None

def save_workspace(payload: dict):
    with get_conn() as c:
        c.execute("""
            INSERT INTO workspace (id, payload, updated_at)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP
        """, (json.dumps(payload),))

def save_import(import_id, filename, raw, reviewed=None, status="pending"):
    with get_conn() as c:
        c.execute("""
            INSERT INTO imports (id, filename, raw_json, reviewed_json, status)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                raw_json=excluded.raw_json,
                reviewed_json=excluded.reviewed_json,
                status=excluded.status
        """, (import_id, filename, json.dumps(raw),
              json.dumps(reviewed) if reviewed else None, status))

def get_import(import_id):
    with get_conn() as c:
        row = c.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
        if not row: return None
        return {
            "id": row["id"],
            "filename": row["filename"],
            "raw": json.loads(row["raw_json"]) if row["raw_json"] else None,
            "reviewed": json.loads(row["reviewed_json"]) if row["reviewed_json"] else None,
            "status": row["status"],
            "created_at": row["created_at"],
        }

def list_imports():
    with get_conn() as c:
        rows = c.execute("SELECT id, filename, status, created_at FROM imports ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]