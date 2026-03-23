
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'python_app'))

from database import SessionLocal, Attendance
from sqlalchemy import cast, Date, func
from datetime import datetime, time

def test_query():
    db = SessionLocal()
    date_str = "2026-03-17"
    filter_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    
    # Try current way
    print(f"Testing cast(punch_time, Date) == {filter_date}")
    logs = db.query(Attendance).filter(cast(Attendance.punch_time, Date) == filter_date).all()
    print(f"Count (cast): {len(logs)}")
    
    # Try today_start/end method (most reliable)
    today_start = datetime.combine(filter_date, time.min)
    today_end = datetime.combine(filter_date, time.max)
    print(f"Testing punch_time between {today_start} and {today_end}")
    logs_range = db.query(Attendance).filter(Attendance.punch_time >= today_start, Attendance.punch_time <= today_end).all()
    print(f"Count (range): {len(logs_range)}")
    
    db.close()

if __name__ == "__main__":
    test_query()
