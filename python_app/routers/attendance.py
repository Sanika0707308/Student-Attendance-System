from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import datetime
import smtplib

from database import get_db, Attendance, Student, SystemSettings
from sqlalchemy.orm import joinedload
from email_service import send_email_notification

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

class AttendanceRead(BaseModel):
    id: int
    student_name: str
    student_zk_id: str
    standard: str
    punch_time: datetime
    status: str
    email_sent: bool

    class Config:
        from_attributes = True


from typing import List, Optional
from sqlalchemy import cast, Date

@router.get("/", response_model=List[AttendanceRead])
def get_attendance_logs(skip: int = 0, limit: int = 100, date: Optional[str] = None, month: Optional[str] = None, student_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Attendance)
    
    if student_id is not None:
        query = query.filter(Attendance.student_id == student_id)
        
    if date:
        try:
            # Parse 'YYYY-MM-DD'
            filter_date = datetime.strptime(date, "%Y-%m-%d").date()
            from datetime import time
            start_of_day = datetime.combine(filter_date, time.min)
            end_of_day = datetime.combine(filter_date, time.max)
            query = query.filter(Attendance.punch_time >= start_of_day, Attendance.punch_time <= end_of_day)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
            
    if month:
        try:
            # Parse 'YYYY-MM'
            filter_month = datetime.strptime(month, "%Y-%m")
            import calendar
            _, last_day = calendar.monthrange(filter_month.year, filter_month.month)
            from datetime import time
            start_date = datetime.combine(filter_month.date(), time.min)
            end_date = datetime.combine(filter_month.date().replace(day=last_day), time.max)
            query = query.filter(Attendance.punch_time >= start_date, Attendance.punch_time <= end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")
            
    logs = query.options(joinedload(Attendance.student)).order_by(Attendance.punch_time.desc()).offset(skip).limit(limit).all()
    
    result = []
    for log in logs:
        student = log.student
        result.append({
            "id": log.id,
            "student_name": student.name if student else "Unknown",
            "student_zk_id": student.zk_id if student else "Unknown",
            "standard": student.standard if student else "11th",
            "punch_time": log.punch_time,
            "status": log.status,
            "email_sent": log.email_sent
        })
    
    return result

from fastapi import BackgroundTasks
from database import SessionLocal

def retry_emails_task(log_ids: list):
    """
    Retry sending emails for all failed attendance records.
    
    IMPORTANT: We open a SINGLE shared SMTP connection here and reuse it for every
    email in the loop. Opening a new connection per-email (the naive approach) creates
    100+ separate Gmail login events in rapid succession, which triggers Gmail's
    rate-limiter and can result in the sender account being temporarily banned.
    """
    db_local = SessionLocal()
    shared_smtp = None
    try:
        # Use joinedload to fetch student data in one SQL JOIN, not N lazy queries
        logs = db_local.query(Attendance).options(joinedload(Attendance.student)).filter(
            Attendance.id.in_(log_ids)
        ).all()
        
        if not logs:
            return

        import time
        from database import SystemSettings
        from crypto_utils import decrypt_password

        def get_smtp_conn():
            settings = db_local.query(SystemSettings).first()
            if settings and settings.smtp_email and settings.smtp_password:
                conn = smtplib.SMTP("smtp.gmail.com", 587, timeout=30)
                conn.starttls()
                conn.login(settings.smtp_email, decrypt_password(settings.smtp_password))
                return conn
            return None

        try:
            shared_smtp = get_smtp_conn()
        except Exception as smtp_err:
            import structlog
            structlog.get_logger().error(f"Could not open shared SMTP for retry: {smtp_err}")
            shared_smtp = None

        marathi_status = {
            "Present": "आला/आली आहे (Present)",
            "Late": "उशिरा आला/आली आहे (Late Comer)",
            "Left Early": "लवकर गेला/गेली आहे (Left Early)",
            "Left": "गेला/गेली आहे (Left)",
            "Absent": "गैरहजर आहे (Absent)"
        }

        for log in logs:
            student = log.student
            if not student or not student.parent_email:
                continue
            action_str = marathi_status.get(log.status, log.status)
            
            success = send_email_notification(student.name, log.punch_time, student.parent_email, action_str, smtp_server=shared_smtp)
            
            if not success and shared_smtp is not None:
                # The connection might have been dropped by Gmail (e.g., rate limit or timeout).
                # Reconnect and retry once.
                try:
                    shared_smtp.quit()
                except:
                    pass
                try:
                    shared_smtp = get_smtp_conn()
                    success = send_email_notification(student.name, log.punch_time, student.parent_email, action_str, smtp_server=shared_smtp)
                except Exception as reconnect_err:
                    import structlog
                    structlog.get_logger().error(f"Reconnect failed: {reconnect_err}")
                    shared_smtp = None

            if success:
                log.email_sent = True
                
            # Sleep briefly to avoid triggering spam rate limits
            time.sleep(1.0)

        db_local.commit()
    finally:
        # Close the shared SMTP connection once after all emails are sent
        if shared_smtp:
            try:
                shared_smtp.quit()
            except Exception:
                pass
        db_local.close()
@router.get("/failed-emails/count")
def get_failed_emails_count(db: Session = Depends(get_db)):
    from datetime import timedelta
    from database import SystemSettings
    settings = db.query(SystemSettings).first()
    window_hours = getattr(settings, "email_retry_window_hours", 24) or 24
    cutoff = datetime.now() - timedelta(hours=window_hours)
    count = db.query(Attendance).filter(
        Attendance.email_sent.is_(False),
        Attendance.punch_time >= cutoff
    ).count()
    return {"count": count}

@router.post("/retry-emails")
def retry_failed_emails(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # Apply 24‑hour window (default 24 h) – configurable via settings
    from datetime import timedelta
    from database import SystemSettings
    settings = db.query(SystemSettings).first()
    # Default to 24 h if settings missing or value invalid
    window_hours = getattr(settings, "email_retry_window_hours", 24) or 24
    cutoff = datetime.now() - timedelta(hours=window_hours)
    failed_logs = db.query(Attendance).filter(
        Attendance.email_sent.is_(False),
        Attendance.punch_time >= cutoff
    ).all()
    count = len(failed_logs)
    if count == 0:
        return {"message": "No recent failed emails to retry", "count": 0}

    log_ids = [l.id for l in failed_logs]
    background_tasks.add_task(retry_emails_task, log_ids)
    return {"message": "Started retrying recent failed emails in background", "count": count}
@router.get("/failed-emails")
def get_failed_emails_list(db: Session = Depends(get_db)):
    from datetime import timedelta
    from database import SystemSettings
    settings = db.query(SystemSettings).first()
    window_hours = getattr(settings, "email_retry_window_hours", 24) or 24
    cutoff = datetime.now() - timedelta(hours=window_hours)

    # Fetch records where email_sent is False and within the cutoff
    failed_logs = db.query(Attendance).filter(
        Attendance.email_sent.is_(False),
        Attendance.punch_time >= cutoff
    ).order_by(Attendance.punch_time.desc()).all()
    
    result = []
    for log in failed_logs:
        student = log.student
        result.append({
            "id": log.id,
            "student_name": student.name if student else "Unknown",
            "punch_time": log.punch_time,
            "status": log.status
        })
    return result

# Admin endpoint to retry all failed emails
@router.post("/retry-all-failed")
def admin_retry_all_failed(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Admin-only endpoint to retry **all** failed email notifications."""
    settings = db.query(SystemSettings).first()
    if not settings or not getattr(settings, "admin_retry_all_allowed", False):
        raise HTTPException(status_code=403, detail="Admin retry not allowed")
    failed_logs = db.query(Attendance).filter(Attendance.email_sent.is_(False)).all()
    count = len(failed_logs)
    if count == 0:
        return {"message": "No failed emails to retry", "count": 0}
    log_ids = [l.id for l in failed_logs]
    background_tasks.add_task(retry_emails_task, log_ids)
    return {"message": "Started admin retry of all failed emails", "count": count}
