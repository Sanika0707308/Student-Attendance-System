import pytest
from playwright.sync_api import Page, expect
from tests.pages.login_page import LoginPage
from tests.pages.students_page import StudentsPage

@pytest.fixture
def logged_in_students_page(page: Page, test_url: str) -> StudentsPage:
    login = LoginPage(page, test_url)
    login.navigate()
    login.login("admin", "admin")
    students = StudentsPage(page, test_url)
    students.navigate()
    return students

def test_student_registration_success(logged_in_students_page: StudentsPage):
    """Test registering a valid student via UI"""
    page = logged_in_students_page.page
    
    expect(logged_in_students_page.student_rows).to_have_count(0)
    
    logged_in_students_page.register_student("John Doe", "1001", "parent@example.com")
    
    expect(page.locator("#toast-container")).to_contain_text("Student added successfully!")
    expect(logged_in_students_page.student_rows).to_have_count(1)
    expect(logged_in_students_page.student_rows.first).to_contain_text("John Doe")

def test_student_duplicate_zk_id(logged_in_students_page: StudentsPage):
    """Test that UI prevents registering duplicate ZK Device IDs"""
    # Register first
    logged_in_students_page.register_student("First Student", "999", "parent1@test.com")
    expect(logged_in_students_page.page.locator("#toast-container")).to_contain_text("successfully")
    
    # Register duplicate
    logged_in_students_page.register_student("Duplicate Student", "999", "parent2@test.com")
    
    # Should show an error message
    expect(logged_in_students_page.page.locator("#toast-container")).to_contain_text("already registered")
    
    # Ensure not added to UI table
    expect(logged_in_students_page.student_rows).to_have_count(1)

def test_student_invalid_empty_fields(logged_in_students_page: StudentsPage):
    """Test registration block on missing fields"""
    logged_in_students_page.register_student("", "", "")
    # Should not trigger API success or show in table
    expect(logged_in_students_page.student_rows).to_have_count(0)
