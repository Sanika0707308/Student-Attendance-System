import os
import sys
import threading
import time
from unittest import mock

import pytest
import requests
import uvicorn
from sqlalchemy import create_engine

# Ensure the app can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../python_app')))
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

TEST_DB_FILE = os.path.join(os.path.dirname(__file__), "test_attendance.db")

# CRITICAL: this must be set BEFORE `database` is imported anywhere. database.py
# reads TEST_DB_FILE at module scope to build its engine, so importing it first
# and setting the variable afterwards silently bound the whole suite — and
# `reset_db_and_hardware_per_test`, which deletes every student and attendance
# row — to the live database in %LOCALAPPDATA%\InstituteAttendance.
os.environ["TEST_DB_FILE"] = TEST_DB_FILE

from database import Base, engine  # noqa: E402  (import order is deliberate, see above)
from tests.mocks.zk_mock import MockZK  # noqa: E402

# Credentials the schema migration seeds on a fresh database.
TEST_USERNAME = "admin"
TEST_PASSWORD = "admin"


def _assert_not_live_database():
    """Refuse to run if the engine is pointing anywhere near real user data."""
    url = str(engine.url)
    if "test_attendance.db" not in url:
        raise RuntimeError(
            f"Test engine is bound to '{url}', not the test database. "
            "Aborting rather than risk deleting live attendance records."
        )


def setup_test_db():
    _assert_not_live_database()
    if os.path.exists(TEST_DB_FILE):
        os.remove(TEST_DB_FILE)

    test_engine = create_engine(f"sqlite:///{TEST_DB_FILE}")
    Base.metadata.create_all(bind=test_engine)
    test_engine.dispose()

    # Seed the admin account and apply column migrations on the fresh file.
    from database import ensure_schema_up_to_date
    ensure_schema_up_to_date()


def run_server():
    from main import app
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="error")


@pytest.fixture(scope="session", autouse=True)
def boot_test_server():
    """Start FastAPI server with hardware mocked securely"""
    setup_test_db()

    # Mock pyzk globally for the test server thread (all modules that import ZK)
    with mock.patch("zk.ZK", new=MockZK), mock.patch("zkteco_service.ZK", new=MockZK), mock.patch("routers.settings.ZK", new=MockZK, create=True):
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        time.sleep(2)
        yield

    if os.path.exists(TEST_DB_FILE):
        try:
            os.remove(TEST_DB_FILE)
        except OSError:
            pass


@pytest.fixture
def test_url():
    return "http://127.0.0.1:8001"


@pytest.fixture
def api(test_url):
    """
    A logged-in requests.Session.

    Every /api/* route is behind the auth middleware added in 2.0, so tests must
    hold a session cookie. Use this instead of bare `requests.get/post`.
    """
    session = requests.Session()
    response = session.post(
        f"{test_url}/api/auth/login",
        json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
        timeout=10,
    )
    assert response.status_code == 200, f"Test login failed: {response.status_code} {response.text}"
    yield session
    session.close()


@pytest.fixture(autouse=True)
def reset_db_and_hardware_per_test():
    """Clean the DB and Hardware between tests to ensure isolation"""
    _assert_not_live_database()

    # 1. Reset Database State securely using SQLAlchemy DELETE.
    #    admin_users is deliberately left alone: the seeded account is what the
    #    `api` fixture logs in with, and re-seeding it per test would be wasted
    #    PBKDF2 work.
    from database import SessionLocal, Student, Attendance, SystemSettings, Holiday
    db = SessionLocal()
    try:
        db.query(Attendance).delete()
        db.query(Student).delete()
        db.query(Holiday).delete()
        db.query(SystemSettings).delete()

        # Insert default settings so testing flows correctly
        db.add(SystemSettings(zk_ip_address="192.168.1.100"))
        db.commit()
    finally:
        db.close()

    # 2. Reset Hardware mock
    MockZK.mode = "normal"
    MockZK.logs = []
