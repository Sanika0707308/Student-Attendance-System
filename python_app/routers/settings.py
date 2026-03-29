from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, SystemSettings

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
    return settings

@router.post("/")
def update_settings(req: SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        
    settings.zk_ip_address = req.zk_ip_address
    settings.smtp_email = req.smtp_email
    settings.smtp_password = req.smtp_password
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
    settings = db.query(SystemSettings).first()
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

