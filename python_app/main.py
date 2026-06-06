import os
import sys
import shutil
import threading
import time
import socket
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from contextlib import asynccontextmanager

from config import get_base_path, DATA_DIR, LOG_FILE

# FIX: In --noconsole mode, stdout is None. We must redirect it to prevent Uvicorn from crashing.
sys.stdout = open(LOG_FILE, "a")
sys.stderr = open(LOG_FILE, "a")

from routers.students import router as students_router
from routers.attendance import router as attendance_router
from routers.settings import router as settings_router
from routers.holidays import router as holidays_router
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

app.include_router(students_router)
app.include_router(attendance_router)
app.include_router(settings_router)
app.include_router(holidays_router)

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

if __name__ == "__main__":

    already_running = is_port_in_use(8000)

    if not already_running:
        # First instance: start the server
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        # Wait briefly for server to start
        time.sleep(2)
    else:
        print("Server already running on port 8000. Bringing up UI only.")

    try:
        import webview
        print("Opening application natively via pywebview...")
        window = webview.create_window(
            'Institute Attendance System',
            'http://127.0.0.1:8000/',
            width=1200,
            height=800,
            min_size=(900, 600)
        )
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
