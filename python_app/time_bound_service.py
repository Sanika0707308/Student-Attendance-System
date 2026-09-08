import threading
import time
from datetime import datetime
from structlog import get_logger
from database import SessionLocal, Student, Attendance, SystemSettings, Holiday
from zkteco_service import email_executor, _send_email_async

logger = get_logger()

class TimeBoundManager:
    def __init__(self):
        self.running = False
        self.thread = None

    def start_scheduler(self):
        """Starts a background thread to check for time-bound absence marking."""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._schedule_loop, daemon=True)
        self.thread.start()
        logger.info("Started time-bound Absence worker.")

    def stop_scheduler(self):
        self.running = False
        if self.thread:
            self.thread.join()
            
    def _schedule_loop(self):
        while self.running:
            try:
                self._check_absences()
            except Exception as e:
                logger.error(f"Error checking absences: {e}")
                
            # Sleep for exactly 1 minute before checking again
            time.sleep(60)
            
    def _check_absences(self):
        db = SessionLocal()
        try:
            settings = db.query(SystemSettings).first()
            if not settings or not settings.in_time:
                return # Can't execute without IN time configured

            mid_time_obj = datetime.strptime(settings.mid_time, "%H:%M").time()
            now = datetime.now()

            # A holiday can cover every student (All) or only 11th/12th. This also
            # applies on Sundays: the configured class is the source of truth.
            today_str = now.strftime("%Y-%m-%d")
            holidays_today = db.query(Holiday).filter(Holiday.date == today_str).all()
            
            holiday_standards = set()
            has_global_holiday = False
            for h in holidays_today:
                standard = getattr(h, "standard", "All") or "All"
                if standard == "All":
                    has_global_holiday = True
                else:
                    holiday_standards.add(standard)

            # Do not create any absences for a global holiday. For a class-specific
            # holiday, exclude only that class below and process the other class normally.
            if now.time() >= mid_time_obj and not has_global_holiday:
                today_start = datetime.combine(now.date(), datetime.min.time())
                today_end = datetime.combine(now.date(), datetime.max.time())

                # --- BULK OPTIMIZATION ---
                # Step 1: Get the IDs of all students who ALREADY have a record today (Present, Late, Absent, etc.)
                # This is a single fast subquery instead of N individual queries.
                from sqlalchemy import select
                students_with_record_today = db.execute(
                    select(Attendance.student_id).where(
                        Attendance.punch_time >= today_start,
                        Attendance.punch_time <= today_end
                    )
                ).scalars().all()
                ids_with_record = set(students_with_record_today)

                # Step 2: Get all active students whose ID is NOT in the above set
                # and whose standard is not on holiday today.
                students_missing_today_query = db.query(Student).filter(
                    Student.is_active == True,
                    ~Student.id.in_(ids_with_record)
                )
                if holiday_standards:
                    from sqlalchemy import func
                    students_missing_today_query = students_missing_today_query.filter(
                        ~func.coalesce(Student.standard, "11th").in_(list(holiday_standards))
                    )
                students_missing_today = students_missing_today_query.all()

                if not students_missing_today:
                    return # Everyone is accounted for, nothing to do

                # Step 3: Bulk create absence records in one shot
                absence_punch = datetime.combine(now.date(), mid_time_obj)
                new_absences = [
                    Attendance(
                        student_id=student.id,
                        punch_time=absence_punch,
                        status="Absent"
                    )
                    for student in students_missing_today
                ]
                db.add_all(new_absences)
                db.commit() # Single commit for all records

                # Step 4: Fire async emails for all newly absent students
                for att in new_absences:
                    logger.info(f"Time-bound deadline met. Marked automated ABSENT for student ID: {att.student_id}")
                    email_executor.submit(_send_email_async, att.id)

        finally:
            db.close()

# Singleton
time_bound_manager = TimeBoundManager()
