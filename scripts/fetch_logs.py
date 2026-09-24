
from zk import ZK
import os
import sys

# Add the python_app directory to the path so we can import from it
sys.path.append(os.path.join(os.getcwd(), 'python_app'))
from database import SessionLocal, SystemSettings

def fetch_device_logs():
    db = SessionLocal()
    settings = db.query(SystemSettings).first()
    ip = settings.zk_ip_address
    db.close()
    
    print(f"Connecting to {ip}...")
    zk = ZK(ip, port=4370, timeout=10)
    conn = None
    try:
        conn = zk.connect()
        print("Connected! Fetching logs...")
        logs = conn.get_attendance()
        print(f"Total logs: {len(logs)}")
        if logs:
            print("Latest 5 logs on device:")
            for log in logs[-5:]:
                print(f" - UserID: {log.user_id}, Time: {log.timestamp}, Status: {log.status}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if conn:
            conn.disconnect()

if __name__ == "__main__":
    fetch_device_logs()
