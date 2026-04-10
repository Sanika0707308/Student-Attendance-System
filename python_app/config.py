import os
import sys

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
