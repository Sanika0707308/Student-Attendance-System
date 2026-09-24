from database import SessionLocal, SystemSettings

def fix():
    db = SessionLocal()
    existing = db.query(SystemSettings).first()
    if not existing:
        print("Creating default settings...")
        s = SystemSettings(
            zk_ip_address="192.168.1.201",
            smtp_email="",
            smtp_password="",
            in_time="08:30",
            mid_time="12:30",
            out_time="16:30"
        )
        db.add(s)
        db.commit()
        print("Settings restored successfully.")
    else:
        print("Settings already exist. No action taken.")
    db.close()

if __name__ == "__main__":
    fix()
