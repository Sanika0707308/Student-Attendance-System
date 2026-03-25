
import sys
import os
from datetime import datetime

# Add the python_app directory to the path so we can import from it
sys.path.append(os.path.join(os.getcwd(), 'python_app'))

from database import SessionLocal, Attendance, Student

def check_today_attendance():
    db = SessionLocal()
    try:
        today = datetime.now().date()
        print(f"Checking attendance for today ({today})...")
        
        records = db.query(Attendance).join(Student).filter(
            Attendance.punch_time >= datetime.combine(today, datetime.min.time())
        ).order_by(Attendance.punch_time.desc()).all()
        
        if not records:
            print("No attendance records found for today.")
        else:
            print(f"Found {len(records)} records for today:")
            for r in records:
                print(f"Time: {r.punch_time}, Student: {r.student.name} (ZK ID: {r.student.zk_id}), Status: {r.status}")
                
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_today_attendance()
