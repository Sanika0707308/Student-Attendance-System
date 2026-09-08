from playwright.sync_api import Page

class StudentsPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url
        self.name_input = page.locator("#student_name")
        self.zk_id_input = page.locator("#zk_id")
        self.email_input = page.locator("#parent_email")
        self.standard_select = page.locator("#standard")
        self.submit_btn = page.locator("button.btn-add", has_text="Add Student")
        self.student_rows = page.locator("#student-table-body tr")
    
    def navigate(self):
        self.page.goto(f"{self.base_url}/static/students.html")

    def register_student(self, name: str, zk_id: str, email: str, standard: str = "11th"):
        self.name_input.fill(name)
        self.zk_id_input.fill(zk_id)
        self.email_input.fill(email)
        self.standard_select.select_option(standard)
        self.submit_btn.click()
