import smtplib
from email.message import EmailMessage
import sqlite3
import time
from datetime import datetime
from zk import ZK, const

# --- Configuration ---
# Device Information
ZK_IP = '10.216.67.177'  
ZK_PORT = 4370

# Email Server Settings
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_SENDER = "your_school_email@gmail.com"
EMAIL_PASSWORD = "your_app_password"

# --- Database Setup (SQLite for Demonstration) ---
# You can replace this with MySQL (using mysql.connector) or PostgreSQL (using psycopg2)
DB_FILE = "attendance.db"

def setup_database():
    """Initializes the database tables if they do not exist."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Create Students table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_email TEXT NOT NULL
        )
    ''')
    
    # Create Attendance table to store the punches
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS attendance_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT,
            punch_time DATETIME,
            FOREIGN KEY(student_id) REFERENCES students(id)
        )
    ''')
    
    # Insert some mock students for testing if table is empty
    cursor.execute("SELECT COUNT(*) FROM students")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO students (id, name, parent_email) VALUES ('1', 'John Doe', 'parent1@example.com')")
        cursor.execute("INSERT INTO students (id, name, parent_email) VALUES ('2', 'Jane Smith', 'parent2@example.com')")
        conn.commit()
        
    conn.close()

def log_punch_to_db(user_id, timestamp):
    """Inserts the real-time punch record into the database."""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Insert the attendance log
        cursor.execute(
            "INSERT INTO attendance_logs (student_id, punch_time) VALUES (?, ?)", 
            (user_id, timestamp)
        )
        conn.commit()
        print(f"[{timestamp}] Successfully stored punch for User {user_id} in Database.")
        
        # Look up the student details to send the email
        cursor.execute("SELECT name, parent_email FROM students WHERE id = ?", (user_id,))
        student = cursor.fetchone()
        
        conn.close()
        return student # Returns (name, email) or None
    except Exception as e:
        print(f"Database error: {e}")
        return None

def send_email_alert(student_name, parent_email, punch_time):
    """Sends an email notification to the parent using SMTP."""
    msg = EmailMessage()
    msg.set_content(
        f"Dear Parent,\n\n"
        f"This is an automated notification. Your child, {student_name}, "
        f"has successfully punched in at {punch_time}.\n\n"
        f"Best Regards,\n"
        f"School Administration"
    )
    
    msg['Subject'] = f"Attendance Alert: {student_name} Punched In"
    msg['From'] = EMAIL_SENDER
    msg['To'] = parent_email

    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"[{punch_time}] Email sent to {parent_email} based on DB record.")
    except Exception as e:
        print(f"[{punch_time}] Failed to send email to {parent_email}. Error: {e}")

def main():
    setup_database()
    print("Database initialized.")
    
    print(f"Connecting to ZKTeco device at {ZK_IP}:{ZK_PORT}...")
    zk = ZK(ZK_IP, port=ZK_PORT, timeout=5, password=0, force_udp=False, ommit_ping=False)
    
    try:
        conn = zk.connect()
        print("Connected! Listening for live punches...")
        
        # listen for live events
        for attendance in conn.live_capture():
            if attendance is None:
                continue
            
            user_id = str(attendance.user_id)
            timestamp = attendance.timestamp
            print(f"\n--- New Punch Detected ---")
            
            # 1. Log to Database and fetch student info
            student_info = log_punch_to_db(user_id, timestamp)
            
            # 2. Trigger Email if student is found in the database
            if student_info:
                student_name, parent_email = student_info
                send_email_alert(student_name, parent_email, timestamp)
            else:
                print(f"User ID {user_id} not found in the Students table. Email skipped.")
                
    except Exception as e:
        print(f"Process terminated: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.disconnect()
            print("Disconnected from device.")

if __name__ == "__main__":
    main()
