import threading
import time
from datetime import datetime
import concurrent.futures
from zk import ZK
from database import SessionLocal, Student, Attendance, is_holiday_for_standard
from email_service import send_email_notification
from message_templates import STATUS_FIELDS, status_phrase_for_status

import structlog
import logging
from logging.handlers import RotatingFileHandler

# Configure logging to both console and file
from config import LOG_FILE
# encoding must be explicit: punch handling below logs Marathi status strings,
# and Windows defaults this handler to cp1252, which raises UnicodeEncodeError
# on Devanagari and would take down the polling thread mid-write.
handler = RotatingFileHandler(
    LOG_FILE, maxBytes=10*1024*1024, backupCount=5,
    encoding="utf-8", errors="replace"
)
logging.basicConfig(
    format="%(message)s",
    level=logging.INFO,
    # No StreamHandler: main.py points sys.stderr at console.log, so adding one
    # would write every structlog record into that file a second time.
    handlers=[handler]
)

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = structlog.get_logger()

import queue
import smtplib
from sqlalchemy.orm import joinedload
from crypto_utils import decrypt_password
from database import SystemSettings

# Queue to serialize and batch email sending requests
email_signal_queue = queue.Queue()

# Global Thread Pool (kept as a single-threaded queue for compatibility)
email_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

def _send_email_async(attendance_id: int):
    """
    Signals the background sequential worker to process a specific unsent email immediately.
    """
    email_signal_queue.put(attendance_id)

def process_unsent_emails_batch(log_ids: list = None):
    """
    Finds and sends all unsent emails in a single serial batch, reusing one SMTP connection.
    If log_ids is provided, limits the batch to those specific attendance record IDs.
    """
    db = SessionLocal()
    shared_smtp = None
    try:
        # 1. Fetch system settings
        settings = db.query(SystemSettings).first()
        if not settings or not settings.smtp_email or not settings.smtp_password:
            logger.error("SMTP Settings are missing. Cannot run email batch.")
            # Record SMTP settings missing failure reason in DB
            query = db.query(Attendance).filter(Attendance.email_sent.isnot(True))
            if log_ids is not None:
                query = query.filter(Attendance.id.in_(log_ids))
            
            # Restrict to configured window (default 24h) if log_ids is None
            if log_ids is None:
                window_hours = getattr(settings, "email_retry_window_hours", 24) or 24
                from datetime import timedelta
                cutoff = datetime.now() - timedelta(hours=window_hours)
                query = query.filter(Attendance.punch_time >= cutoff)
            
            for att in query.all():
                att.email_failure_reason = "SMTP Settings are missing"
            db.commit()
            return

        # 2. Query logs to send
        query = db.query(Attendance).options(joinedload(Attendance.student)).filter(
            Attendance.email_sent.isnot(True)
        )
        if log_ids is not None:
            query = query.filter(Attendance.id.in_(log_ids))
        
        # Restrict to configured window (default 24h) if log_ids is None
        if log_ids is None:
            window_hours = getattr(settings, "email_retry_window_hours", 24) or 24
            from datetime import timedelta
            cutoff = datetime.now() - timedelta(hours=window_hours)
            query = query.filter(Attendance.punch_time >= cutoff)
        
        logs = query.all()
        if not logs:
            return

        # 3. Helper to establish SMTP connection
        def get_smtp_conn():
            conn = smtplib.SMTP("smtp.gmail.com", 587, timeout=30)
            conn.starttls()
            conn.login(settings.smtp_email, decrypt_password(settings.smtp_password))
            return conn

        # 4. Open SMTP Connection
        try:
            shared_smtp = get_smtp_conn()
        except smtplib.SMTPAuthenticationError as auth_err:
            err_msg = f"SMTP authentication failed: {auth_err.smtp_error.decode('utf-8') if isinstance(auth_err.smtp_error, bytes) else auth_err.smtp_error}"
            logger.error(err_msg)
            # Mark all targeted emails as failed with this connection error immediately
            for log in logs:
                log.email_failure_reason = err_msg
            db.commit()
            return
        except smtplib.SMTPConnectError as conn_err:
            err_msg = f"Connection timeout: {str(conn_err)}"
            logger.error(err_msg)
            for log in logs:
                log.email_failure_reason = err_msg
            db.commit()
            return
        except Exception as smtp_err:
            err_msg = f"Network error: {str(smtp_err)}"
            logger.error(err_msg)
            # Mark all targeted emails as failed with this connection error immediately
            for log in logs:
                log.email_failure_reason = err_msg
            db.commit()
            return

        # Short status phrases, sourced from one place so the send path and the
        # Settings preview always agree on what {status} expands to.
        status_messages = {
            status: status_phrase_for_status(settings, status)
            for status in STATUS_FIELDS
        }

        # 5. Process emails in loop
        for log in logs:
            student = log.student
            if not student or not student.parent_email:
                log.email_sent = True # Auto-mark so it doesn't get stuck if there's no email address
                log.email_failure_reason = "No parent email configured"
                db.commit()
                continue

            action_str = status_messages.get(log.status, log.status)
            
            # Send notification
            success, err_reason = send_email_notification(
                student.name, log.punch_time, student.parent_email, action_str,
                smtp_server=shared_smtp, status=log.status, standard=student.standard
            )

            if not success:
                # Connection might have dropped. Try to reconnect once if error looks like connection close.
                is_connection_error = any(kw in err_reason.lower() for kw in [
                    "closed", "broken pipe", "connection", "winerror", "timeout", "smtpconnecterror"
                ])
                if is_connection_error:
                    logger.warning(f"SMTP connection issue detected: {err_reason}. Attempting reconnection...")
                    try:
                        if shared_smtp:
                            try:
                                shared_smtp.quit()
                            except:
                                pass
                        shared_smtp = get_smtp_conn()
                        # Retry sending
                        success, err_reason = send_email_notification(
                            student.name, log.punch_time, student.parent_email, action_str,
                            smtp_server=shared_smtp, status=log.status, standard=student.standard
                        )
                    except smtplib.SMTPAuthenticationError as auth_err:
                        reconnect_msg = f"SMTP authentication failed: {auth_err.smtp_error.decode('utf-8') if isinstance(auth_err.smtp_error, bytes) else auth_err.smtp_error}"
                        logger.error(reconnect_msg)
                        shared_smtp = None
                        log.email_failure_reason = reconnect_msg
                        db.commit()
                        break
                    except Exception as reconnect_err:
                        reconnect_msg = f"SMTP reconnection failed: {reconnect_err}"
                        logger.error(reconnect_msg)
                        shared_smtp = None
                        # We lost the SMTP server completely.
                        # Abort batch processing immediately to avoid long timeouts on remaining emails.
                        log.email_failure_reason = reconnect_msg
                        db.commit()
                        break
                
            if success:
                log.email_sent = True
                log.email_failure_reason = None
            else:
                log.email_failure_reason = err_reason
            
            db.commit()
            
            # Sleep briefly to avoid triggering Gmail spam limits
            time.sleep(1.0)
            
    except Exception as e:
        logger.error(f"Error in process_unsent_emails_batch: {e}")
    finally:
        if shared_smtp:
            try:
                shared_smtp.quit()
            except:
                pass
        db.close()

