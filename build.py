import PyInstaller.__main__
import os
import shutil
import subprocess
import sys
import zipfile

ISCC_PATH = r"C:\Program Files\Inno Setup 7\ISCC.exe"
ISS_FILE = "installer.iss"
VERSION = "1.9"

if __name__ == '__main__':
    backend_main = os.path.join('python_app', 'main.py')

    # In Windows, the separator for add-data is ';'
    # Use ABSOLUTE path for source so PyInstaller finds it regardless of CWD.
    # Relative paths can silently fail when the entry script is in a subdirectory.
    project_root = os.path.abspath('.')
    frontend_src = os.path.join(project_root, 'frontend')
    frontend_data = f'{frontend_src};frontend'

    # ── Pre-build check ───────────────────────────────────────────────────────
    if not os.path.isdir('frontend'):
        print("ERROR: 'frontend' directory not found. Run from the project root.")
        sys.exit(1)
    if not os.path.isfile(os.path.join('frontend', 'dashboard.html')):
        print("ERROR: frontend/dashboard.html not found. Frontend is incomplete.")
        sys.exit(1)
    print("[Pre-check] Frontend directory verified OK.")

    # Clean previous builds
    print("Cleaning old builds...")
    for folder in ['build', 'dist']:
        if os.path.exists(folder):
            shutil.rmtree(folder)

    hidden_imports = [
        'uvicorn',
        'fastapi',
        'sqlalchemy',
        'pydantic',
        'pydantic.deprecated.decorator',
        'sqlite3',
        'email.mime',
        'email.mime.multipart',
        'email.mime.text',
        'structlog',
        'cryptography'
    ]

    hidden_imports_args = []
    for inc in hidden_imports:
        hidden_imports_args.extend(['--hidden-import', inc])

    # ── Step 1: Build the .exe with PyInstaller ──────────────────────────────
    print("\n[Step 1/3] Building EXE with PyInstaller...")
    PyInstaller.__main__.run([
        backend_main,
        '--name=InstituteAttendance',
        '--noconsole',      # Hide the terminal window
        '--onefile',        # Create a single .exe
        f'--add-data={frontend_data}',
        '--clean'
    ] + hidden_imports_args)

    exe_path = os.path.join('dist', 'InstituteAttendance.exe')
    if not os.path.isfile(exe_path):
        print("ERROR: EXE was not created. Check PyInstaller output above.")
        sys.exit(1)
    print(f"\n[Step 1/3] EXE build complete! -> {exe_path}")

    # ── Step 1b: Verify frontend was bundled into the EXE ────────────────────
    # PyInstaller onefile EXEs are self-extracting zips. We can inspect the
    # embedded TOC to confirm 'frontend/dashboard.html' is present.
    print("\n[Step 1b/3] Verifying frontend bundle inside EXE...")
    try:
        with open(exe_path, 'rb') as f:
            content = f.read()
        if b'dashboard.html' in content:
            print("[Step 1b/3] VERIFIED: dashboard.html found inside EXE bundle. OK")
        else:
            print("[Step 1b/3] WARNING: dashboard.html NOT found in EXE. Frontend may be missing!")
            print("            Double-check that 'frontend/' folder is in the project root.")
    except Exception as e:
        print(f"[Step 1b/3] Could not verify bundle: {e}")

    # ── Step 2: Update installer version ────────────────────────────────────
    # Patch the ISS file's OutputBaseFilename to match current version
    with open(ISS_FILE, 'r') as f:
        iss_content = f.read()
    import re
    iss_content = re.sub(
        r'(OutputBaseFilename=AttendanceSystem_Setup_v)[\d.]+',
        f'\\g<1>{VERSION}',
        iss_content
    )
    iss_content = re.sub(
        r'(#define MyAppVersion ")[\d.]+"',
        f'\\g<1>{VERSION}"',
        iss_content
    )
    with open(ISS_FILE, 'w') as f:
        f.write(iss_content)
    print(f"\n[Step 2/3] installer.iss patched to version {VERSION}.")

    # ── Step 3: Compile the Inno Setup installer ─────────────────────────────
    print(f"\n[Step 3/3] Compiling Inno Setup installer with ISCC...")
    if not os.path.exists(ISCC_PATH):
        print(f"ERROR: ISCC not found at '{ISCC_PATH}'. Install Inno Setup 7 and re-run.")
        sys.exit(1)

    result = subprocess.run([ISCC_PATH, ISS_FILE], capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print("ISCC ERRORS:")
        print(result.stderr)
        sys.exit(result.returncode)

    output_installer = f"AttendanceSystem_Setup_v{VERSION}.exe"
    print(f"\n[Step 3/3] Installer compiled successfully!")
    print("=" * 55)
    print(f"  BUILD COMPLETE  (v{VERSION})")
    print(f"  EXE      : {exe_path}")
    print(f"  Installer: {output_installer}")
    print("=" * 55)
    print(f"\nSend '{output_installer}' to the client.")
