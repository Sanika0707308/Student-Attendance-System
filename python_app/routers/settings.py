from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from database import get_db, SystemSettings, get_configured_standards, DEFAULT_STANDARDS
from crypto_utils import encrypt_password, decrypt_password
from message_templates import (
    DEFAULT_STATUS_WORDS,
    DEFAULT_SUBJECT,
    DEFAULT_TEMPLATES,
    PLACEHOLDERS,
    STATUS_FIELDS,
    all_defaults,
    build_context,
    render,
    status_phrase_for_status,
    subject_for,
    template_for_status,
)

router = APIRouter(prefix="/api/settings", tags=["Settings"])

# Both languages the desktop UI ships with. English stays the default so an
# upgrade from 1.9 looks exactly like it did before.
SUPPORTED_LANGUAGES = ("en", "mr")


class SettingsUpdate(BaseModel):
    zk_ip_address: str
    smtp_email: str
    smtp_password: str
    in_time: str
    mid_time: str
    out_time: str
    institute_name: str
    standards: str = "11th,12th"
    admin_retry_all_allowed: bool = False
    email_retry_window_hours: int = 24
    ui_language: str = "en"
    msg_present: str = "आला/आली आहे (Present)"
    msg_late: str = "उशिरा आला/आली आहे (Late Comer)"
    msg_absent: str = "गैरहजर आहे (Absent)"
    msg_left_early: str = "लवकर गेला/गेली आहे (Left Early)"
    msg_left: str = "गेला/गेली आहे (Left)"
    # Full notification bodies. Optional so that a client which only knows the
    # 1.9 payload (or the Playwright tests) can still save the rest of the form
    # without wiping the templates.
    email_subject: str | None = None
    tpl_present: str | None = None
    tpl_late: str | None = None
    tpl_absent: str | None = None
    tpl_left_early: str | None = None
    tpl_left: str | None = None

class SettingsRead(BaseModel):
    zk_ip_address: str
    smtp_email: str
    smtp_password: str
    in_time: str
    mid_time: str
    out_time: str
    institute_name: str
    standards: str = "11th,12th"
    admin_retry_all_allowed: bool = False
    email_retry_window_hours: int = 24
    ui_language: str = "en"
    msg_present: str
    msg_late: str
    msg_absent: str
    msg_left_early: str
    msg_left: str
    email_subject: str
    tpl_present: str
    tpl_late: str
    tpl_absent: str
    tpl_left_early: str
    tpl_left: str

    class Config:
        from_attributes = True

class TestConnectionRequest(BaseModel):
    zk_ip_address: str


class MessagePreviewRequest(BaseModel):
    """A template plus the status to preview it as, before saving."""
    status: str = "Present"
    subject: str | None = None
    body: str | None = None
    status_phrase: str | None = None


class LanguageUpdate(BaseModel):
    ui_language: str = "en"

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
            institute_name="Biometric Attendance",
            **DEFAULT_STATUS_WORDS,
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
        "institute_name": settings.institute_name or "Biometric Attendance",
        "standards": ",".join(get_configured_standards(db)),
        "admin_retry_all_allowed": settings.admin_retry_all_allowed,
        "email_retry_window_hours": settings.email_retry_window_hours,
        "ui_language": (settings.ui_language or "en") if (settings.ui_language or "en") in SUPPORTED_LANGUAGES else "en",
        "msg_present": status_phrase_for_status(settings, "Present"),
        "msg_late": status_phrase_for_status(settings, "Late"),
        "msg_absent": status_phrase_for_status(settings, "Absent"),
        "msg_left_early": status_phrase_for_status(settings, "Left Early"),
        "msg_left": status_phrase_for_status(settings, "Left"),
        # Resolved rather than raw: an empty column means "use the shipped
        # default", and the editor has to show the text that is actually being
        # sent or the admin would be editing a blank box.
        "email_subject": subject_for(settings),
        "tpl_present": template_for_status(settings, "Present"),
        "tpl_late": template_for_status(settings, "Late"),
        "tpl_absent": template_for_status(settings, "Absent"),
        "tpl_left_early": template_for_status(settings, "Left Early"),
        "tpl_left": template_for_status(settings, "Left"),
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

    # Normalise the class list: de-duplicate, drop blanks, preserve the entered
    # order. An empty list would leave every dropdown in the app unusable, so
    # fall back to the shipped default instead of saving nothing.
    seen = set()
    parsed_standards = []
    for raw in (req.standards or "").split(","):
        name = raw.strip()
        if name and name.lower() != "all" and name.lower() not in seen:
            seen.add(name.lower())
            parsed_standards.append(name)
    if not parsed_standards:
        parsed_standards = list(DEFAULT_STANDARDS)

    if req.email_retry_window_hours < 1 or req.email_retry_window_hours > 8760:
        raise HTTPException(status_code=400, detail="Email retry window must be between 1 and 8760 hours")

    language = (req.ui_language or "en").strip().lower()
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail="Language must be one of: " + ", ".join(SUPPORTED_LANGUAGES),
        )

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
    settings.institute_name = req.institute_name.strip() or "Biometric Attendance"
    settings.standards = ",".join(parsed_standards)
    # These two were declared on SettingsUpdate but never assigned, so the retry
    # window was permanently stuck at its default and /retry-all-failed could
    # never be enabled no matter what the UI sent.
    settings.admin_retry_all_allowed = req.admin_retry_all_allowed
    settings.email_retry_window_hours = req.email_retry_window_hours
    settings.ui_language = language
    settings.msg_present = req.msg_present
    settings.msg_late = req.msg_late
    settings.msg_absent = req.msg_absent
    settings.msg_left_early = req.msg_left_early
    settings.msg_left = req.msg_left

    # Templates are only touched when the client actually sent them. `None` means
    # "this client does not manage templates", which is different from an empty
    # string; blanking a body would stop notifications for that status entirely.
    template_fields = {
        "email_subject": req.email_subject,
        "tpl_present": req.tpl_present,
        "tpl_late": req.tpl_late,
        "tpl_absent": req.tpl_absent,
        "tpl_left_early": req.tpl_left_early,
        "tpl_left": req.tpl_left,
    }
    for field, value in template_fields.items():
        if value is None:
            continue
        if not value.strip():
            raise HTTPException(
                status_code=400,
                detail=f"'{field}' cannot be empty. Use Restore Defaults to bring back the original wording.",
            )
        setattr(settings, field, value)

    db.commit()
    return {"message": "Settings updated successfully"}


