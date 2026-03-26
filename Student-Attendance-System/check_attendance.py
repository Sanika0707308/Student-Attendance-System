
import sys
import os
from datetime import datetime

# Add the python_app directory to the path so we can import from it
sys.path.append(os.path.join(os.getcwd(), 'python_app'))

from database import SessionLocal, Attendance, Student

def check_recent_attendance():
    db = SessionLocal()
    try:
        print(f"Checking attendance at {datetime.now()}...")
        # Get latest 5 attendance records
        records = db.query(Attendance).join(Student).order_by(Attendance.punch_time.desc()).limit(5).all()
        
        if not records:
            print("No attendance records found.")
        else:
            print(f"Found {len(records)} recent records:")
            for r in records:
                print(f"Time: {r.punch_time}, Student: {r.student.name} (ZK ID: {r.student.zk_id}), Status: {r.status}, Email Sent: {r.email_sent}")
                
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_recent_attendance()
