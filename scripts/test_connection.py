from zk import ZK

def test_device_connection(ip_address, port=4370):
    print(f"Attempting to connect to ZKTeco device at {ip_address}:{port}...")
    
    # Initialize connection
    zk = ZK(ip_address, port=port, timeout=10, password=0, force_udp=False, ommit_ping=False)
    
    conn = None
    try:
        # Connect to device
        conn = zk.connect()
        print("\n✅ CONNECTION SUCCESSFUL!")
        print("-" * 30)
        
        # Pull Device Information
        print(f"Firmware Version: {conn.get_firmware_version()}")
        print(f"Serial Number: {conn.get_serialnumber()}")
        print(f"MAC Address: {conn.get_mac()}")
        print(f"Device Name: {conn.get_device_name()}")
        print(f"Face Algorithm: {conn.get_face_version()}")
        print(f"Platform: {conn.get_platform()}")
        
        print("\n✅ DATA TRANSMISSION SUCCESSFUL!")
        print("-" * 30)
        
        # Pull Users test
        users = conn.get_users()
        print(f"Total Users enrolled on device: {len(users)}")
        
        # Pull Attendance logs test
        logs = conn.get_attendance()
        print(f"Total Attendance records on device: {len(logs)}")
        if len(logs) > 0:
            print("\nLatest 3 Attendance Logs:")
            for log in logs[-3:]:
                print(f" - UserID: {log.user_id}, Time: {log.timestamp}")
                
        print("\nYour ZKTeco K40 Pro fully supports data extraction over the network!")

    except Exception as e:
        print("\n❌ CONNECTION FAILED!")
        print(f"Error details: {e}")
        print("\nPlease check your machine's IP address and network connection.")
    finally:
        if conn:
            conn.disconnect()

if __name__ == "__main__":
    # Ensure this matches the IP set on your physical ZKTeco machine
    DEVICE_IP = '10.216.67.177'
    test_device_connection(DEVICE_IP)
