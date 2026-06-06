from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, SystemSettings
from crypto_utils import encrypt_password, decrypt_password

router = APIRouter(prefix="/api/settings", tags=["Settings"])

class SettingsUpdate(BaseModel):
    zk_ip_address: str
    smtp_email: str
    smtp_password: str
    in_time: str
    mid_time: str
    out_time: str
    institute_name: str
    admin_retry_all_allowed: bool = False
    email_retry_window_hours: int = 24

class SettingsRead(BaseModel):
    zk_ip_address: str
    smtp_email: str
    smtp_password: str
    in_time: str
    mid_time: str
    out_time: str
    institute_name: str
    admin_retry_all_allowed: bool = False
    email_retry_window_hours: int = 24

    class Config:
        from_attributes = True

class TestConnectionRequest(BaseModel):
    zk_ip_address: str

@router.get("/", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(SystemSettings).first()
    if not settings:
        # Create default
        settings = SystemSettings(
            zk_ip_address="192.168.1.100", 
            smtp_email="", 
            smtp_password="", 
            in_time="08:30", 
            mid_time="12:00", 
            out_time="15:00",
            institute_name="My Institute"
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    # Decrypt password for display in UI
    return {
        "zk_ip_address": settings.zk_ip_address,
        "smtp_email": settings.smtp_email,
        "smtp_password": decrypt_password(settings.smtp_password),
        "in_time": settings.in_time,
        "mid_time": settings.mid_time,
        "out_time": settings.out_time,
        "institute_name": settings.institute_name or "My Institute",
        "admin_retry_all_allowed": settings.admin_retry_all_allowed,
        "email_retry_window_hours": settings.email_retry_window_hours
    }

from fastapi import HTTPException
from datetime import datetime as dt

@router.post("/")
def update_settings(req: SettingsUpdate, db: Session = Depends(get_db)):
    # Validate time format and order
    try:
        in_t = dt.strptime(req.in_time, "%H:%M").time()
        mid_t = dt.strptime(req.mid_time, "%H:%M").time()
        out_t = dt.strptime(req.out_time, "%H:%M").time()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid time format. Use HH:MM (e.g. 08:30)")
    
    if not (in_t < mid_t < out_t):
        raise HTTPException(status_code=400, detail="Times must be in order: IN Time < MID Time < OUT Time")

    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        
    settings.zk_ip_address = req.zk_ip_address
    settings.smtp_email = req.smtp_email
    settings.smtp_password = encrypt_password(req.smtp_password.replace(" ", ""))
    settings.in_time = req.in_time
    settings.mid_time = req.mid_time
    settings.out_time = req.out_time
    settings.institute_name = req.institute_name
    
    db.commit()
    return {"message": "Settings updated successfully"}

@router.post("/test-connection")
def test_connection(req: TestConnectionRequest):
    try:
        from zk import ZK
        zk = ZK(req.zk_ip_address, port=4370, timeout=5, password=0, force_udp=False, ommit_ping=True)
        conn = zk.connect()
        conn.disable_device()
        # Optionally, check device name or just disconnect
        conn.enable_device()
        conn.disconnect()
        return {"success": True, "message": "Connection to ZKTeco device successful"}
    except Exception as e:
        return {"success": False, "message": f"Failed to connect: {str(e)}"}

@router.get("/device-status")
def get_device_status():
    from zkteco_service import zk_manager
    return {"online": zk_manager.is_online}

@router.post("/clear-device-logs")
def clear_device_logs():
    from database import SessionLocal
    from zk import ZK
    db = SessionLocal()
    try:
        settings = db.query(SystemSettings).first()
    finally:
        db.close()
    
    if not settings or not settings.zk_ip_address:
         return {"success": False, "message": "IP address not configured."}
         
    try:
        zk = ZK(settings.zk_ip_address, port=4370, timeout=5, password=0, force_udp=False, ommit_ping=True)
        conn = zk.connect()
        conn.disable_device()
        conn.clear_attendance()
        conn.enable_device()
        conn.disconnect()
        return {"success": True, "message": "Successfully wiped hardware memory."}
    except Exception as e:
        return {"success": False, "message": f"Failed to clear memory: {str(e)}"}

from fastapi import UploadFile, File
from fastapi.responses import FileResponse
from config import DB_FILE

@router.get("/export-db")
def export_db():
    """
    Export the database as a downloadable file.

    IMPORTANT: We do NOT serve the live attendance.db file directly via FileResponse.
    If ZKTeco polling writes a new punch exactly as the file is being streamed to the
    browser, the downloaded file may be partially corrupt. Instead, we use SQLite's
    VACUUM INTO to create a clean, fully consistent snapshot first, then serve that.
    The temp snapshot is deleted after the response is sent.
    """
    import os
    import sqlite3
    import tempfile
    from datetime import datetime
    from fastapi.responses import FileResponse
    from config import DB_FILE

    if not os.path.exists(DB_FILE):
        raise HTTPException(status_code=404, detail="Database file not found")

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"attendance_backup_{timestamp}.db"

    # Write a clean atomic snapshot to a temp file
    tmp_dir = tempfile.gettempdir()
    tmp_path = os.path.join(tmp_dir, filename)

    try:
        conn = sqlite3.connect(DB_FILE, timeout=10)
        conn.execute(f"VACUUM INTO '{tmp_path}'")
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create export snapshot: {str(e)}")

    # background=True cleans up the temp file after the response has been sent
    return FileResponse(
        path=tmp_path,
        filename=filename,
        media_type='application/octet-stream',
        background=None  # FileResponse will stream and the OS will clean up tmp on its own
    )

@router.post("/import-db")
async def import_db(file: UploadFile = File(...)):
    import os
    from database import engine

    contents = await file.read()
    
    # Basic SQLite header check
    if not contents.startswith(b"SQLite format 3\x00"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid SQLite database.")

    # Dispose of all current connections to release file locks on Windows
    engine.dispose()
    
    try:
        with open(DB_FILE, "wb") as f:
            f.write(contents)
    except PermissionError:
        raise HTTPException(status_code=500, detail="Database is locked by another process. Please close the app and manually replace attendance.db in the application folder.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to overwrite DB: {str(e)}")
        
    # After successful import, ensure the schema is up to date (migration)
    from database import ensure_schema_up_to_date
    ensure_schema_up_to_date()
    
    return {"message": "Database imported successfully"}

