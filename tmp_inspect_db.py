import sqlite3, os

db_path = r'c:/Users/M_Dell/Desktop/attendance_system/python_app/attendance.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM settings')
print('settings count:', cur.fetchone()[0])
cur.execute('SELECT smtp_email, smtp_password FROM settings LIMIT 1')
row = cur.fetchone()
print('smtp_email:', row[0] if row else None)
print('smtp_password (encrypted):', row[1] if row else None)
cur.execute('SELECT COUNT(*) FROM students WHERE parent_email IS NULL OR parent_email = ""')
print('students missing parent_email:', cur.fetchone()[0])
cur.execute('SELECT COUNT(*) FROM attendance WHERE email_sent = 0')
print('attendance email_sent false:', cur.fetchone()[0])
conn.close()
