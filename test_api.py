
import requests
import json
from datetime import datetime

def test_api():
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"http://127.0.0.1:8000/api/attendance/?date={today}"
    print(f"Fetching from {url}...")
    try:
        response = requests.get(url)
        logs = response.json()
        print(f"Total logs: {len(logs)}")
        
        student_logs = {}
        for log in logs:
            name = log['student_name']
            if name not in student_logs:
                student_logs[name] = []
            student_logs[name].append(log)
            
        print("\nProcessed rows:")
        for name, punches in student_logs.items():
            punches.sort(key=lambda x: x['punch_time'])
            first = punches[0]
            last = punches[-1] if len(punches) > 1 else None
            
            in_time = first['punch_time']
            out_time = last['punch_time'] if last else '--'
            status = last['status'] if last else first['status']
            
            print(f"- {name}: IN={in_time}, OUT={out_time}, Status={status}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_api()
