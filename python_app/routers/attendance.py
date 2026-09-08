from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime
import smtplib

from database import get_db, Attendance, Student, SystemSettings, Holiday
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
    email_failure_reason: Optional[str] = None
    is_manual: bool = False

    class Config:
        from_attributes = True


VALID_STATUSES = ["Present", "Late", "Left Early", "Left", "Absent"]


class ManualAttendanceCreate(BaseModel):
    """An attendance row entered by an administrator rather than the device."""
    student_id: int
    punch_time: datetime
    status: str
    notify_parent: bool = False

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        value = (v or "").strip()
        if value not in VALID_STATUSES:
            raise ValueError("Status must be one of: " + ", ".join(VALID_STATUSES))
        return value


class ManualAttendanceUpdate(BaseModel):
    punch_time: datetime
    status: str
    notify_parent: bool = False

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        value = (v or "").strip()
        if value not in VALID_STATUSES:
            raise ValueError("Status must be one of: " + ", ".join(VALID_STATUSES))
        return value


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

    # Read the relevant holiday rules once. Checking the database for every log
    # makes a large report slow and can make the interface appear to hang.
    dates_in_result = {log.punch_time.date().isoformat() for log in logs}
    holiday_rules = {}
    if dates_in_result:
        for holiday in db.query(Holiday).filter(Holiday.date.in_(dates_in_result)).all():
            holiday_rules.setdefault(holiday.date, set()).add(holiday.standard or "All")
    
    result = []
    for log in logs:
        student = log.student
        standard = (student.standard if student else "11th") or "11th"
        # Hide records that may have been saved before the holiday rule was
        # configured. This keeps old records from affecting dashboard/report totals.
        rules_for_day = holiday_rules.get(log.punch_time.date().isoformat(), set())
        if "All" in rules_for_day or standard in rules_for_day:
            continue
        result.append({
            "id": log.id,
            "student_name": student.name if student else "Unknown",
            "student_zk_id": student.zk_id if student else "Unknown",
            "standard": standard,
            "punch_time": log.punch_time,
            "status": log.status,
            "email_sent": log.email_sent,
            "email_failure_reason": log.email_failure_reason,
            "is_manual": bool(log.is_manual)
        })

    return result

from fastapi import BackgroundTasks
from database import SessionLocal

def retry_emails_task(log_ids: list):
    """
    Retry sending emails for all failed attendance records by queuing them in the email worker queue.
    """
    from zkteco_service import _send_email_async
    for log_id in log_ids:
        _send_email_async(log_id)
@router.get("/failed-emails/count")
def get_failed_emails_count(db: Session = Depends(get_db)):
    from datetime import timedelta
    from database import SystemSettings
    settings = db.query(SystemSettings).first()
    window_hours = getattr(settings, "email_retry_window_hours", 24) or 24
    cutoff = datetime.now() - timedelta(hours=window_hours)
    count = db.query(Attendance).filter(
        Attendance.email_sent.isnot(True),
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
        Attendance.email_sent.isnot(True),
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
        Attendance.email_sent.isnot(True),
        Attendance.punch_time >= cutoff
    ).order_by(Attendance.punch_time.desc()).all()
    
    result = []
    for log in failed_logs:
        student = log.student
        result.append({
            "id": log.id,
            "student_name": student.name if student else "Unknown",
            "punch_time": log.punch_time,
            "status": log.status,
            "email_failure_reason": log.email_failure_reason
        })
    return result

