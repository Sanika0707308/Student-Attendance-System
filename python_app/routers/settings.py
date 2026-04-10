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

class SettingsRead(BaseModel):
    zk_ip_address: str
    smtp_email: str
    smtp_password: str
    in_time: str
    mid_time: str
    out_time: str

    class Config:
        from_attributes = True

class TestConnectionRequest(BaseModel):
    zk_ip_address: str

@router.get("/", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(SystemSettings).first()
    if not settings:
        # Create default
        settings = SystemSettings(zk_ip_address="192.168.1.100", smtp_email="", smtp_password="", in_time="08:30", mid_time="12:00", out_time="15:00")
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
        "out_time": settings.out_time
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
    settings.smtp_password = encrypt_password(req.smtp_password)
    settings.in_time = req.in_time
    settings.mid_time = req.mid_time
    settings.out_time = req.out_time
    
    db.commit()
    return {"message": "Settings updated successfully"}

@router.post("/test-connection")
def test_connection(req: TestConnectionRequest):
    try:
        from zk import ZK
        zk = ZK(req.zk_ip_address, port=4370, timeout=5, password=0, force_udp=False, ommit_ping=False)
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
        zk = ZK(settings.zk_ip_address, port=4370, timeout=5, password=0, force_udp=False, ommit_ping=False)
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
from database import DB_FILE

@router.get("/export-db")
def export_db():
    import os
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"attendance_backup_{timestamp}.db"
    if not os.path.exists(DB_FILE):
        raise HTTPException(status_code=404, detail="Database file not found")
    return FileResponse(path=DB_FILE, filename=filename, media_type='application/octet-stream')

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
        
    return {"message": "Database imported successfully"}

