import pytest
import time
from datetime import datetime
from playwright.sync_api import Page, expect
from tests.pages.login_page import LoginPage
from tests.pages.students_page import StudentsPage
from tests.pages.attendance_page import AttendancePage
from tests.mocks.zk_mock import MockZK, ZKAttendanceRecord

@pytest.fixture
def auth_user(page: Page, test_url: str):
    login = LoginPage(page, test_url)
    login.navigate()
    login.login("admin", "admin")
    return test_url

def test_attendance_biometric_punch_sync(page: Page, auth_user: str):
    """Simulate user punching Biometric machine and data syncing to Attendance UI successfully"""
    # 1. Register a student first to match ZK ID
    students_page = StudentsPage(page, auth_user)
    students_page.navigate()
    students_page.register_student("Alice Bio", "501", "alice@example.com")
    
    # Wait for success
    expect(page.locator("#toast-container")).to_contain_text("successfully")
    
    # 2. Inject Mock Hardware Punch Event
    punch_time = datetime.now() # This will be registered as 'Present' (pre 8 AM) or 'Late' depending on test run time, or Left depending on time. We skip explicit status checking due to dynamic time bounds, but verify it appears.
    
    # The Background Thread in FastAPI polls the mock ZK device every 10s.
    # Since we can't easily jump time, let's trigger the log fetch explicitly or wait.
    # To avoid long waits, we insert log to Mock ZK
    MockZK.logs.append(ZKAttendanceRecord(user_id="501", timestamp=punch_time))
    
    # Give the background thread up to 12s to pick it up and process
    time.sleep(12) 
    
    # 3. Verify in UI
    attendance_page = AttendancePage(page, auth_user)
    attendance_page.navigate()
    
    # Alice should be visible with some status
    row = attendance_page.table_rows.filter(has_text="Alice Bio").first
    expect(row).to_be_visible()
    
def test_duplicate_punch_filtering(page: Page, auth_user: str):
    """Verify backend debounce protects against hardware double-punch spam (student holding finger)"""
    students_page = StudentsPage(page, auth_user)
    students_page.navigate()
    students_page.register_student("Bob Double", "502", "bob@ex.com")
    expect(page.locator("#toast-container")).to_contain_text("successfully")

    # Inject 5 punches instantly
    now = datetime.now()
    MockZK.logs = [] # Reset logs
    MockZK.logs.extend([
        ZKAttendanceRecord(user_id="502", timestamp=now),
        ZKAttendanceRecord(user_id="502", timestamp=now),
        ZKAttendanceRecord(user_id="502", timestamp=now),
    ])
    
    time.sleep(12) # Wait for thread
    
    attendance_page = AttendancePage(page, auth_user)
    attendance_page.navigate()
    
    # Ensure there is exactly 1 attendance log for Bob despite 3 punches
    expect(attendance_page.table_rows.filter(has_text="Bob Double")).to_have_count(1)
