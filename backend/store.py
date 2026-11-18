"""Small transactional JSON record store; pixels and masks stay in separate files."""

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        (root / "sources").mkdir(exist_ok=True)
        (root / "masks").mkdir(exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.root / "workspace.sqlite3", timeout=30)
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, kind, key):
        with self.lock, self.connect() as db:
            row = db.execute(
                "SELECT body FROM records WHERE kind=? AND id=?", (kind, key)
            ).fetchone()
        if row is None:
            raise KeyError(f"{kind} not found: {key}")
        return json.loads(row[0])

    def put(self, kind, key, value):
        with self.lock, self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO records VALUES (?,?,?)",
                (kind, key, json.dumps(value, allow_nan=False)),
            )
        return value

    def all(self, kind):
        with self.lock, self.connect() as db:
            rows = db.execute(
                "SELECT body FROM records WHERE kind=? ORDER BY rowid DESC", (kind,)
            ).fetchall()
        return [json.loads(row[0]) for row in rows]
