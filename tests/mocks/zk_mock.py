from dataclasses import dataclass
from datetime import datetime
from typing import List

@dataclass
class ZKAttendanceRecord:
    user_id: str
    timestamp: datetime

class MockZKConnection:
    def __init__(self, mode="normal", logs=None):
        self.mode = mode
        self.logs = logs or []
        self._device_enabled = True

    def get_attendance(self) -> List[ZKAttendanceRecord]:
        if self.mode == "error":
            raise Exception("Mock Hardware Exception fetching logs")
        return self.logs

    def disable_device(self):
        if self.mode == "error":
            raise Exception("Failed to disable device")
        self._device_enabled = False

    def enable_device(self):
        self._device_enabled = True

    def clear_attendance(self):
        if self.mode == "error":
            raise Exception("Mock Error clearing attendance")
        self.logs = []

    def disconnect(self):
        pass

class MockZK:
    # State controlled statically across patching
    mode = "normal"
    logs = []
    
    def __init__(self, ip, port=4370, timeout=5, password=0, force_udp=False, ommit_ping=False):
        self.ip = ip
        if self.__class__.mode == "timeout":
            raise Exception("Mock Hardware connection timed out")
            
    def connect(self):
        if self.ip == "0.0.0.0" or self.ip == "offline":
             raise Exception("Server unreachable")
        return MockZKConnection(mode=self.__class__.mode, logs=self.__class__.logs)
