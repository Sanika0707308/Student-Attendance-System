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
def get_attendance_logs(skip: int = 0, limit: int = 100, date: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Attendance)
    
    if date:
        try:
            print(f"[API] Filtering attendance for date: {date}")
            # SQLite specific date comparison using func.date
            from sqlalchemy import func
            query = query.filter(func.date(Attendance.punch_time) == date)
            print(f"[API] Filter applied for {date}")
            # The original code had a ValueError check for date format.
            # With func.date(Attendance.punch_time) == date, SQLAlchemy will handle
            # the comparison. If 'date' is not in 'YYYY-MM-DD' format, the query
            # will likely return no results, which is acceptable.
            # If strict format validation is still desired before the query,
            # a datetime.strptime check could be re-added here.
            # For now, removing the unconditional HTTPException as it would
            # prevent any logs from being returned.
        except Exception as e: # Catch any potential SQLAlchemy or other errors during filtering
            raise HTTPException(status_code=400, detail=f"Error applying date filter: {e}")
            
    logs = query.order_by(Attendance.punch_time.desc()).offset(skip).limit(limit).all()
    print(f"[API] Found {len(logs)} logs for date {date if date else 'All'}")
    
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

