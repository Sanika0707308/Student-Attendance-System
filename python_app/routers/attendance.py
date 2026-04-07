from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
<<<<<<< HEAD
from typing import List
from datetime import datetime
=======
from datetime import datetime, time
from typing import List, Optional
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626

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


<<<<<<< HEAD
from typing import List, Optional
=======

>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
from sqlalchemy import cast, Date

@router.get("/", response_model=List[AttendanceRead])
def get_attendance_logs(skip: int = 0, limit: int = 100, date: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Attendance)
    
    if date:
        try:
            # Parse 'YYYY-MM-DD'
            filter_date = datetime.strptime(date, "%Y-%m-%d").date()
            # SQLite / SQLAlchemy casting can be unreliable for datetime -> date comparison.
            # Using a range [start_of_day, end_of_day] is more robust.
<<<<<<< HEAD
            from datetime import time
=======
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
            start_of_day = datetime.combine(filter_date, time.min)
            end_of_day = datetime.combine(filter_date, time.max)
            query = query.filter(Attendance.punch_time >= start_of_day, Attendance.punch_time <= end_of_day)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
            
    logs = query.order_by(Attendance.punch_time.desc()).offset(skip).limit(limit).all()
<<<<<<< HEAD
=======

>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
    
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

