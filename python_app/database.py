import os
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean, Text
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
    email_failure_reason = Column(String, nullable=True)
    email_retry_count = Column(Integer, default=0)
    # True when an administrator created or edited this row by hand rather than
    # it arriving from the ZKTeco device. Shown as a badge in the UI so that
    # corrections stay auditable.
    is_manual = Column(Boolean, default=False)

    student = relationship("Student", back_populates="attendances")


class AdminUser(Base):
    """Local administrator account used to sign in to the desktop app."""
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String, default="")
    # Set on the seeded admin/admin account so the UI can nag until it is changed.
    must_change_password = Column(Boolean, default=False)

class SystemSettings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    zk_ip_address = Column(String, default="192.168.1.100")
    smtp_email = Column(String, default="")
    smtp_password = Column(String, default="")
    in_time = Column(String, default="08:30")
    mid_time = Column(String, default="12:00")
    out_time = Column(String, default="15:00")
    institute_name = Column(String, default="Biometric Attendance")
    # Comma-separated list of the classes this institute runs. Drives every
    # standard dropdown in the UI and holiday validation, so it is configurable
    # rather than the hardcoded 11th/12th pair the app shipped with.
    standards = Column(String, default="11th,12th")
    # New fields for admin controls and configurable retry window
    admin_retry_all_allowed = Column(Boolean, default=False)
    email_retry_window_hours = Column(Integer, default=24)
    # Customizable attendance status messages
    msg_present = Column(String, default="आला/आली आहे (Present)")
    msg_late = Column(String, default="उशिरा आला/आली आहे (Late Comer)")
    msg_absent = Column(String, default="गैरहजर आहे (Absent)")
    msg_left_early = Column(String, default="लवकर गेला/गेली आहे (Left Early)")
    msg_left = Column(String, default="गेला/गेली आहे (Left)")
    # Full parent-notification templates. The msg_* fields above only ever
    # controlled five words in the middle of a hardcoded body; these hold the
    # entire subject and body per status, with {placeholders} filled at send
    # time. Defaults reproduce the 1.9 wording exactly, so upgrading changes
    # nothing about what parents receive until an administrator edits them.
    email_subject = Column(Text, default="")
    tpl_present = Column(Text, default="")
    tpl_late = Column(Text, default="")
    tpl_absent = Column(Text, default="")
    tpl_left_early = Column(Text, default="")
    tpl_left = Column(Text, default="")
    # UI language for the desktop app: "en" or "mr". Stored server-side as the
    # institute-wide default; the sidebar toggle also mirrors it into
    # localStorage so a reload never flashes the wrong language.
    ui_language = Column(String, default="en")

class Holiday(Base):
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, index=True) # YYYY-MM-DD
    description = Column(String)
    standard = Column(String, default="All", index=True)


DEFAULT_STANDARDS = ["11th", "12th"]


def get_configured_standards(db) -> list:
    """
    Return the institute's class list from settings, falling back to the
    original 11th/12th pair when unset. Used by every standard dropdown and by
    holiday validation so there is a single source of truth.
    """
    try:
        settings = db.query(SystemSettings).first()
        raw = (getattr(settings, "standards", None) or "") if settings else ""
        parsed = [s.strip() for s in raw.split(",") if s.strip()]
        return parsed or list(DEFAULT_STANDARDS)
    except Exception:
        return list(DEFAULT_STANDARDS)


