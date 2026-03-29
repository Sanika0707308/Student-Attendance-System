from database import SessionLocal, Student, Base, engine

# Ensure tables are created
Base.metadata.create_all(bind=engine)

def init_db():
    db = SessionLocal()
    
    # Check if we already have students
    if db.query(Student).count() == 0:
        students = [
            Student(name="Sanika Vishwas Shinde", zk_id="1", parent_email="parent1@example.com"),
            Student(name="Amruta Vijay Desai", zk_id="2", parent_email="parent2@example.com"),
            Student(name="Vaishnavi Kamble", zk_id="3", parent_email="parent3@example.com"),
        ]
        
        db.add_all(students)
        db.commit()
        print("Database initialized with 3 test students.")
    else:
        print("Database already contains students. Skipping initialization.")
        
    db.close()

if __name__ == "__main__":
    init_db()
