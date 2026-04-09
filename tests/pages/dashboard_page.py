from playwright.sync_api import Page, expect

class DashboardPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url
        self.title = page.locator("h1.page-title", has_text="Dashboard")
        self.present_count = page.locator("#present-count")
        self.absent_count = page.locator("#absent-count")
        self.late_count = page.locator("#late-count")
        
    def navigate(self):
        self.page.goto(f"{self.base_url}/static/dashboard.html")

    def assert_loaded(self):
        expect(self.title).to_be_visible()