@router.post("/language")
def set_language(req: LanguageUpdate, db: Session = Depends(get_db)):
    """
    Persist the display language on its own.

    The sidebar toggle uses this instead of the full settings form: switching
    language should not require the admin to have the rest of the form loaded,
    and a partial POST to `/api/settings/` would overwrite the SMTP password with
    a blank one.
    """
    language = (req.ui_language or "en").strip().lower()
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail="Language must be one of: " + ", ".join(SUPPORTED_LANGUAGES),
        )

    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(**DEFAULT_STATUS_WORDS)
        db.add(settings)
    settings.ui_language = language
    db.commit()
    return {"success": True, "ui_language": language}


# ── Parent message templates ─────────────────────────────────────────────────


@router.get("/message-placeholders")
def message_placeholders():
    """The placeholder list the Settings editor documents next to each box."""
    return {
        "placeholders": [{"token": token, "description": desc} for token, desc in PLACEHOLDERS],
        "statuses": [
            {"status": status, "template_field": fields[0], "phrase_field": fields[1]}
            for status, fields in STATUS_FIELDS.items()
        ],
    }


@router.get("/message-defaults")
def message_defaults():
    """The shipped wording, so the UI can offer a per-field Restore Defaults."""
    return all_defaults()


@router.post("/preview-message")
def preview_message(req: MessagePreviewRequest, db: Session = Depends(get_db)):
    """
    Render a template against sample data without saving it.

    Lets an administrator see the finished email before committing to it — the
    alternative is editing blind and finding out from a parent.
    """
    from datetime import datetime as _dt

    settings = db.query(SystemSettings).first()
    institute = (settings.institute_name or "Biometric Attendance").strip() if settings else "Biometric Attendance"
    standards = get_configured_standards(db)

    status = req.status if req.status in STATUS_FIELDS else "Present"
    phrase = (req.status_phrase or "").strip() or status_phrase_for_status(settings, status)
    subject_tpl = req.subject if req.subject is not None else subject_for(settings)
    body_tpl = req.body if req.body is not None else template_for_status(settings, status)

    # A fixed sample time rather than "now": the preview is about the wording,
    # and a stable value makes it obvious which placeholder produced what.
    sample_time = _dt.now().replace(hour=9, minute=15, second=0, microsecond=0)
    context = build_context(
        student_name="Sanika Patil",
        punch_time=sample_time,
        status=status,
        status_phrase=phrase,
        institute_name=institute,
        standard=standards[0] if standards else "11th",
    )

    return {
        "status": status,
        "subject": render(subject_tpl, context),
        "body": render(body_tpl, context),
        "context": context,
    }


@router.get("/standards", response_model=List[str])
def list_standards(db: Session = Depends(get_db)):
    """
    The institute's class list, used to populate every standard dropdown in the
    frontend so the values are no longer hardcoded per page.
    """
    return get_configured_standards(db)

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

from fastapi import UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from config import DB_FILE

def delete_temp_file(path: str):
    import os
    try:
        if os.path.exists(path):
            os.remove(path)
    except:
        pass

@router.get("/export-db")
def export_db(background_tasks: BackgroundTasks):
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
    import shutil
    import webview
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

    active_win = webview.active_window()
    if active_win:
        file_types = ('Database Files (*.db)', 'All Files (*.*)')
        save_path = active_win.create_file_dialog(
            dialog_type=webview.SAVE_DIALOG,
            file_types=file_types,
            save_filename=filename
        )
        if not save_path:
            # Cancelled by user
            delete_temp_file(tmp_path)
            return {"success": False, "message": "Export cancelled by user"}

        try:
            shutil.copy2(tmp_path, save_path)
            delete_temp_file(tmp_path)
            return {"success": True, "path": save_path}
        except Exception as copy_err:
            delete_temp_file(tmp_path)
            raise HTTPException(status_code=500, detail=f"Failed to save file: {str(copy_err)}")
    else:
        background_tasks.add_task(delete_temp_file, tmp_path)
        return FileResponse(
            path=tmp_path,
            filename=filename,
            media_type='application/octet-stream'
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

@router.post("/reset-db")
def reset_db(db: Session = Depends(get_db)):
    """Wipes all data from the database (students, attendance, holidays) and resets settings to default."""
    from database import Student, Attendance, Holiday, SystemSettings
    try:
        # Delete attendance logs
        db.query(Attendance).delete()
        # Delete students
        db.query(Student).delete()
        # Delete holidays
        db.query(Holiday).delete()
        # Reset settings to default
        db.query(SystemSettings).delete()
        
        # Add default setting
        settings = SystemSettings(
            zk_ip_address="192.168.1.100",
            smtp_email="",
            smtp_password="",
            in_time="08:30",
            mid_time="12:00",
            out_time="15:00",
            institute_name="Biometric Attendance",
            **DEFAULT_STATUS_WORDS,
        )
        db.add(settings)
        db.commit()
        return {"success": True, "message": "Database wiped and settings reset to default."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reset database: {str(e)}")
