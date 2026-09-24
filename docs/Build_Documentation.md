# Windows Executable Build Process

This document provides a detailed breakdown of the technologies and logic used to package the Student Attendance System into a distributable Windows executable (`.exe`).

## 🛠️ Core Technologies Used

We utilize three main technologies working together in a pipeline to produce the final installer:

1. **[PyInstaller](https://pyinstaller.org/)**: A tool that freezes (packages) Python applications into stand-alone executables under Windows. It bundles the Python interpreter, all your dependencies (FastAPI, SQLAlchemy, zkteco, etc.), and your frontend assets into a single `.exe` file.
2. **[Inno Setup](https://jrsoftware.org/isinfo.php)**: A highly customizable, free installer builder for Windows programs. It takes the raw `.exe` created by PyInstaller and wraps it in a professional Setup Wizard (installer).
3. **Python (`build.py`)**: Our custom automation script that orchestrates the entire build process from start to finish.

---

## ⚙️ Detailed Build Logic (`build.py`)

When you run `python build.py`, the script executes a precise, 3-step pipeline:

### Pre-Build Verification
Before starting, the script checks if the `frontend` folder and `dashboard.html` exist. This prevents us from accidentally building a broken app that is missing the user interface. It also deletes old `build` and `dist` folders to ensure a clean slate.

### Step 1: PyInstaller (`InstituteAttendance.exe`)
The script invokes PyInstaller with the following critical flags:
* `--noconsole`: Hides the black command prompt terminal when the user runs the app.
* `--onefile`: Compresses everything into a single file (`InstituteAttendance.exe`).
* `--add-data`: Explicitly bundles the `frontend` directory inside the `.exe` so the FastAPI server can serve the HTML/JS/CSS files directly from memory.
* **Hidden Imports**: PyInstaller sometimes misses dynamic imports. We explicitly tell it to include libraries like `uvicorn`, `fastapi`, `sqlalchemy`, and `email.mime` so the app doesn't crash on the client's PC due to missing modules.

### Step 2: Version Patching
Once the core `.exe` is built, the script dynamically updates the version number (e.g., `v1.9`) inside the `installer.iss` file using Regular Expressions. This ensures that every time we build, the output installer file gets the correct version tag automatically without manual editing.

### Step 3: Inno Setup Compilation (`AttendanceSystem_Setup_v1.9.exe`)
The script calls `ISCC.exe` (Inno Setup Command-Line Compiler) and feeds it the `installer.iss` file. 

The Inno Setup script handles the Windows-specific magic:
* It packages `InstituteAttendance.exe` alongside the required biometric machine DLL (`zkemkeeper.dll`).
* It registers the DLL in the Windows system so the biometric device can communicate with our app.
* It creates the Desktop Shortcut and Start Menu folder.
* It sets up the Uninstaller so the client can cleanly remove the software if needed.

## 🔄 The Final Result

The entire process outputs a professional installer: **`AttendanceSystem_Setup_v1.9.exe`**. 

Because of this automated pipeline, the client doesn't need to install Python, configure environments, or know how to run scripts. They simply double-click the Setup file, click "Next", and the app is ready to use!
