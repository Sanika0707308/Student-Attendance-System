import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import sys
import os

# Import models from python_app
sys.path.append(os.path.abspath('python_app'))
from database import Student, Attendance, Base

DATABASE_URL = "sqlite:///python_app/attendance.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

# Cleanup existing attendance for today to start fresh
today = datetime.date.today()
today_start = datetime.datetime.combine(today, datetime.time.min)
today_end = datetime.datetime.combine(today, datetime.time.max)
db.query(Attendance).filter(Attendance.punch_time >= today_start, Attendance.punch_time <= today_end).delete()
db.commit()

# Ensure we have a few students
students_data = [
    {"name": "Vaishnavi", "zk_id": "1", "parent_email": "vaishnavikamble6247@gmail.com"},
    {"name": "Rahul", "zk_id": "2", "parent_email": "rahul@example.com"},
    {"name": "Sneha", "zk_id": "3", "parent_email": "sneha@example.com"},
    {"name": "Amit", "zk_id": "4", "parent_email": "amit@example.com"},
    {"name": "Priya", "zk_id": "5", "parent_email": "priya@example.com"},
]

for s_info in students_data:
    student = db.query(Student).filter(Student.zk_id == s_info["zk_id"]).first()
    if not student:
        student = Student(name=s_info["name"], zk_id=s_info["zk_id"], parent_email=s_info["parent_email"])
        db.add(student)
        db.commit()
    s_info["id"] = student.id

# Add attendance records for today
# 1. Present (In Time) - Vaishnavi
db.add(Attendance(student_id=students_data[0]["id"], punch_time=datetime.datetime.combine(today, datetime.time(7, 30)), status="Present"))

# 2. Late - Rahul
db.add(Attendance(student_id=students_data[1]["id"], punch_time=datetime.datetime.combine(today, datetime.time(9, 30)), status="Late"))

# 3. Departure (Left) - Sneha
db.add(Attendance(student_id=students_data[2]["id"], punch_time=datetime.datetime.combine(today, datetime.time(8, 0)), status="Present"))
db.add(Attendance(student_id=students_data[2]["id"], punch_time=datetime.datetime.combine(today, datetime.time(17, 30)), status="Left"))

# 4. Absent - Amit
db.add(Attendance(student_id=students_data[3]["id"], punch_time=datetime.datetime.combine(today, datetime.time(12, 0)), status="Absent"))

# 5. All Status show for Priya (no records today)
# No records for Priya

db.commit()
db.close()
print("Success: Test students and today's attendance records created.")
