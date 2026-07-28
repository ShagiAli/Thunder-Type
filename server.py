"""Thunder Type backend.

Serves the static frontend from static/ and a small JSON API for score
persistence, backed by a real database instead of a flat JSON file.

- If a DATABASE_URL environment variable is set (e.g. Render/Railway/Heroku
  automatically set this when you attach a Postgres add-on), Postgres is
  used. This is what you want in production: it handles concurrent writes
  safely and isn't wiped when the app restarts or redeploys.
- Otherwise, falls back to a local SQLite file (thunder_type.db) so you can
  run this locally with zero setup — no external database required.

Either way, every signed-in name gets its own row — protected by a password
(PBKDF2-hashed, stdlib only, never stored in plaintext) — with best_wpm,
best_accuracy, max_combo, rounds_finished, and current_level, keyed by a
case-insensitive version of their name. Signing in with a new name creates
an account with whatever password you type; signing in with an existing
name requires that account's password.

Run locally:   python server.py
Then open:     http://127.0.0.1:8000

Deploy: set DATABASE_URL to a Postgres connection string and install
psycopg2-binary (see requirements.txt).
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

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


# ---------------------------------------------------------------------------
# Password hashing — stdlib only (PBKDF2-HMAC-SHA256, 200k iterations).
# No plaintext password is ever stored or compared directly.
# ---------------------------------------------------------------------------

_PBKDF2_ITERATIONS = 200_000


def _hash_password(password: str) -> tuple[str, str]:
    """Returns (salt_b64, hash_b64) for a freshly-chosen password."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return base64.b64encode(salt).decode("ascii"), base64.b64encode(digest).decode("ascii")


def _verify_password(password: str, salt_b64: str, hash_b64: str) -> bool:
    salt = base64.b64decode(salt_b64)
    expected = base64.b64decode(hash_b64)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return hmac.compare_digest(actual, expected)


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

        # Best-effort migration: adds password columns if this table was
        # created by an earlier version of this app that had no auth. Safe
        # to run every startup — fails harmlessly if the columns already
        # exist (which is the normal case after the first run).
        for column_sql in (
            "ALTER TABLE profiles ADD COLUMN password_salt TEXT",
            "ALTER TABLE profiles ADD COLUMN password_hash TEXT",
        ):
            try:
                cur.execute(column_sql)
                conn.commit()
            except Exception:
                conn.rollback()
    finally:
        conn.close()


class WrongPassword(Exception):
    """Raised when a name exists but the supplied password doesn't match it."""


def authenticate(name: str, password: str) -> dict:
    """Log in as `name`. Creates a fresh account with this password if the
    name has never been used before. Raises WrongPassword if the name is
    taken and the password doesn't match — stats are never returned in
    that case.
    """
    if not password:
        raise ValueError("password is required")

    key = _profile_key(name)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            _q(
                "SELECT player_name, password_salt, password_hash, best_wpm, best_accuracy, "
                "max_combo, rounds_finished, current_level FROM profiles WHERE name_key = ?"
            ),
            (key,),
        )
        row = cur.fetchone()

        if row is None:
            # Brand-new name: create the account with this password.
            salt, pw_hash = _hash_password(password)
            display_name = name.strip()
            cur.execute(
                _q(
                    """
                    INSERT INTO profiles
                        (name_key, player_name, password_salt, password_hash,
                         best_wpm, best_accuracy, max_combo, rounds_finished, current_level)
                    VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1)
                    """
                ),
                (key, display_name, salt, pw_hash),
            )
            conn.commit()
            result = dict(DEFAULT_STATS)
            result["player_name"] = display_name
            result["exists"] = False
            return result

        player_name, salt, pw_hash, best_wpm, best_accuracy, max_combo, rounds_finished, current_level = row

        if not salt or not pw_hash:
            # Row predates the password feature (migrated table) — claim it
            # for whoever logs in first with this password, rather than
            # locking the account out or silently accepting anything forever.
            salt, pw_hash = _hash_password(password)
            cur.execute(
                _q("UPDATE profiles SET password_salt = ?, password_hash = ? WHERE name_key = ?"),
                (salt, pw_hash, key),
            )
            conn.commit()
        elif not _verify_password(password, salt, pw_hash):
            raise WrongPassword()

        return {
            "player_name": player_name,
            "best_wpm": best_wpm,
            "best_accuracy": best_accuracy,
            "max_combo": max_combo,
            "rounds_finished": rounds_finished,
            "current_level": current_level,
            "exists": True,
        }
    finally:
        conn.close()


def save_stats(name: str, password: str, data: dict) -> dict:
    """Update one user's stats. Requires the correct password — never
    touches a row unless it belongs to whoever is asking.
    """
    key = _profile_key(name)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            _q(
                "SELECT player_name, password_salt, password_hash, best_wpm, best_accuracy, "
                "max_combo, rounds_finished, current_level FROM profiles WHERE name_key = ?"
            ),
            (key,),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError("no account with that name — sign in first")

        player_name, salt, pw_hash, best_wpm, best_accuracy, max_combo, rounds_finished, current_level = row
        if not salt or not pw_hash or not _verify_password(password, salt, pw_hash):
            raise WrongPassword()

        merged = {
            "best_wpm": best_wpm,
            "best_accuracy": best_accuracy,
            "max_combo": max_combo,
            "rounds_finished": rounds_finished,
            "current_level": current_level,
        }
        for field in STAT_FIELDS:
            if field in data:
                merged[field] = data[field]

        cur.execute(
            _q(
                """
                UPDATE profiles SET
                    best_wpm = ?, best_accuracy = ?, max_combo = ?,
                    rounds_finished = ?, current_level = ?
                WHERE name_key = ?
                """
            ),
            (
                merged["best_wpm"],
                merged["best_accuracy"],
                merged["max_combo"],
                merged["rounds_finished"],
                merged["current_level"],
                key,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    result = dict(merged)
    result["player_name"] = player_name
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
# HTTP layer — thin routing on top of authenticate/save_stats/list_users.
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

        if parsed.path == "/api/auth":
            data = self._read_json_body()
            if data is None:
                return
            name = (data.get("player_name") or "").strip()
            password = data.get("password") or ""
            if not name:
                self._send_json({"error": "player_name is required"}, status=400)
                return
            if not password:
                self._send_json({"error": "password is required"}, status=400)
                return
            try:
                result = authenticate(name, password)
            except WrongPassword:
                self._send_json({"error": "Incorrect password for that name."}, status=401)
                return
            except ValueError as e:
                self._send_json({"error": str(e)}, status=400)
                return
            self._send_json(result)
            return

        if parsed.path == "/api/save":
            data = self._read_json_body()
            if data is None:
                return
            name = (data.get("player_name") or "").strip()
            password = data.get("password") or ""
            if not name or not password:
                self._send_json({"error": "player_name and password are required"}, status=400)
                return
            try:
                result = save_stats(name, password, data)
            except WrongPassword:
                self._send_json({"error": "Incorrect password for that name."}, status=401)
                return
            except ValueError as e:
                self._send_json({"error": str(e)}, status=400)
                return
            self._send_json(result)
            return

        self.send_error(404, "Unknown endpoint")

    def _read_json_body(self):
        """Reads and parses the request body as JSON. Sends a 400 and
        returns None on failure — callers should return immediately if
        this returns None."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            self._send_json({"error": "invalid JSON"}, status=400)
            return None

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
