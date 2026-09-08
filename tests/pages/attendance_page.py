from playwright.sync_api import Page, expect

class AttendancePage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url
        self.table_rows = page.locator("#attendance-table-body tr")
    
    def navigate(self):
        self.page.goto(f"{self.base_url}/static/attendance.html")

    def assert_record_present(self, student_name: str, status: str):
        row = self.table_rows.filter(has_text=student_name).first
        expect(row).to_be_visible()
        expect(row).to_contain_text(status)
