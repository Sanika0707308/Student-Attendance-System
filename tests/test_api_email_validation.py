from fastapi.testclient import TestClient
from python_app.main import app

client = TestClient(app)

def test_api_student_registration_validation():
    # Authenticate first
    login_resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"

    # Attempt to register with invalid emails
    invalid_cases = [
        "student@gmail.con",
        "student@gamail.com",
        "student@gmail",
        "student@",
        "@gmail.com",
        "student@gmail..com",
    ]

    for inv in invalid_cases:
        response = client.post(
            "/api/students/",
            json={"name": "Test Student", "zk_id": "888", "parent_email": inv, "standard": "11th"},
        )
        assert response.status_code == 422, f"Expected 422 for '{inv}', got {response.status_code}"

    # Valid emails
    valid_cases = [
        "student@gmail.com",
        "student@outlook.com",
        "student@yahoo.co.in",
        "student@institute.edu",
        "student@college.ac.in",
    ]

    for idx, valid in enumerate(valid_cases, start=7001):
        response = client.post(
            "/api/students/",
            json={"name": f"Valid Student {idx}", "zk_id": str(idx), "parent_email": valid, "standard": "11th"},
        )
        assert response.status_code != 422, f"Validation should pass for '{valid}', but got 422: {response.text}"


def test_api_settings_email_validation():
    # Login first
    client.post("/api/auth/login", json={"username": "admin", "password": "admin"})

    # Invalid smtp_email
    resp = client.post(
        "/api/settings/",
        json={
            "zk_ip_address": "192.168.1.100",
            "smtp_email": "school@gmail.con",
            "smtp_password": "pass",
            "in_time": "08:30",
            "mid_time": "12:00",
            "out_time": "15:00",
            "institute_name": "Test Institute",
        },
    )
    assert resp.status_code == 422, f"Expected 422 for invalid SMTP email, got {resp.status_code}: {resp.text}"

    # Valid smtp_email
    resp_valid = client.post(
        "/api/settings/",
        json={
            "zk_ip_address": "192.168.1.100",
            "smtp_email": "school@institute.edu",
            "smtp_password": "pass",
            "in_time": "08:30",
            "mid_time": "12:00",
            "out_time": "15:00",
            "institute_name": "Test Institute",
        },
    )
    assert resp_valid.status_code != 422, f"Expected validation to pass for valid SMTP email, got {resp_valid.status_code}"