# Admin endpoint to retry all failed emails
@router.post("/retry-all-failed")
def admin_retry_all_failed(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Admin-only endpoint to retry **all** failed email notifications."""
    settings = db.query(SystemSettings).first()
    if not settings or not getattr(settings, "admin_retry_all_allowed", False):
        raise HTTPException(status_code=403, detail="Admin retry not allowed")
    failed_logs = db.query(Attendance).filter(Attendance.email_sent.isnot(True)).all()
    count = len(failed_logs)
    if count == 0:
        return {"message": "No failed emails to retry", "count": 0}
    log_ids = [l.id for l in failed_logs]
    background_tasks.add_task(retry_emails_task, log_ids)
    return {"message": "Started admin retry of all failed emails", "count": count}


# ── Manual correction ────────────────────────────────────────────────────────
# The device is the source of truth on a normal day, but it misses punches, and
# the time-bound daemon marks students Absent who were actually present. Before
# 2.0 there was no way to fix either — these three endpoints are that path.
#
# Unlike device punches, an administrator's entry deliberately bypasses the
# holiday check, the 5-minute debounce and the one-punch-per-half rule in
# zkteco_service._process_single_punch: those guards exist to filter noisy
# hardware, and applying them here would block the very corrections the admin
# is trying to make. Every such row is flagged is_manual so it stays auditable.

def _serialize_log(log: Attendance) -> dict:
    student = log.student
    return {
        "id": log.id,
        "student_name": student.name if student else "Unknown",
        "student_zk_id": student.zk_id if student else "Unknown",
        "standard": (student.standard if student else "11th") or "11th",
        "punch_time": log.punch_time,
        "status": log.status,
        "email_sent": bool(log.email_sent),
        "email_failure_reason": log.email_failure_reason,
        "is_manual": bool(log.is_manual),
    }


def _queue_parent_email(attendance_id: int) -> None:
    """Hand the record to the existing serialized email worker."""
    from zkteco_service import _send_email_async
    _send_email_async(attendance_id)


@router.post("/manual", response_model=AttendanceRead)
def create_manual_attendance(req: ManualAttendanceCreate,
                             background_tasks: BackgroundTasks,
                             db: Session = Depends(get_db)):
    """Add an attendance record by hand (missed punch, or a wrongly absent student)."""
    student = db.query(Student).filter(Student.id == req.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # One record per student per half-day, matching how the device behaves —
    # otherwise a correction silently double-counts the day in reports.
    settings = db.query(SystemSettings).first()
    mid_time_str = (getattr(settings, "mid_time", None) or "12:00") if settings else "12:00"
    try:
        mid_time_obj = datetime.strptime(mid_time_str, "%H:%M").time()
    except ValueError:
        mid_time_obj = datetime.strptime("12:00", "%H:%M").time()

    from datetime import time as time_cls
    punch_date = req.punch_time.date()
    if req.punch_time.time() < mid_time_obj:
        half_start = datetime.combine(punch_date, time_cls.min)
        half_end = datetime.combine(punch_date, mid_time_obj)
    else:
        half_start = datetime.combine(punch_date, mid_time_obj)
        half_end = datetime.combine(punch_date, time_cls.max)

    clash = db.query(Attendance).filter(
        Attendance.student_id == student.id,
        Attendance.punch_time >= half_start,
        Attendance.punch_time <= half_end
    ).first()

    if clash:
        # An auto-marked Absent is exactly what the admin is correcting, so
        # replace it rather than refusing — same rule the punch handler applies.
        if clash.status == "Absent":
            db.delete(clash)
            db.flush()
        else:
            raise HTTPException(
                status_code=409,
                detail=(f"{student.name} already has a '{clash.status}' record at "
                        f"{clash.punch_time.strftime('%Y-%m-%d %H:%M')} in this half of the day. "
                        "Edit that record instead.")
            )

    record = Attendance(
        student_id=student.id,
        punch_time=req.punch_time,
        status=req.status,
        is_manual=True,
        # Nothing has been emailed yet. Leaving this False when the admin did not
        # ask for a notification would park the row in the failed-emails list, so
        # mark it sent to keep that counter meaningful.
        email_sent=not req.notify_parent,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    if req.notify_parent:
        background_tasks.add_task(_queue_parent_email, record.id)

    return _serialize_log(record)


@router.put("/{attendance_id}", response_model=AttendanceRead)
def update_attendance(attendance_id: int, req: ManualAttendanceUpdate,
                      background_tasks: BackgroundTasks,
                      db: Session = Depends(get_db)):
    """Correct the time or status of an existing record."""
    record = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    record.punch_time = req.punch_time
    record.status = req.status
    record.is_manual = True

    if req.notify_parent:
        # Re-open the record for sending and clear the previous failure text so
        # the dashboard does not keep showing a stale reason.
        record.email_sent = False
        record.email_failure_reason = None
    else:
        record.email_sent = True

    db.commit()
    db.refresh(record)

    if req.notify_parent:
        background_tasks.add_task(_queue_parent_email, record.id)

    return _serialize_log(record)


@router.delete("/{attendance_id}")
def delete_attendance(attendance_id: int, db: Session = Depends(get_db)):
    """Remove a record — a duplicate, or an Absent the daemon got wrong."""
    record = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    db.delete(record)
    db.commit()
    return {"message": "Attendance record deleted"}
