import os
import sys

# Prevent Avast/AVG Antivirus from crashing SSL/TLS context initialization via hijacked SSLKEYLOGFILE
if "SSLKEYLOGFILE" in os.environ:
    os.environ.pop("SSLKEYLOGFILE", None)
import shutil
import threading
import time
import socket
import urllib.request
import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from contextlib import asynccontextmanager

from config import get_base_path, DATA_DIR, CONSOLE_LOG_FILE

# console.log has no rotating handler behind it, so trim it at startup rather
# than letting it grow without bound across months of daily use.
try:
    if os.path.isfile(CONSOLE_LOG_FILE) and os.path.getsize(CONSOLE_LOG_FILE) > 5 * 1024 * 1024:
        os.remove(CONSOLE_LOG_FILE)
except OSError:
    pass

# FIX: In --noconsole mode, stdout is None, and Uvicorn crashes writing to it.
# UTF-8 is explicit because the punch handler logs Marathi status strings, and
# the Windows default of cp1252 raises UnicodeEncodeError on Devanagari;
# errors="replace" keeps one un-encodable byte from taking the app down.
# This writes to console.log, NOT app.log — app.log belongs to the rotating
# handler in zkteco_service, and a second open handle would block its rename.
sys.stdout = open(CONSOLE_LOG_FILE, "a", encoding="utf-8", errors="replace", buffering=1)
sys.stderr = open(CONSOLE_LOG_FILE, "a", encoding="utf-8", errors="replace", buffering=1)

from routers.students import router as students_router
from routers.attendance import router as attendance_router
from routers.settings import router as settings_router
from routers.holidays import router as holidays_router
from routers.reports import router as reports_router
from routers.auth import router as auth_router, public_router as public_auth_router
from auth import SESSION_COOKIE_NAME, get_session_username, is_public_path
from zkteco_service import zk_manager
from time_bound_service import time_bound_manager
from backup_service import backup_manager

from database import ensure_schema_up_to_date

# ── Single-instance guard ────────────────────────────────────────────────────
# If port 8000 is already in use, this is a second instance. Just open the
# browser/window pointing at the already-running server and exit immediately.
def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0

def wait_for_server(timeout_seconds: float = 15) -> bool:
    """Wait until the local HTTP server can actually serve the UI."""
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/", timeout=0.5):
                return True
        except Exception:
            time.sleep(0.1)
    return False

# ── FastAPI app ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    # Ensure database schema is up-to-date on startup
    ensure_schema_up_to_date()
    # Startup: Start polling ZKTeco device every 10 seconds
    zk_manager.start_polling(interval_seconds=10)
    # Start the Time-Bound absence checker background daemon
    time_bound_manager.start_scheduler()
    # Start daily database backup service
    backup_manager.start()
    yield
    # Shutdown
    zk_manager.stop_polling()
    time_bound_manager.stop_scheduler()
    backup_manager.stop()

app = FastAPI(title="Attendance System API", lifespan=lifespan)

app.include_router(auth_router)
app.include_router(public_auth_router)
app.include_router(students_router)
app.include_router(attendance_router)
app.include_router(settings_router)
app.include_router(holidays_router)
app.include_router(reports_router)


# ── Authentication gate ──────────────────────────────────────────────────────
# Until 1.9 the login screen only compared strings in JavaScript, so opening
# /static/dashboard.html directly — or calling the API with curl — skipped it
# entirely. This middleware is the real boundary: one check covers both the
# pages and the JSON API, because the session cookie rides along with static
# navigation requests too.

@app.middleware("http")
async def require_authentication(request: Request, call_next):
    path = request.url.path

    if is_public_path(path):
        return await call_next(request)

    if get_session_username(request.cookies.get(SESSION_COOKIE_NAME)):
        return await call_next(request)

    # Signed out. The API gets a status code it can branch on; a browser
    # navigating to a page gets sent to the login screen.
    if path.startswith("/api/"):
        return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    return RedirectResponse(url="/static/login.html")

# ── Static file serving ──────────────────────────────────────────────────────────────
#
# ROOT CAUSE FIX: Starlette 0.52+ uses os.path.realpath() inside lookup_path().
# On Python 3.14 + Windows, realpath() returns \\?\ extended-path prefixed
# strings for the PyInstaller _MEIPASS temp directory. The startswith() check
# that follows then silently fails → every static file returns 404.
#
# SOLUTION: Copy the frontend out of _MEIPASS into a real AppData directory
# once at startup. Serve from AppData — a normal Windows path that realpath()
# resolves without the \\?\ prefix, so StaticFiles works correctly.

FRONTEND_DIR = os.path.join(get_base_path(), "frontend")    # source (may be _MEIPASS)
STATIC_DIR   = os.path.join(DATA_DIR, "frontend_static")    # destination (AppData)

print(f"[STARTUP] Source frontend : {FRONTEND_DIR}  exists={os.path.isdir(FRONTEND_DIR)}", flush=True)
print(f"[STARTUP] Target static   : {STATIC_DIR}", flush=True)

