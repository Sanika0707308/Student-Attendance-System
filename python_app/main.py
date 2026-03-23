import os
import threading
import time
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from routers.students import router as students_router
from routers.attendance import router as attendance_router
from routers.settings import router as settings_router
from zkteco_service import zk_manager
from time_bound_service import time_bound_manager

app = FastAPI(title="Attendance System API")

app.include_router(students_router)
app.include_router(attendance_router)
app.include_router(settings_router)

@app.on_event("startup")
def startup_event():
    # Start polling ZKTeco device every 10 seconds
    zk_manager.start_polling(interval_seconds=10)
    # Start the Time-Bound absence checker background daemon
    time_bound_manager.start_scheduler()

@app.on_event("shutdown")
def shutdown_event():
    zk_manager.stop_polling()
    time_bound_manager.stop_scheduler()

import sys

def get_base_path():
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.dirname(os.path.dirname(__file__))
    return base_path

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
    print("PyWebView Window Closed. Exiting application...")
    # Add any cleanup logic here, such as stopping scheduler
    os._exit(0)

import webbrowser

if __name__ == "__main__":
    # Start the FastAPI server in a separate daemon thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # Wait briefly for server to start
    time.sleep(1)

    print("Opening application in your default web browser...")
    webbrowser.open("http://127.0.0.1:8000/")
    
    try:
        # Keep the main thread alive since we are no longer using pywebview's blocking loop
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Shutting down the server...")
        os._exit(0)