def email_queue_worker():
    """Background worker thread that serializes email sending tasks."""
    logger.info("Email queue worker thread started.")
    while True:
        try:
            # Block until a signal is received
            signal = email_signal_queue.get()
            if signal is None:
                # Sentinel to stop thread
                email_signal_queue.task_done()
                break
            
            # Start a list of log IDs to process
            log_ids = []
            process_all = False
            if isinstance(signal, int):
                log_ids.append(signal)
            else:
                process_all = True
            
            # Drain queue safely
            try:
                while True:
                    next_item = email_signal_queue.get_nowait()
                    if next_item is None:
                        # Put sentinel back so loop can exit normally on next cycle
                        email_signal_queue.put(None)
                        break
                    elif isinstance(next_item, int):
                        log_ids.append(next_item)
                    else:
                        process_all = True
                    email_signal_queue.task_done()
            except queue.Empty:
                pass
            
            if process_all:
                process_unsent_emails_batch(log_ids=None)
            elif log_ids:
                process_unsent_emails_batch(log_ids=log_ids)
                
            email_signal_queue.task_done()
        except Exception as e:
            logger.error(f"Error in email queue worker: {e}")
        time.sleep(0.1) # Small cooldown

class ZKTecoManager:
    def __init__(self, port=4370):
        self.port = port
        self.conn = None
        self.running = False
        self.thread = None
        self.is_online = False
        self.email_worker_thread = None

    def start_polling(self, interval_seconds=10):
        """Starts background threads for ZKTeco polling and Email queue worker."""
        if self.running:
            return
        
        self.running = True
        
        # Start ZKTeco polling thread
        self.thread = threading.Thread(target=self._poll_loop, args=(interval_seconds,), daemon=True)
        self.thread.start()
        logger.info(f"Started polling ZKTeco background thread every {interval_seconds}s")
        
        # Start Email queue worker thread
        self.email_worker_thread = threading.Thread(target=email_queue_worker, daemon=True)
        self.email_worker_thread.start()

    def stop_polling(self):
        self.running = False
        if self.thread:
            self.thread.join()
        
        # Stop email worker thread by pushing None sentinel
        email_signal_queue.put(None)
        if self.email_worker_thread:
            try:
                self.email_worker_thread.join(timeout=2)
            except Exception:
                pass
    
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
            zk = ZK(ip_address, port=self.port, timeout=5, password=0, force_udp=False, ommit_ping=True)
            
            # We connect fresh each time to avoid dropping connection issues mid-day
            self.conn = zk.connect()
            self.is_online = True
            
            # Fetch attendance logs directly without locking device (no disable_device call)
            # Using get_attendance() gets all. In a real system we would filter by date.
            attendance_records = self.conn.get_attendance() 
            
            # --- PERFORMANCE OPTIMIZATION ---
            # Instead of looping through all logs (e.g. 50,000) every 10s, 
            # we reverse the list and stop as soon as we hit a record that is NOT from today.
            today = datetime.now().date()
            
            if attendance_records:
                # 1. Check for Device Time Mismatch (Accuracy Fix)
                device_time = attendance_records[-1].timestamp
                server_time = datetime.now()
                time_diff = abs((server_time - device_time).total_seconds())
                
                if time_diff > 300: # 5 minutes threshold
                    logger.warning(f"TIME MISMATCH: Device time ({device_time}) differs from Server time ({server_time}) by {int(time_diff/60)} mins!")
                    print(f"[ZKTeco Warning] Device clock is off by {int(time_diff/60)} minutes. Attendance might be recorded on wrong dates!")

                # 2. Process records efficiently while preventing offline data loss
                from datetime import timedelta
                # We process ALL logs from the last 5 days. 
                # The DB existing_log check is extremely fast and will safely ignore duplicates.
                # This guarantees we NEVER miss an offline punch, even if the app was restarted.
                cutoff_time = datetime.now() - timedelta(days=5)

                # Reverse the records to see most recent first. 
                for record in reversed(attendance_records):
                    if record.timestamp >= cutoff_time:
                        self._process_single_punch(db, record)
                    else:
                        # Once we hit records older than 5 days, safely break to save CPU
                        break
            
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
            # A biometric device may still contain a punch on a holiday, but it
            # must not create a local attendance record, email, or status update.
            # "All" applies to both standards; a class holiday applies only to
            # that class (for example 11th can be off while 12th is processed).
            if is_holiday_for_standard(db, punch_time.date(), student.standard):
                logger.info(
                    f"Ignored holiday punch for {student.name} ({student.standard or '11th'}) at {punch_time}"
                )
                return

            # --- 1. Debounce (Double Punch) Protection ---
            # Ignore any punches made within 5 minutes of their last recorded punch
            from datetime import timedelta
            last_punch = db.query(Attendance).filter(
                Attendance.student_id == student.id
            ).order_by(Attendance.punch_time.desc()).first()
            
            if last_punch and abs((punch_time - last_punch.punch_time).total_seconds()) < 300:
                logger.info(f"Ignored double-punch for {student.name} at {punch_time} (cooldown active)")
                print(f"[ZKTeco Debug] Ignored double-punch for {student.name} at {punch_time} (cooldown active)")
                return
                
            # --- 2. 4-Interval Time Boundary Logic ---
            from database import SystemSettings
            settings = db.query(SystemSettings).first()
            
            in_time_obj = datetime.strptime("08:30", "%H:%M").time()
            mid_time_obj = datetime.strptime("12:00", "%H:%M").time()
            out_time_obj = datetime.strptime("15:00", "%H:%M").time()
            
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
            email_executor.submit(_send_email_async, new_attendance.id)
        else:
            logger.warning(f"Unregistered ZK ID punched: {zk_id}")
            print(f"[ZKTeco Debug] WARNING: Unregistered ZK ID punched: {zk_id}")

        
# Singleton instance to be used by the FastAPI app
zk_manager = ZKTecoManager()
