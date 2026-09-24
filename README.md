# Student Attendance System

A desktop & web-based automated attendance management system with ZKTeco biometric integration, automated email triggers, SQLite database, and administrative dashboard.

---

## 📁 Directory Structure

```plaintext
attendance_system/
├── frontend/                   # UI Web Application (HTML5, Vanilla CSS, JS)
│   ├── css/
│   ├── js/
│   ├── images/
│   ├── attendance.html
│   ├── dashboard.html
│   ├── login.html
│   ├── reports.html
│   ├── settings.html
│   └── students.html
│
├── python_app/                 # Backend Application (FastAPI, SQLite, PyZK)
│   ├── main.py                 # Application entry point
│   ├── config.py               # Environment & App configuration
│   ├── database.py             # Database models and session management
│   ├── zkteco_service.py       # Biometric hardware sync service
│   ├── email_service.py        # SMTP email alerts service
│   ├── backup_service.py       # Automated database backup service
│   ├── time_bound_service.py   # Scheduled attendance tasks
│   └── routers/                # API endpoints
│       ├── attendance.py
│       ├── holidays.py
│       ├── settings.py
│       └── students.py
│
├── scripts/                    # Diagnostic, Migration & Utility Scripts
│   ├── check_attendance.py
│   ├── check_db.py
│   ├── check_today.py
│   ├── fetch_logs.py
│   ├── migrate_db.py
│   └── test_connection.py
│
├── tests/                      # Automated E2E & Unit Tests
│   ├── conftest.py
│   ├── e2e/
│   ├── mocks/
│   └── pages/
│
├── docs/                       # System Documentation & Screenshots
│   ├── Build_Documentation.md
│   └── screenshots/
│
├── releases/                   # Built installer packages (.exe)
├── build.py                    # PyInstaller executable build script
├── installer.iss               # Inno Setup 7 compilation script
├── requirements.txt            # Python production dependencies
└── requirements-dev.txt        # Development and testing dependencies
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

### 2. Run the Application
```bash
python python_app/main.py
```

### 3. Build Windows Executable & Installer
```bash
python build.py
```
*(Requires Inno Setup 7 installed at `C:\Program Files\Inno Setup 7\ISCC.exe`)*