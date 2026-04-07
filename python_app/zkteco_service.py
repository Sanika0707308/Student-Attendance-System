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

        self._time_warned = False
        self._last_latest_time = None

    def start_polling(self, interval_seconds=10):
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
        db = SessionLocal()
        try:
            from database import SystemSettings
            settings = db.query(SystemSettings).first()
            if not settings or not settings.zk_ip_address:
                return
                
            ip_address = settings.zk_ip_address
            zk = ZK(ip_address, port=self.port, timeout=5, password=0, force_udp=False, ommit_ping=False)
            
            self.conn = zk.connect()
            self.is_online = True
            
            attendance_records = self.conn.get_attendance() 
            
            # --- AUTO TIME SYNC ---
            if self.conn:
                try:
                    device_time = self.conn.get_time()
                    server_time = datetime.now()
                    drift_seconds = abs((server_time - device_time).total_seconds())
                    
                    if drift_seconds > 60:
                        logger.info(f"Time drift detected ({drift_seconds}s). Syncing ZKTeco machine with server time...")
                        print(f"[ZKTeco] Syncing machine time: {device_time} -> {server_time}")
                        self.conn.set_time(server_time)
                except Exception as time_err:
                    logger.warning(f"Failed to sync time: {time_err}")

            today = datetime.now().date()
            new_logs_for_today = 0
            
            if attendance_records:
                latest_record = attendance_records[-1]
                if self._last_latest_time != latest_record.timestamp:
                    print(f"[ZKTeco Debug] Total Logs: {len(attendance_records)}. Latest log time on device: {latest_record.timestamp}")
                    self._last_latest_time = latest_record.timestamp

                for record in attendance_records:
                    if record.timestamp.date() == today:
                        new_logs_for_today += 1
                        self._process_single_punch(db, record)

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
        zk_id = str(record.user_id)
        punch_time = record.timestamp
        
        existing_log = db.query(Attendance).join(Student).filter(
            Student.zk_id == zk_id,
            Attendance.punch_time == punch_time
        ).first()

        if existing_log:
            return

        student = db.query(Student).filter(Student.zk_id == zk_id).first()
        
        if student:
            from datetime import timedelta
            last_punch = db.query(Attendance).filter(
                Attendance.student_id == student.id
            ).order_by(Attendance.punch_time.desc()).first()
            
            if last_punch and (punch_time - last_punch.punch_time) < timedelta(minutes=5):
                logger.info(f"Ignored double-punch for {student.name} at {punch_time}")
                return
                
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
            
            if p_time < in_time_obj:    
                interval_start = datetime.combine(today_date, datetime.min.time())
                interval_end = datetime.combine(today_date, in_time_obj)
                db_status = "Present"
                action = "पोहोचले आहे"
            elif p_time < mid_time_obj: 
                interval_start = datetime.combine(today_date, in_time_obj)
                interval_end = datetime.combine(today_date, mid_time_obj)
                db_status = "Late"
                action = "थोडे उशिरा पोहोचले आहे"
            elif p_time < out_time_obj: 
                interval_start = datetime.combine(today_date, mid_time_obj)
                interval_end = datetime.combine(today_date, out_time_obj)
                db_status = "Left Early"
                action = "लवकर बाहेर पडले आहे"
            else:                       
                interval_start = datetime.combine(today_date, out_time_obj)
                interval_end = datetime.combine(today_date, datetime.max.time())
                db_status = "Left"
                action = "बाहेर पडले आहे"

            existing_interval_punch = db.query(Attendance).filter(
                Attendance.student_id == student.id,
                Attendance.punch_time >= interval_start,
                Attendance.punch_time < interval_end
            ).first()

            if existing_interval_punch:
                if existing_interval_punch.status == "Absent":
                    db.delete(existing_interval_punch)
                    db.commit()
                else:
                    return

            new_attendance = Attendance(
                student_id=student.id,
                punch_time=punch_time,
                status=db_status
            )
            db.add(new_attendance)
            db.commit()
            
            logger.info(f"New punch recorded: {student.name} at {punch_time}")
            
            email_executor.submit(_send_email_async, student.id, punch_time, action)
        else:
            logger.warning(f"Unregistered ZK ID punched: {zk_id}")

# Singleton instance
zk_manager = ZKTecoManager()