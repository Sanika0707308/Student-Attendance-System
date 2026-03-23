import os
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

# Setup SQLite Database
DB_FILE = os.path.join(os.path.dirname(__file__), "attendance.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_FILE}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    zk_id = Column(String, unique=True, index=True) # ID inside the ZKTeco Machine
    parent_email = Column(String) # Replaced parent_phone with parent_email

    # Relationship to attendance logs
    attendances = relationship("Attendance", back_populates="student")

class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    punch_time = Column(DateTime, index=True)
    status = Column(String, default="Present")
    email_sent = Column(Boolean, default=False) # Replaced sms_sent with email_sent

    student = relationship("Student", back_populates="attendances")

class SystemSettings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    zk_ip_address = Column(String, default="192.168.1.100")
    smtp_email = Column(String, default="")
    smtp_password = Column(String, default="")
    in_time = Column(String, default="08:30")
    mid_time = Column(String, default="12:00")
    out_time = Column(String, default="15:00")
    
# Create tables
Base.metadata.create_all(bind=engine)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