def is_holiday_for_standard(db, holiday_date, standard: str) -> bool:
    """Return whether a date is a holiday for this standard or for all students."""
    date_value = holiday_date.isoformat() if hasattr(holiday_date, "isoformat") else str(holiday_date)
    student_standard = (standard or "11th").strip()
    return db.query(Holiday.id).filter(
        Holiday.date == date_value,
        Holiday.standard.in_(("All", student_standard))
    ).first() is not None

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
            db.execute(text("ALTER TABLE settings ADD COLUMN institute_name VARCHAR DEFAULT 'Biometric Attendance'"))
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

        if "standards" not in columns:
            print("Migration: Adding 'standards' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN standards VARCHAR DEFAULT '11th,12th'"))
            db.commit()
            print("Migration successful for settings (standards).")

        # Add custom message fields if missing
        if "msg_present" not in columns:
            print("Migration: Adding 'msg_present' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN msg_present VARCHAR DEFAULT 'आला/आली आहे (Present)'"))
            db.commit()
        if "msg_late" not in columns:
            print("Migration: Adding 'msg_late' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN msg_late VARCHAR DEFAULT 'उशिरा आला/आली आहे (Late Comer)'"))
            db.commit()
        if "msg_absent" not in columns:
            print("Migration: Adding 'msg_absent' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN msg_absent VARCHAR DEFAULT 'गैरहजर आहे (Absent)'"))
            db.commit()
        if "msg_left_early" not in columns:
            print("Migration: Adding 'msg_left_early' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN msg_left_early VARCHAR DEFAULT 'लवकर गेला/गेली आहे (Left Early)'"))
            db.commit()
        if "msg_left" not in columns:
            print("Migration: Adding 'msg_left' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN msg_left VARCHAR DEFAULT 'गेला/गेली आहे (Left)'"))
            db.commit()

        # Full-body notification templates and the UI language. All default to
        # an empty string rather than to the template text: an empty value means
        # "use the shipped default", so a later change to the default wording
        # reaches installations that never customised it, and there is no
        # Devanagari literal to escape inside a DDL statement.
        for template_column in ("email_subject", "tpl_present", "tpl_late",
                                "tpl_absent", "tpl_left_early", "tpl_left"):
            if template_column not in columns:
                print(f"Migration: Adding '{template_column}' column to 'settings' table...")
                db.execute(text(f"ALTER TABLE settings ADD COLUMN {template_column} TEXT DEFAULT ''"))
                db.commit()

        if "ui_language" not in columns:
            print("Migration: Adding 'ui_language' column to 'settings' table...")
            db.execute(text("ALTER TABLE settings ADD COLUMN ui_language VARCHAR DEFAULT 'en'"))
            db.commit()
            print("Migration successful for settings (ui_language).")

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

        # Check for missing columns in 'holidays' table
        result = db.execute(text("PRAGMA table_info(holidays)"))
        holiday_columns = [row[1] for row in result]

        if "standard" not in holiday_columns:
            print("Migration: Adding 'standard' column to 'holidays' table...")
            db.execute(text("ALTER TABLE holidays ADD COLUMN standard VARCHAR DEFAULT 'All'"))
            # Drop old unique index if it exists, and recreate it as a non-unique index
            try:
                db.execute(text("DROP INDEX IF EXISTS ix_holidays_date"))
            except Exception as index_err:
                print(f"Index drop error: {index_err}")
            
            try:
                db.execute(text("CREATE INDEX IF NOT EXISTS ix_holidays_date ON holidays (date)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS ix_holidays_standard ON holidays (standard)"))
            except Exception as index_err:
                print(f"Index creation error: {index_err}")
            db.commit()
            print("Migration successful for holidays (standard).")

        # 4. Check for missing columns in 'attendance' table
        result = db.execute(text("PRAGMA table_info(attendance)"))
        attendance_columns = [row[1] for row in result]
        
        if "email_sent" not in attendance_columns:
            print("Migration: Adding 'email_sent' column to 'attendance' table...")
            db.execute(text("ALTER TABLE attendance ADD COLUMN email_sent BOOLEAN DEFAULT 0"))
            db.commit()
            print("Migration successful for attendance (email_sent).")
            
        if "email_failure_reason" not in attendance_columns:
            print("Migration: Adding 'email_failure_reason' column to 'attendance' table...")
            db.execute(text("ALTER TABLE attendance ADD COLUMN email_failure_reason VARCHAR DEFAULT NULL"))
            db.commit()
            print("Migration successful for attendance (email_failure_reason).")

        if "email_retry_count" not in attendance_columns:
            print("Migration: Adding 'email_retry_count' column to 'attendance' table...")
            db.execute(text("ALTER TABLE attendance ADD COLUMN email_retry_count INTEGER DEFAULT 0"))
            db.commit()
            print("Migration successful for attendance (email_retry_count).")

        if "is_manual" not in attendance_columns:
            print("Migration: Adding 'is_manual' column to 'attendance' table...")
            db.execute(text("ALTER TABLE attendance ADD COLUMN is_manual BOOLEAN DEFAULT 0"))
            db.commit()
            print("Migration successful for attendance (is_manual).")

        # 5. Seed the local administrator account.
        # Upgrades from 1.9 (where the admin/admin check lived in JavaScript) land
        # here and get the same credentials back, flagged so the UI prompts for a
        # change instead of silently locking anybody out.
        from auth import hash_password
        if db.query(AdminUser).count() == 0:
            print("Migration: Seeding default admin account (admin/admin)...")
            db.add(AdminUser(
                username="admin",
                password_hash=hash_password("admin"),
                must_change_password=True,
            ))
            db.commit()
            print("Migration successful (default admin seeded).")

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
