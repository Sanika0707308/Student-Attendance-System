from database import SessionLocal, Student, SystemSettings, Base, engine

# Ensure tables are created
Base.metadata.create_all(bind=engine)

def init_db():
    db = SessionLocal()
    
    # 1. Initialize Students
    if db.query(Student).count() == 0:
        students = [
            Student(name="Sanika Vishwas Shinde", zk_id="1", parent_email="parent1@example.com"),
            Student(name="Amruta Vijay Desai", zk_id="2", parent_email="parent2@example.com"),
            Student(name="Vaishnavi Kamble", zk_id="3", parent_email="parent3@example.com"),
        ]
        db.add_all(students)
        print("Database initialized with 3 test students.")
    else:
        print("Database already contains students. Skipping initialization.")
    
    # 2. Initialize Settings
    if db.query(SystemSettings).count() == 0:
        default_settings = SystemSettings(
            zk_ip_address="192.168.1.201",
            in_time="08:30",
            mid_time="12:30",
            out_time="17:00"
        )
        db.add(default_settings)
        print("Database initialized with default system settings.")

    db.commit()
    db.close()

if __name__ == "__main__":
    init_db()