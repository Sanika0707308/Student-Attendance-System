import os
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from config import DB_FILE

# Setup SQLite Database
test_db = os.environ.get("TEST_DB_FILE")
actual_db_file = test_db if test_db else DB_FILE
SQLALCHEMY_DATABASE_URL = f"sqlite:///{actual_db_file}"

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
    standard = Column(String, default="11th")
    is_active = Column(Boolean, default=True)

    # Relationship to attendance logs (cascade ensures records are cleaned up when student is deleted)
    attendances = relationship("Attendance", back_populates="student", cascade="all, delete-orphan")

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
    institute_name = Column(String, default="My Institute")
    # New fields for admin controls and configurable retry window
    admin_retry_all_allowed = Column(Boolean, default=False)
    email_retry_window_hours = Column(Integer, default=24)

class Holiday(Base):
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, unique=True, index=True) # YYYY-MM-DD
    description = Column(String)

def ensure_schema_up_to_date():
    """ 
    Ensures that the database schema is up to date even if an old DB file was imported.
    SQLite doesn't support easy migrations, so we check for column existence manually.
    """
    from sqlalchemy import text
    
    # 1. Create any entirely missing tables (e.g. Holidays) in the imported DB
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # 2. Check for missing columns in existing tables
        # PRAGMA table_info returns rows like: (id, name, type, notnull, dflt_value, pk)
        result = db.execute(text("PRAGMA table_info(settings)"))
        columns = [row[1] for row in result]
        
        if "institute_name" not in columns:
            print("Migration: Adding 'institute_name' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN institute_name VARCHAR DEFAULT 'My Institute'"))
            db.commit()
            print("Migration successful for settings (institute_name).")

        if "admin_retry_all_allowed" not in columns:
            print("Migration: Adding 'admin_retry_all_allowed' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN admin_retry_all_allowed BOOLEAN DEFAULT 0"))
            db.commit()
            print("Migration successful for settings (admin_retry_all_allowed).")

        if "email_retry_window_hours" not in columns:
            print("Migration: Adding 'email_retry_window_hours' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN email_retry_window_hours INTEGER DEFAULT 24"))
            db.commit()
            print("Migration successful for settings (email_retry_window_hours).")

        # 3. Check for missing columns in 'students' table
        result = db.execute(text("PRAGMA table_info(students)"))
        student_columns = [row[1] for row in result]
        
        if "parent_email" not in student_columns:
            print("Migration: Adding 'parent_email' column to 'students' table...")
            db.execute(text("ALTER TABLE students ADD COLUMN parent_email VARCHAR DEFAULT ''"))
            db.commit()
            print("Migration successful for students (parent_email).")
            
        if "is_active" not in student_columns:
            print("Migration: Adding 'is_active' column to 'students' table...")
            db.execute(text("ALTER TABLE students ADD COLUMN is_active BOOLEAN DEFAULT 1"))
            db.commit()
            print("Migration successful for students (is_active).")

        # 4. Check for missing columns in 'attendance' table
        result = db.execute(text("PRAGMA table_info(attendance)"))
        attendance_columns = [row[1] for row in result]
        
        if "email_sent" not in attendance_columns:
            print("Migration: Adding 'email_sent' column to 'attendance' table...")
            db.execute(text("ALTER TABLE attendance ADD COLUMN email_sent BOOLEAN DEFAULT 0"))
            db.commit()
            print("Migration successful for attendance (email_sent).")
            
    except Exception as e:
        print(f"Migration error: {e}")
        db.rollback()
    finally:
        db.close()
    
# Create tables
Base.metadata.create_all(bind=engine)
# Run migration check immediately
ensure_schema_up_to_date()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
