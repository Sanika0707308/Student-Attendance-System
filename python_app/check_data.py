from database import SessionLocal, Student, Attendance
from datetime import datetime

def check():
    db = SessionLocal()
    now = datetime.now()
    today_start = datetime.combine(now.date(), datetime.min.time())
    today_end = datetime.combine(now.date(), datetime.max.time())
    
    print(f"Checking records for {now.date()}...")
    
    students = db.query(Student).all()
    for s in students:
        att = db.query(Attendance).filter(
            Attendance.student_id == s.id,
            Attendance.punch_time >= today_start,
            Attendance.punch_time <= today_end
        ).all()
        print(f"Student: {s.name} (ID: {s.id}, ZK: {s.zk_id})")
        if not att:
            print("  -> NO RECORDS TODAY")
        for a in att:
            print(f"  -> {a.punch_time} | {a.status}")
    db.close()

if __name__ == "__main__":
    check()
