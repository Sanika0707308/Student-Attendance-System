import sqlite3, os, sys

def inspect(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # settings count
    cur.execute('SELECT COUNT(*) FROM settings')
    print('settings count:', cur.fetchone()[0])
    cur.execute('SELECT smtp_email, smtp_password FROM settings LIMIT 1')
    row = cur.fetchone()
    print('smtp_email:', row[0] if row else None)
    print('smtp_password (encrypted):', row[1] if row else None)
    # missing parent emails
    cur.execute('SELECT COUNT(*) FROM students WHERE parent_email IS NULL OR parent_email = ""')
    print('students missing parent_email:', cur.fetchone()[0])
    # email_sent false count
    cur.execute('SELECT COUNT(*) FROM attendance WHERE email_sent = 0')
    print('attendance email_sent false:', cur.fetchone()[0])
    conn.close()

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python inspect_backup.py <db_path>')
        sys.exit(1)
    inspect(sys.argv[1])
