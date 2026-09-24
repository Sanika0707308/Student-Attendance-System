from database import SessionLocal, SystemSettings

def check():
    db = SessionLocal()
    s = db.query(SystemSettings).first()
    if s:
        print(f"IP: {s.zk_ip_address}")
        print(f"IN: {s.in_time}")
        print(f"MID: {s.mid_time}")
        print(f"OUT: {s.out_time}")
    else:
        print("No settings found!")
    db.close()

if __name__ == "__main__":
    check()
