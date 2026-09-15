# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['python_app\\main.py'],
    pathex=['D:\\6th sem\\Student-Attendance-System-1.9-stable\\python_app'],
    binaries=[('D:\\6th sem\\Student-Attendance-System-1.9-stable\\zkemkeeper.dll', '.')],
    datas=[('D:\\6th sem\\Student-Attendance-System-1.9-stable\\frontend', 'frontend')],
    hiddenimports=['config', 'auth', 'backup_service', 'crypto_utils', 'database', 'email_service', 'message_templates', 'reports_service', 'time_bound_service', 'zkteco_service', 'uvicorn', 'fastapi', 'sqlalchemy', 'pydantic', 'pydantic.deprecated.decorator', 'sqlite3', 'email.mime', 'email.mime.multipart', 'email.mime.text', 'structlog', 'cryptography'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='InstituteAttendance',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
