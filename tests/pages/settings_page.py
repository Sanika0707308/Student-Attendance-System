from playwright.sync_api import Page, expect

class SettingsPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url
        self.ip_input = page.locator("#zk_ip_address")
        self.test_conn_btn = page.locator("#btnTestConnection")
        self.clear_logs_btn = page.locator("#btnClearLogs")
        self.save_btn = page.locator("button", has_text="Save Settings")
        self.toast = page.locator("#toast-container")
        
    def navigate(self):
        self.page.goto(f"{self.base_url}/static/settings.html")

    def connect_device(self, ip: str):
        self.ip_input.fill(ip)
        self.save_btn.click()
        expect(self.toast).to_contain_text("Settings saved successfully!")
    
    def test_connection(self):
        self.test_conn_btn.click()
        
    def wipe_hardware(self):
        self.page.on("dialog", lambda dialog: dialog.accept()) # Accept the JS confirmation
        self.clear_logs_btn.click()
