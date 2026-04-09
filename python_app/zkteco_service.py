import threading
import time
from datetime import datetime
import concurrent.futures
from structlog import get_logger
from zk import ZK
from database import SessionLocal, Student, Attendance
from email_service import send_email_notification

logger = get_logger()

# Global Thread Pool for non-blocking email triggers
email_executor = concurrent.futures.ThreadPoolExecutor(max_workers=5)

def _send_email_async(student_id: int, punch_time: datetime, action: str):
    db = SessionLocal()
    try:
        student = db.query(Student).filter(Student.id == student_id).first()
        if student:
            success = send_email_notification(student.name, punch_time, student.parent_email, action)
            att = db.query(Attendance).filter(
                Attendance.student_id == student_id, 
                Attendance.punch_time == punch_time
            ).first()
            if att:
                att.email_sent = success
                db.commit()
    except Exception as e:
        logger.error(f"Async Email Error: {e}")
    finally:
        db.close()

class ZKTecoManager:
    def __init__(self, port=4370):
        self.port = port
        self.conn = None
        self.running = False
        self.thread = None
        self.is_online = False

    def start_polling(self, interval_seconds=10):
        """Starts a background thread to poll the machine for new punches."""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._poll_loop, args=(interval_seconds,), daemon=True)
        self.thread.start()
        logger.info(f"Started polling ZKTeco background thread every {interval_seconds}s")

    def stop_polling(self):
        self.running = False
        if self.thread:
            self.thread.join()
    
    def _poll_loop(self, interval):
        while self.running:
            self._fetch_and_process_attendance()
            time.sleep(interval)

    def _fetch_and_process_attendance(self):
        """Connects, reads real-time logs (or all logs) and processes them."""
        db = SessionLocal()
        try:
            # Get IP Address from Settings
            from database import SystemSettings
            settings = db.query(SystemSettings).first()
            if not settings or not settings.zk_ip_address:
                return # Can't connect without IP
                
            ip_address = settings.zk_ip_address
            zk = ZK(ip_address, port=self.port, timeout=5, password=0, force_udp=False, ommit_ping=False)
            
            # We connect fresh each time to avoid dropping connection issues mid-day
            self.conn = zk.connect()
            self.is_online = True
            
            # Fetch attendance logs directly without locking device (no disable_device call)
            # Using get_attendance() gets all. In a real system we would filter by date.
            attendance_records = self.conn.get_attendance() 
            
            # Example: process today's records
            today = datetime.now().date()
            new_logs_for_today = 0
            
            if attendance_records:
                latest_record = attendance_records[-1]
                # Debug print for first time to see if device time is wrong
                if not hasattr(self, '_time_warned') or self._last_latest_time != latest_record.timestamp:
                    print(f"[ZKTeco Debug] Total Logs: {len(attendance_records)}. Latest log time on device: {latest_record.timestamp}")
                    self._time_warned = True
                    self._last_latest_time = latest_record.timestamp

            for record in attendance_records:
                if record.timestamp.date() == today:
                    new_logs_for_today += 1
                    self._process_single_punch(db, record)
            
            # --- Device Memory Overflow Protection ---
            # Automatically clear ZKTeco device memory once logs exceed safe capacity (e.g. 80,000 logs limit)
            if attendance_records and len(attendance_records) >= 80000:
                logger.warning(f"Device log limit reached ({len(attendance_records)} logs). Auto-clearing device memory...")
                print(f"\n[ZKTeco Debug] Device log limit reached. Auto-clearing attendance logs from device memory...")
                try:
                    self.conn.disable_device()
                    self.conn.clear_attendance()
                    self.conn.enable_device()
                    logger.info("Device memory cleared successfully.")
                    print("[ZKTeco Debug] Device memory cleared successfully.\n")
                except Exception as clear_err:
                    logger.error(f"Failed to clear device memory: {clear_err}")
                    print(f"[ZKTeco Debug] Error clearing device memory: {clear_err}")
                
        except Exception as e:
            self.is_online = False
            logger.error(f"Error polling ZKTeco: {e}")
        finally:
            if self.conn:
                try:
                    self.conn.disconnect()
                except:
                    pass
            db.close()

    def _process_single_punch(self, db, record):
        """Checks if punch exists in database, if not, saves it and sends SMS."""
        zk_id = str(record.user_id)
        punch_time = record.timestamp
        
        # 1. Does this punch already exist in DB?
        existing_log = db.query(Attendance).join(Student).filter(
            Student.zk_id == zk_id,
            Attendance.punch_time == punch_time
        ).first()

        if existing_log:
            return # Already processed

        # 2. Find Student Registration
        student = db.query(Student).filter(Student.zk_id == zk_id).first()
        
        if student:
            # --- 1. Debounce (Double Punch) Protection ---
            # Ignore any punches made within 5 minutes of their last recorded punch
            from datetime import timedelta
            last_punch = db.query(Attendance).filter(
                Attendance.student_id == student.id
            ).order_by(Attendance.punch_time.desc()).first()
            
            if last_punch and (punch_time - last_punch.punch_time) < timedelta(minutes=5):
                logger.info(f"Ignored double-punch for {student.name} at {punch_time} (cooldown active)")
                print(f"[ZKTeco Debug] Ignored double-punch for {student.name} at {punch_time} (cooldown active)")
                return
                
            # --- 2. 4-Interval Time Boundary Logic ---
            from database import SystemSettings
            settings = db.query(SystemSettings).first()
            
            in_time_obj = datetime.strptime("08:00", "%H:%M").time()
            mid_time_obj = datetime.strptime("12:00", "%H:%M").time()
            out_time_obj = datetime.strptime("17:00", "%H:%M").time()
            
            if settings:
                if getattr(settings, 'in_time', None):
                    in_time_obj = datetime.strptime(settings.in_time, "%H:%M").time()
                if getattr(settings, 'mid_time', None):
                    mid_time_obj = datetime.strptime(settings.mid_time, "%H:%M").time()
                if getattr(settings, 'out_time', None):
                    out_time_obj = datetime.strptime(settings.out_time, "%H:%M").time()

            today_date = punch_time.date()
            p_time = punch_time.time()
            
            # --- 2. Two-Half Daily Boundary Logic ---
            # To completely solve Double Punch bugs near boundary lines (like 07:59 and 08:01),
            # we divide the day strictly into TWO halves. A student can only have ONE successful punch per half.
            if p_time < mid_time_obj:
                # FIRST HALF (Morning / Entry)
                half_start = datetime.combine(today_date, datetime.min.time())
                half_end = datetime.combine(today_date, mid_time_obj)
                
                if p_time < in_time_obj:
                    db_status = "Present"
                    action = "पोहोचले आहे"
                else:
                    db_status = "Late"
                    action = "थोडे उशिरा पोहोचले आहे"
            else:
                # SECOND HALF (Afternoon / Exit)
                half_start = datetime.combine(today_date, mid_time_obj)
                half_end = datetime.combine(today_date, datetime.max.time())
                
                if p_time < out_time_obj:
                    db_status = "Left Early"
                    action = "लवकर बाहेर पडले आहे"
                else:
                    db_status = "Left"
                    action = "बाहेर पडले आहे"

            # Check if student already has a stored punch exactly in this Half of the day!
            existing_half_punch = db.query(Attendance).filter(
                Attendance.student_id == student.id,
                Attendance.punch_time >= half_start,
                Attendance.punch_time <= half_end  # Inclusive to catch exactly at mid-time bounds
            ).first()

            if existing_half_punch:
                # SPECIAL CASE: If they were marked "Absent" automatically by the daemon, 
                # but now they are punching, delete the absent record and let the new punch through.
                if existing_half_punch.status == "Absent":
                    db.delete(existing_half_punch)
                    db.commit()
                else:
                    logger.info(f"Ignored punch for {student.name} at {punch_time} (Already logged for this half of the day)")
                    print(f"[ZKTeco Debug] Ignored punch for {student.name} at {punch_time} (Already logged for this half of the day)")
                    return

            # --- 3. Save Record ---
            new_attendance = Attendance(
                student_id=student.id,
                punch_time=punch_time,
                status=db_status
            )
            db.add(new_attendance)
            db.commit()
            
            logger.info(f"New punch recorded: {student.name} at {punch_time} ({action})")
            print(f"[ZKTeco] SUCCESS: Recorded punch for {student.name} at {punch_time} ({db_status})")
            
            # --- 4. Send Email ---
            email_executor.submit(_send_email_async, student.id, punch_time, action)
        else:
            logger.warning(f"Unregistered ZK ID punched: {zk_id}")
            print(f"[ZKTeco Debug] WARNING: Unregistered ZK ID punched: {zk_id}")

        
# Singleton instance to be used by the FastAPI app
zk_manager = ZKTecoManager()