if os.path.isdir(FRONTEND_DIR):
    try:
        # Always re-copy so upgrades are applied immediately.
        if os.path.isdir(STATIC_DIR):
            shutil.rmtree(STATIC_DIR)
        shutil.copytree(FRONTEND_DIR, STATIC_DIR)
        print(f"[STARTUP] Frontend copied to AppData OK. Files: {os.listdir(STATIC_DIR)}", flush=True)
    except Exception as e:
        print(f"[STARTUP] Copy failed ({e}), falling back to _MEIPASS directly.", flush=True)
        STATIC_DIR = FRONTEND_DIR
else:
    print(f"[ERROR] Frontend NOT bundled into EXE! Rebuild with build.py from project root.", flush=True)
    os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def read_root():
    # Reached only with a live session — the auth middleware above intercepts
    # "/" and sends signed-out visitors to the login page before we get here.
    return RedirectResponse(url="/static/dashboard.html")

# ── Server thread ────────────────────────────────────────────────────────────
def run_server():
    print("Starting FastAPI background server on port 8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

def on_closed():
    print("Application Window Closed. Shutting down system...")
    os._exit(0)

# ── Entry point ──────────────────────────────────────────────────────────────
import webbrowser

# ── PyWebview JS API Bridge ──────────────────────────────────────────────────
class JSAPI:
    # NOTE: the window reference MUST be named with a leading underscore.
    # pywebview builds the JS bridge by walking dir(js_api) in
    # webview/util.py:get_functions(), recursing into every non-callable
    # attribute. A plain `self.window` makes it descend into the pywebview
    # Window and then the native WebView2/WinForms control, where
    # AccessibilityObject.Bounds.Empty returns a fresh wrapper object on every
    # access — so the id()-based cycle guard never trips and it recurses until
    # RecursionError. That exception is swallowed in generate_js_object(), which
    # then never runs finish_script, so window.pywebview.api is NEVER populated
    # and every save_file() call silently disappears. get_functions() skips any
    # name starting with '_', so the underscore keeps the bridge alive.
    def __init__(self):
        self._window = None

    def save_file(self, content_base64, default_filename, file_type_desc, file_type_ext):
        import base64
        import traceback
        import webview
        try:
            if not self._window:
                return {"status": "error", "error": "Window not initialized"}
            file_types = (f'{file_type_desc} ({file_type_ext})', 'All files (*.*)')
            result = self._window.create_file_dialog(
                dialog_type=webview.SAVE_DIALOG,
                file_types=file_types,
                save_filename=default_filename
            )

            # pywebview >= 5.0 returns a sequence of paths from create_file_dialog for
            # every dialog type, so a save dialog hands back a 1-tuple rather than the
            # plain string older versions returned. Normalise both shapes to one path.
            if isinstance(result, (list, tuple)):
                save_path = result[0] if result else None
            else:
                save_path = result

            if not save_path:
                return {"status": "cancelled"}

            data = base64.b64decode(content_base64)
            with open(save_path, 'wb') as f:
                f.write(data)
            return {"status": "success", "path": str(save_path)}
        except Exception as e:
            print(f"[SAVE_FILE] Failed to save '{default_filename}': {e}", flush=True)
            traceback.print_exc()
            return {"status": "error", "error": str(e)}

def get_window_title() -> str:
    """Native window title follows the institute name configured in Settings."""
    try:
        from database import SessionLocal, SystemSettings
        db = SessionLocal()
        try:
            settings = db.query(SystemSettings).first()
            name = (settings.institute_name or "").strip() if settings else ""
        finally:
            db.close()
        return name or "Biometric Attendance"
    except Exception:
        return "Biometric Attendance"

if __name__ == "__main__":

    already_running = is_port_in_use(8000)

    if not already_running:
        # First instance: start the server
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        if not wait_for_server():
            print("Server did not become ready within 15 seconds; opening the UI so it can retry.")
    else:
        print("Server already running on port 8000. Bringing up UI only.")

    try:
        import webview
        print("Opening application natively via pywebview...")
        # Permit the WebView to complete blob/anchor downloads. This is the
        # fallback path in the frontend when the native save dialog is
        # unavailable; pywebview cancels such downloads by default.
        webview.settings['ALLOW_DOWNLOADS'] = True
        js_api = JSAPI()
        window = webview.create_window(
            get_window_title(),
            'http://127.0.0.1:8000/',
            width=1200,
            height=800,
            min_size=(900, 600),
            js_api=js_api
        )
        js_api._window = window
        window.events.closed += on_closed
        webview.start()
    except (ImportError, Exception) as e:
        print(f"Native window failed to initialize: {e}")
        print("Falling back to default Web Browser...")
        webbrowser.open("http://127.0.0.1:8000/")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    finally:
        print("Shutting down the server...")
        os._exit(0)
