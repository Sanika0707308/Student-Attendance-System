import pytest
from playwright.sync_api import Page, expect
from tests.pages.login_page import LoginPage
from tests.pages.dashboard_page import DashboardPage

def test_admin_login_valid(page: Page, test_url: str):
    """Test valid admin login redirects to Dashboard"""
    login_page = LoginPage(page, test_url)
    dashboard_page = DashboardPage(page, test_url)
    
    login_page.navigate()
    login_page.login("admin", "admin") # default valid credentials
    
    dashboard_page.assert_loaded()

def test_admin_login_invalid(page: Page, test_url: str):
    """Test invalid credentials render an error notification"""
    login_page = LoginPage(page, test_url)
    
    login_page.navigate()
    login_page.login("fakeadmin", "wrongpassword")
    
    expect(login_page.error_toast).to_contain_text("Invalid username or password")
    expect(page).to_have_url(f"{test_url}/static/login.html")

def test_admin_login_empty(page: Page, test_url: str):
    """Test empty credentials handle gracefully"""
    login_page = LoginPage(page, test_url)
    login_page.navigate()
    login_page.login("", "")
    # Should block navigation
    expect(page).to_have_url(f"{test_url}/static/login.html")
