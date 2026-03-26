import threading
import time
from datetime import datetime
from structlog import get_logger
from database import SessionLocal, Student, Attendance, SystemSettings
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
            
            # Note: We only trigger the automatic absent flag if the current time has passed the boundary.
            if now.time() >= mid_time_obj:
                today_start = datetime.combine(now.date(), datetime.min.time())
                today_end = datetime.combine(now.date(), datetime.max.time())
                
                students = db.query(Student).all()
                for student in students:
                    # Check if the student has ANY record (Present or already marked Absent) for today
                    has_record = db.query(Attendance).filter(
                        Attendance.student_id == student.id,
                        Attendance.punch_time >= today_start,
                        Attendance.punch_time <= today_end
                    ).first()
                    
                    if not has_record:
                        # 1. Create the Absence Record so they aren't processed twice
                        absence_punch = datetime.combine(now.date(), mid_time_obj) # Assign punch at exact deadline limit
                        new_attendance = Attendance(
                            student_id=student.id,
                            punch_time=absence_punch,
                            status="Absent"
                        )
                        db.add(new_attendance)
                        db.commit()
                        
                        logger.info(f"Time-bound deadline met. Marked automated ABSENT for: {student.name}")
                        
                        # 2. Fire Asynchronous 'Absent' Email
                        action = "गैरहजर असल्याचे आढळले आहे"
                        email_executor.submit(_send_email_async, student.id, absence_punch, action)
                        
        finally:
            db.close()

# Singleton
time_bound_manager = TimeBoundManager()
