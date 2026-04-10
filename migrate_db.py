
import sqlite3
import os

db_path = os.path.join('python_app', 'attendance.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute('ALTER TABLE settings ADD COLUMN in_time VARCHAR DEFAULT "08:30"')
    print("Added in_time")
except Exception as e:
    print(f"Error adding in_time: {e}")

try:
    cursor.execute('ALTER TABLE settings ADD COLUMN mid_time VARCHAR DEFAULT "12:00"')
    print("Added mid_time")
except Exception as e:
    print(f"Error adding mid_time: {e}")

try:
    cursor.execute('ALTER TABLE settings ADD COLUMN out_time VARCHAR DEFAULT "15:00"')
    print("Added out_time")
except Exception as e:
    print(f"Error adding out_time: {e}")

try:
    cursor.execute('ALTER TABLE students ADD COLUMN standard VARCHAR DEFAULT "11th"')
    print("Added standard")
except Exception as e:
    print(f"Error adding standard: {e}")

try:
    cursor.execute('ALTER TABLE students ADD COLUMN is_active BOOLEAN DEFAULT 1')
    print("Added is_active")
except Exception as e:
    print(f"Error adding is_active: {e}")

conn.commit()
conn.close()
print("Migration done.")
