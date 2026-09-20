import pytest
from python_app.email_validation import validate_email_address
from python_app.routers.students import StudentCreate
from python_app.routers.settings import SettingsUpdate
from pydantic import ValidationError


class TestEmailValidationLogic:
    """Direct unit tests for the general-purpose email validation logic."""

    @pytest.mark.parametrize("invalid_email,expected_keyword", [
        ("student@gmail.con", "Invalid domain extension"),
        ("student@gamail.com", "typos"),
        ("student@gmail", "missing domain extension/TLD"),
        ("student@", "domain part after '@' is missing"),
        ("@gmail.com", "local part before '@' is missing"),
        ("student@gmail..com", "consecutive dots"),
        ("student..name@gmail.com", "consecutive dots"),
        (".student@gmail.com", "cannot start or end with a dot"),
        ("student.@gmail.com", "cannot start or end with a dot"),
        ("student@-gmail.com", "hyphen"),
        ("student@gmail-.com", "hyphen"),
        ("student@.gmail.com", "cannot start or end with a dot"),
        ("student@gmail.com.", "cannot start or end with a dot"),
        ("student@invalid@domain.com", "multiple '@' symbols"),
        ("studentgmail.com", "missing '@' symbol"),
        ("", "required"),
        ("   ", "cannot be empty"),
        ("student@yahoo.cmo", "Invalid domain extension"),
        ("student@hotmial.com", "typos"),
        ("student@outlok.com", "typos"),
        ("student@domain.123", "must contain only letters"),
    ])
    def test_invalid_emails_rejected(self, invalid_email, expected_keyword):
        is_valid, cleaned, error = validate_email_address(invalid_email)
        assert not is_valid, f"Expected '{invalid_email}' to be rejected, but it passed."
        assert expected_keyword.lower() in error.lower(), f"Error message '{error}' missing keyword '{expected_keyword}'"

    @pytest.mark.parametrize("valid_email,expected_normalized", [
        ("student@gmail.com", "student@gmail.com"),
        ("student@outlook.com", "student@outlook.com"),
        ("student@yahoo.co.in", "student@yahoo.co.in"),
        ("student@institute.edu", "student@institute.edu"),
        ("student@college.ac.in", "student@college.ac.in"),
        ("student@company.org", "student@company.org"),
        ("student@service.net", "student@service.net"),
        ("user@startup.io", "user@startup.io"),
        ("user@tech.ai", "user@tech.ai"),
        ("contact@agency.tech", "contact@agency.tech"),
        ("first.last+tag@sub.example.com", "first.last+tag@sub.example.com"),
        ("  student@gmail.com  ", "student@gmail.com"),
        ("STUDENT@GMAIL.COM", "student@gmail.com"),
        ("parent@school.k12.us", "parent@school.k12.us"),
    ])
    def test_valid_emails_accepted(self, valid_email, expected_normalized):
        is_valid, cleaned, error = validate_email_address(valid_email)
        assert is_valid, f"Expected '{valid_email}' to be accepted, but got error: {error}"
        assert cleaned == expected_normalized
        assert error == ""


class TestModelValidationIntegration:
    """Verify that StudentCreate and SettingsUpdate models enforce the new validation."""

    def test_student_create_rejects_invalid_email(self):
        with pytest.raises(ValidationError) as exc:
            StudentCreate(name="Test Student", zk_id="123", parent_email="student@gmail.con")
        assert "Invalid domain extension" in str(exc.value)

    def test_student_create_accepts_valid_email(self):
        student = StudentCreate(name="Test Student", zk_id="123", parent_email="  Student@Outlook.com  ")
        assert student.parent_email == "student@outlook.com"

    def test_student_create_accepts_institute_email(self):
        student = StudentCreate(name="Test Student", zk_id="123", parent_email="parent@iitb.ac.in")
        assert student.parent_email == "parent@iitb.ac.in"

    def test_settings_update_rejects_invalid_smtp_email(self):
        with pytest.raises(ValidationError) as exc:
            SettingsUpdate(
                zk_ip_address="192.168.1.201",
                smtp_email="admin@gmail.con",
                smtp_password="password",
                in_time="09:00",
                mid_time="12:00",
                out_time="17:00",
                institute_name="Test Institute",
            )
        assert "Invalid domain extension" in str(exc.value)

    def test_settings_update_accepts_valid_smtp_email(self):
        settings = SettingsUpdate(
            zk_ip_address="192.168.1.201",
            smtp_email="  admin@school.org  ",
            smtp_password="password",
            in_time="09:00",
            mid_time="12:00",
            out_time="17:00",
            institute_name="Test Institute",
        )
        assert settings.smtp_email == "admin@school.org"

    def test_settings_update_allows_empty_smtp_email(self):
        settings = SettingsUpdate(
            zk_ip_address="192.168.1.201",
            smtp_email="",
            smtp_password="",
            in_time="09:00",
            mid_time="12:00",
            out_time="17:00",
            institute_name="Test Institute",
        )
        assert settings.smtp_email == ""
