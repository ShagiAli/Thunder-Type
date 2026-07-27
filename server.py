"""Thunder Type backend.

Serves the static frontend from static/ and a small JSON API for score
persistence, backed by a real database instead of a flat JSON file.

- If a DATABASE_URL environment variable is set (e.g. Render/Railway/Heroku
  automatically set this when you attach a Postgres add-on), Postgres is
  used. This is what you want in production: it handles concurrent writes
  safely and isn't wiped when the app restarts or redeploys.
- Otherwise, falls back to a local SQLite file (thunder_type.db) so you can
  run this locally with zero setup — no external database required.

Either way, every signed-in name gets its own row — best_wpm, best_accuracy,
max_combo, rounds_finished, and current_level — keyed by a case-insensitive
version of their name.

Run locally:   python server.py
Then open:     http://127.0.0.1:8000

Deploy: set DATABASE_URL to a Postgres connection string and install
psycopg2-binary (see requirements.txt).
"""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEXTS_PATH = BASE_DIR / "data" / "texts.json"

DEFAULT_STATS = {
    "best_wpm": 0.0,
    "best_accuracy": 0.0,
    "max_combo": 0,
    "rounds_finished": 0,
    "current_level": 1,
}
STAT_FIELDS = tuple(DEFAULT_STATS.keys())

# ---------------------------------------------------------------------------
# Storage backend: Postgres in production, SQLite for local dev.
# Both support "INSERT ... ON CONFLICT (key) DO UPDATE SET ..." with the
# same syntax, so the SQL below is shared between them — only the
# placeholder style (%s vs ?) and the connection module differ.
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    import psycopg2

    BACKEND = "postgres"

    def get_connection():
        return psycopg2.connect(DATABASE_URL)

else:
    import sqlite3

    BACKEND = "sqlite"
    DB_PATH = BASE_DIR / "thunder_type.db"

    def get_connection():
        return sqlite3.connect(DB_PATH)


def _q(sql: str) -> str:
    """Swap `?` placeholders for `%s` when talking to Postgres."""
    return sql.replace("?", "%s") if BACKEND == "postgres" else sql


def _profile_key(name: str) -> str:
    """Normalize a display name into a lookup key ('Awab' and 'awab' are the same user)."""
    return name.strip().lower()


def init_db() -> None:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                name_key TEXT PRIMARY KEY,
                player_name TEXT NOT NULL,
                best_wpm REAL NOT NULL DEFAULT 0,
                best_accuracy REAL NOT NULL DEFAULT 0,
                max_combo INTEGER NOT NULL DEFAULT 0,
                rounds_finished INTEGER NOT NULL DEFAULT 0,
                current_level INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def get_profile(name: str) -> dict:
    """Look up one user's saved stats. Returns fresh defaults if they're new."""
    key = _profile_key(name)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            _q(
                "SELECT player_name, best_wpm, best_accuracy, max_combo, "
                "rounds_finished, current_level FROM profiles WHERE name_key = ?"
            ),
            (key,),
        )
        row = cur.fetchone()
    finally:
        conn.close()

    result = dict(DEFAULT_STATS)
    if row:
        player_name, best_wpm, best_accuracy, max_combo, rounds_finished, current_level = row
        result.update(
            {
                "best_wpm": best_wpm,
                "best_accuracy": best_accuracy,
                "max_combo": max_combo,
                "rounds_finished": rounds_finished,
                "current_level": current_level,
            }
        )
        result["player_name"] = player_name
    else:
        result["player_name"] = name.strip()
    result["exists"] = row is not None
    return result


def upsert_profile(data: dict) -> dict:
    """Create or update one user's record. Every other user's row is untouched."""
    name = (data.get("player_name") or "").strip()
    if not name:
        raise ValueError("player_name is required")
    key = _profile_key(name)

    existing = get_profile(name)
    merged = {field: existing[field] for field in STAT_FIELDS}
    for field in STAT_FIELDS:
        if field in data:
            merged[field] = data[field]

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            _q(
                """
                INSERT INTO profiles
                    (name_key, player_name, best_wpm, best_accuracy, max_combo, rounds_finished, current_level)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (name_key) DO UPDATE SET
                    player_name = excluded.player_name,
                    best_wpm = excluded.best_wpm,
                    best_accuracy = excluded.best_accuracy,
                    max_combo = excluded.max_combo,
                    rounds_finished = excluded.rounds_finished,
                    current_level = excluded.current_level
                """
            ),
            (
                key,
                name,
                merged["best_wpm"],
                merged["best_accuracy"],
                merged["max_combo"],
                merged["rounds_finished"],
                merged["current_level"],
            ),
        )
        conn.commit()
    finally:
        conn.close()

    result = dict(merged)
    result["player_name"] = name
    result["exists"] = True
    return result


def list_users() -> list:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT player_name FROM profiles")
        rows = cur.fetchall()
    finally:
        conn.close()
    return sorted((r[0] for r in rows), key=str.lower)


# ---------------------------------------------------------------------------
# HTTP layer — unchanged from the JSON-file version, since get_profile/
# upsert_profile/list_users keep the exact same signatures. main.js needs
# no changes at all.
# ---------------------------------------------------------------------------


class ThunderTypeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def _send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Prevent the browser from caching stale JS modules across updates.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/profile":
            name = parse_qs(parsed.query).get("name", [""])[0]
            if not name.strip():
                self._send_json({"error": "name query parameter is required"}, status=400)
                return
            self._send_json(get_profile(name))
            return

        if parsed.path == "/api/users":
            self._send_json(list_users())
            return

        if parsed.path == "/api/texts":
            with TEXTS_PATH.open("r", encoding="utf-8") as f:
                self._send_json(json.load(f))
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/profile":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                self._send_json({"error": "invalid JSON"}, status=400)
                return
            try:
                result = upsert_profile(data)
            except ValueError as e:
                self._send_json({"error": str(e)}, status=400)
                return
            self._send_json(result)
            return

        self.send_error(404, "Unknown endpoint")

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        pass  # keep the console quiet; remove this override for verbose logs


def _lan_ip() -> str:
    """Best-effort guess at this machine's LAN IP, for printing a phone-friendly URL."""
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # doesn't actually send anything
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), ThunderTypeHandler)
    lan_ip = _lan_ip()
    print(f"Thunder Type running (storage: {BACKEND})")
    print(f"  On this computer:  http://127.0.0.1:{port}")
    print(f"  On your phone/other devices on the same WiFi:  http://{lan_ip}:{port}")
    print("  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
