"""
Local administrator authentication for the desktop app.

Two responsibilities, deliberately kept free of any `database` import at module
level so that `database.ensure_schema_up_to_date()` can call `hash_password()`
while seeding the default account without creating a circular import:

  1. Password hashing (PBKDF2-HMAC-SHA256 from the standard library).
  2. An in-memory session store keyed by an opaque token.

The session store is intentionally in-memory: this is a single-user desktop
application, and losing sessions when the process restarts is the correct
behaviour — it means closing the app signs you out.
"""

import base64
import hashlib
import hmac
import secrets
import threading
import time

# ── Password hashing ─────────────────────────────────────────────────────────
# PBKDF2 from hashlib rather than bcrypt/argon2 via passlib: the standard
# library needs no extra wheel and no PyInstaller hook, which matters because
# this app ships as a single frozen executable.

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 240_000
_SALT_BYTES = 16


def hash_password(plain_password: str) -> str:
    """Hash a password into the storable `algo$iterations$salt$hash` form."""
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, _ITERATIONS)
    return "{}${}${}${}".format(
        _ALGORITHM,
        _ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(derived).decode("ascii"),
    )


def verify_password(plain_password: str, stored_hash: str) -> bool:
    """Check a password against a stored hash. Never raises on malformed input."""
    if not stored_hash:
        return False
    try:
        algorithm, iterations, salt_b64, expected_b64 = stored_hash.split("$")
        if algorithm != _ALGORITHM:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(expected_b64)
        derived = hashlib.pbkdf2_hmac(
            "sha256", plain_password.encode("utf-8"), salt, int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(derived, expected)


# ── Session store ────────────────────────────────────────────────────────────

SESSION_COOKIE_NAME = "sas_session"
SESSION_TTL_SECONDS = 12 * 60 * 60  # a generous single working day

_sessions: dict = {}          # token -> {"username": str, "expires_at": float}
_sessions_lock = threading.Lock()


def create_session(username: str) -> str:
    """Issue a new opaque session token for this user."""
    token = secrets.token_urlsafe(32)
    with _sessions_lock:
        _sessions[token] = {
            "username": username,
            "expires_at": time.time() + SESSION_TTL_SECONDS,
        }
    return token


def get_session_username(token: str):
    """Return the username for a live session, or None if missing/expired."""
    if not token:
        return None
    now = time.time()
    with _sessions_lock:
        session = _sessions.get(token)
        if not session:
            return None
        if session["expires_at"] <= now:
            _sessions.pop(token, None)
            return None
        return session["username"]


def destroy_session(token: str) -> None:
    """Sign a single session out. Safe to call with an unknown token."""
    if not token:
        return
    with _sessions_lock:
        _sessions.pop(token, None)


def destroy_all_sessions() -> None:
    """Invalidate every session — used after a password change."""
    with _sessions_lock:
        _sessions.clear()


# ── Route gating ─────────────────────────────────────────────────────────────
# Everything the login screen itself needs must stay reachable while signed out,
# otherwise the page cannot render enough to let anybody sign in.

_PUBLIC_EXACT = {
    "/api/auth/login",
    "/api/auth/status",
    "/api/public/branding",
    "/favicon.ico",
    "/static/login.html",
    "/static/favicon.ico",
    "/static/js/login.js",
    "/static/js/sidebar.js",
    # The login screen renders in the institute's chosen language, so its
    # translation table has to load before anybody is signed in.
    "/static/js/i18n.js",
    "/docs",
    "/openapi.json",
}

_PUBLIC_PREFIXES = (
    "/static/css/",
    "/static/images/",
    "/static/fonts/",
)


def is_public_path(path: str) -> bool:
    """Whether a request path may be served without a valid session."""
    # Query strings are stripped by Starlette before we see url.path, but the
    # frontend appends cache-busting `?v=N` to script tags, so be defensive.
    clean = path.split("?", 1)[0]
    if clean in _PUBLIC_EXACT:
        return True
    return clean.startswith(_PUBLIC_PREFIXES)
