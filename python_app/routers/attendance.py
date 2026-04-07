from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import datetime

from database import get_db, Attendance, Student
from email_service import send_email_notification

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

class AttendanceRead(BaseModel):
    id: int
    student_name: str
    student_zk_id: str
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
            
    logs = query.order_by(Attendance.punch_time.desc()).offset(skip).limit(limit).all()
    
    result = []
    for log in logs:
        student = log.student
        result.append({
            "id": log.id,
            "student_name": student.name if student else "Unknown",
            "student_zk_id": student.zk_id if student else "Unknown",
            "punch_time": log.punch_time,
            "status": log.status,
            "email_sent": log.email_sent
        })
    
    return result

from fastapi import BackgroundTasks
from database import SessionLocal

def retry_emails_task(log_ids: list):
    db_local = SessionLocal()
    try:
        logs = db_local.query(Attendance).filter(Attendance.id.in_(log_ids)).all()
        for log in logs:
            student = log.student
            if not student or not student.parent_email:
                continue
                
            marathi_status = {
                "Present": "आला/आली आहे (Present)",
                "Late": "उशिरा आला/आली आहे (Late Comer)",
                "Left Early": "लवकर गेला/गेली आहे (Left Early)",
                "Left": "गेला/गेली आहे (Left)",
                "Absent": "गैरहजर आहे (Absent)"
            }
            action_str = marathi_status.get(log.status, log.status)
            
            if send_email_notification(student.name, log.punch_time, student.parent_email, action_str):
                log.email_sent = True
        db_local.commit()
    finally:
        db_local.close()

@router.post("/retry-emails")
def retry_failed_emails(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    failed_logs = db.query(Attendance).filter(Attendance.email_sent == False).all()
    count = len(failed_logs)
    if count == 0:
        return {"message": "No failed emails to retry", "count": 0}
        
    log_ids = [l.id for l in failed_logs]
    background_tasks.add_task(retry_emails_task, log_ids)
    return {"message": "Started retrying emails in background", "count": count}
