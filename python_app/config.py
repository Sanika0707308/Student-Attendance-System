import os
import sys

# Prevent Avast/AVG Antivirus from crashing SSL/TLS context initialization via hijacked SSLKEYLOGFILE
if "SSLKEYLOGFILE" in os.environ:
    os.environ.pop("SSLKEYLOGFILE", None)

# Application Configuration
APP_NAME = "InstituteAttendance"

# Map to C:\Users\<User>\AppData\Local\InstituteAttendance on Windows
LOCAL_APP_DATA = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
DATA_DIR = os.path.join(LOCAL_APP_DATA, APP_NAME)

# Ensure persistent directories exist inside AppData
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
LOG_DIR = os.path.join(DATA_DIR, "logs")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

# Absolute Paths to persistent files
DB_FILE = os.path.join(DATA_DIR, "attendance.db")
KEY_FILE = os.path.join(DATA_DIR, ".encryption_key")
LOG_FILE = os.path.join(LOG_DIR, "app.log")
# Sink for print()/uvicorn output when running with --noconsole. Deliberately a
# different file from app.log: that one is owned by a RotatingFileHandler, and
# Windows refuses to rename a file while a second handle is still open on it, so
# sharing them would silently break log rotation.
CONSOLE_LOG_FILE = os.path.join(LOG_DIR, "console.log")

def get_base_path():
    """ 
    Get absolute path to static resources.
    Works for standard dev environment, AND for PyInstaller's temporary _MEIPASS folder.
    """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        # Fallback to the root directory during active development
        base_path = os.path.dirname(os.path.dirname(__file__))
    return base_path
