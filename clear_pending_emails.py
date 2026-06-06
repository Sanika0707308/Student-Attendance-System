import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'python_app', 'attendance.db')

def clear_emails():
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check how many are pending
        cursor.execute("SELECT count(*) FROM attendance WHERE email_sent = 0")
        count = cursor.fetchone()[0]
        
        print(f"Found {count} pending/failed emails in the database.")
        
        if count > 0:
            cursor.execute("UPDATE attendance SET email_sent = 1 WHERE email_sent = 0")
            conn.commit()
            print(f"Successfully marked {count} emails as sent. The queue is now cleared!")
        else:
            print("No pending emails found in the database.")
            
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == '__main__':
    clear_emails()
