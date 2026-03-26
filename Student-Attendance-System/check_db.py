
import sys
import os

# Add the python_app directory to the path so we can import from it
sys.path.append(os.path.join(os.getcwd(), 'python_app'))

from database import SessionLocal, Student, SystemSettings

def check_setup():
    db = SessionLocal()
    try:
        settings = db.query(SystemSettings).first()
        if settings:
            print("--- System Settings ---")
            print(f"ZK IP Address: {settings.zk_ip_address}")
            print(f"In-Time: {settings.in_time}")
            print(f"Mid-Time: {settings.mid_time}")
            print(f"Out-Time: {settings.out_time}")
            print(f"SMTP Email: {settings.smtp_email}")
        else:
            print("No settings found in the database.")

        students = db.query(Student).all()
        print("\n--- Registered Students ---")
        if not students:
            print("No students registered.")
        for s in students:
            print(f"ID: {s.id}, Name: {s.name}, ZK ID: {s.zk_id}, Email: {s.parent_email}")

    finally:
        db.close()

if __name__ == "__main__":
    check_setup()
