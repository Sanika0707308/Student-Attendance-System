<<<<<<< HEAD
from database import SessionLocal, Student, Base, engine
=======
from database import SessionLocal, Student, SystemSettings, Base, engine
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626

# Ensure tables are created
Base.metadata.create_all(bind=engine)

def init_db():
    db = SessionLocal()
    
<<<<<<< HEAD
    # Check if we already have students
=======
    # 1. Initialize Students
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
    if db.query(Student).count() == 0:
        students = [
            Student(name="Sanika Vishwas Shinde", zk_id="1", parent_email="parent1@example.com"),
            Student(name="Amruta Vijay Desai", zk_id="2", parent_email="parent2@example.com"),
            Student(name="Vaishnavi Kamble", zk_id="3", parent_email="parent3@example.com"),
        ]
<<<<<<< HEAD
        
        db.add_all(students)
        db.commit()
        print("Database initialized with 3 test students.")
    else:
        print("Database already contains students. Skipping initialization.")
        
=======
        db.add_all(students)
        print("Database initialized with 3 test students.")
    
    # 2. Initialize Settings if empty
    if db.query(SystemSettings).count() == 0:
        default_settings = SystemSettings(
            zk_ip_address="192.168.1.201", # Common default for ZKTeco
            in_time="08:30",
            mid_time="12:30",
            out_time="17:00"
        )
        db.add(default_settings)
        print("Database initialized with default system settings.")

    db.commit()
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
    db.close()

if __name__ == "__main__":
    init_db()
