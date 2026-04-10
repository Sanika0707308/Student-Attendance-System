import os
import threading
import time
import pytest
import uvicorn
from sqlalchemy import create_engine
import sys
from unittest import mock

# Ensure the app can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../python_app')))
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from database import Base
from tests.mocks.zk_mock import MockZK

TEST_DB_FILE = os.path.join(os.path.dirname(__file__), "test_attendance.db")
os.environ["TEST_DB_FILE"] = TEST_DB_FILE

def setup_test_db():
    if os.path.exists(TEST_DB_FILE):
        os.remove(TEST_DB_FILE)
    
    engine = create_engine(f"sqlite:///{TEST_DB_FILE}")
    Base.metadata.create_all(bind=engine)
    return engine

def run_server():
    from main import app
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="error")

@pytest.fixture(scope="session", autouse=True)
def boot_test_server():
    """Start FastAPI server with hardware mocked securely"""
    setup_test_db()
    
    # Mock pyzk globally for the test server thread (all modules that import ZK)
    with mock.patch("zk.ZK", new=MockZK), mock.patch("zkteco_service.ZK", new=MockZK), mock.patch("routers.settings.ZK", new=MockZK):
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

@pytest.fixture(autouse=True)
def reset_db_and_hardware_per_test():
    """Clean the DB and Hardware between tests to ensure isolation"""
    # 1. Reset Database State securely using SQLAlchemy DELETE
    from database import SessionLocal, Student, Attendance, SystemSettings
    db = SessionLocal()
    try:
        db.query(Attendance).delete()
        db.query(Student).delete()
        db.query(SystemSettings).delete()
        
        # Insert default settings so testing flows correctly
        db.add(SystemSettings(zk_ip_address="192.168.1.100"))
        db.commit()
    finally:
        db.close()

    # 2. Reset Hardware mock
    MockZK.mode = "normal"
    MockZK.logs = []
