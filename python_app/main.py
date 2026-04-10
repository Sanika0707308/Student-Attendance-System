import os
import sys
import threading
import time
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from config import get_base_path, LOG_FILE

# FIX: In --noconsole mode, stdout is None. We must redirect it to prevent Uvicorn from crashing.
sys.stdout = open(LOG_FILE, "a")
sys.stderr = open(LOG_FILE, "a")

from routers.students import router as students_router
from routers.attendance import router as attendance_router
from routers.settings import router as settings_router
from zkteco_service import zk_manager
from time_bound_service import time_bound_manager
from backup_service import backup_manager

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
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

from config import get_base_path

# Mount frontend simple static files
FRONTEND_DIR = os.path.join(get_base_path(), "frontend")
os.makedirs(FRONTEND_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def read_root():
    return RedirectResponse(url="/static/dashboard.html")

def run_server():
    print("Starting FastAPI background server on port 8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

def on_closed():
    print("Application Window Closed. Shutting down system...")
    # Add any cleanup logic here, such as stopping scheduler
    os._exit(0)

import webbrowser

if __name__ == "__main__":
    # Start the FastAPI server in a separate daemon thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # Wait briefly for server to start
    time.sleep(2)

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
