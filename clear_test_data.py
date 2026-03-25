import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import sys
import os

# Import models from python_app
sys.path.append(os.path.abspath('python_app'))
from database import Student, Attendance

DATABASE_URL = "sqlite:///python_app/attendance.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

# Delete today's attendance records
today = datetime.date.today()
today_start = datetime.datetime.combine(today, datetime.time.min)
today_end = datetime.datetime.combine(today, datetime.time.max)

count = db.query(Attendance).filter(Attendance.punch_time >= today_start, Attendance.punch_time <= today_end).delete()
db.commit()
db.close()

print(f"Success: Deleted {count} test attendance records for today.")
