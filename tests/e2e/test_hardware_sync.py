import pytest
from playwright.sync_api import Page, expect
from tests.pages.login_page import LoginPage
from tests.pages.settings_page import SettingsPage
from tests.mocks.zk_mock import MockZK

@pytest.fixture
def logged_in_settings_page(page: Page, test_url: str) -> SettingsPage:
    login = LoginPage(page, test_url)
    login.navigate()
    login.login("admin", "admin")
    settings = SettingsPage(page, test_url)
    settings.navigate()
    return settings

def test_hardware_connection_success(logged_in_settings_page: SettingsPage):
    """Test successful connection using mocked physical device"""
    MockZK.mode = "normal"
    logged_in_settings_page.ip_input.fill("192.168.1.50")
    logged_in_settings_page.test_connection()
    
    expect(logged_in_settings_page.toast).to_contain_text("Connection successful")

def test_hardware_connection_timeout_or_offline(logged_in_settings_page: SettingsPage):
    """Test UI handles device disconnection gracefully without crashing"""
    MockZK.mode = "timeout"
    logged_in_settings_page.ip_input.fill("192.168.1.99")
    logged_in_settings_page.test_connection()
    
    expect(logged_in_settings_page.toast).to_contain_text("Failed to connect")

def test_hardware_wipe_success(logged_in_settings_page: SettingsPage):
    """Test wiping ZKTeco memory successfully via Settings"""
    MockZK.mode = "normal"
    # Needs valid IP saved first to wipe
    logged_in_settings_page.connect_device("192.168.1.100")
    
    logged_in_settings_page.wipe_hardware()
    expect(logged_in_settings_page.toast).to_contain_text("Successfully wiped hardware memory")

def test_hardware_wipe_blocked_offline(logged_in_settings_page: SettingsPage):
    """Test wiping ZKTeco memory handles offline device errors correctly"""
    MockZK.mode = "normal"
    logged_in_settings_page.connect_device("0.0.0.0") # trigger unreachable
    
    logged_in_settings_page.wipe_hardware()
    expect(logged_in_settings_page.toast).to_contain_text("Failed to clear memory")
