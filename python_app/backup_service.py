import os
import shutil
import threading
import time
from datetime import datetime
from structlog import get_logger

logger = get_logger()

class BackupManager:
    """Automatically backs up the SQLite database daily to prevent data loss."""
    
    def __init__(self, max_backups=7):
        self.running = False
        self.thread = None
        self.max_backups = max_backups  # Keep last 7 days of backups
        self._last_backup_date = None
    
    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._backup_loop, daemon=True)
        self.thread.start()
        logger.info("Started daily database backup service.")
    
    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join()
    
    def _backup_loop(self):
        # Run an immediate check on startup, then check every 30 minutes
        while self.running:
            try:
                today_str = datetime.now().strftime("%Y-%m-%d")
                
                # Double check the filesystem to see if we already backed up today 
                # (helps if app is restarted multiple times)
                from database import DB_FILE
                backup_dir = os.path.join(os.path.dirname(DB_FILE), "backups")
                
                already_exists = False
                if os.path.exists(backup_dir):
                    existing = os.listdir(backup_dir)
                    already_exists = any(f.startswith(f"attendance_backup_{today_str}") for f in existing)

                if not already_exists:
                    self._create_backup()
                    
            except Exception as e:
                logger.error(f"Backup error: {e}")
            
            # Check every 30 minutes
            time.sleep(1800)
    
    def _create_backup(self):
        """Copy attendance.db to a timestamped backup file."""
        from database import DB_FILE
        
        if not os.path.exists(DB_FILE):
            logger.warning("Database file not found, skipping backup.")
            return
        
        # Create backups directory next to the database file
        backup_dir = os.path.join(os.path.dirname(DB_FILE), "backups")
        os.makedirs(backup_dir, exist_ok=True)
        
        # Timestamped backup filename
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        backup_filename = f"attendance_backup_{timestamp}.db"
        backup_path = os.path.join(backup_dir, backup_filename)
        
        # Copy the database file
        shutil.copy2(DB_FILE, backup_path)
        logger.info(f"Database backed up successfully: {backup_filename}")
        print(f"[Backup] Database backed up: {backup_filename}")
        
        # Cleanup old backups (keep only last N)
        self._cleanup_old_backups(backup_dir)
    
    def _cleanup_old_backups(self, backup_dir):
        """Remove oldest backups if we exceed max_backups count."""
        backups = sorted([
            f for f in os.listdir(backup_dir) 
            if f.startswith("attendance_backup_") and f.endswith(".db")
        ])
        
        while len(backups) > self.max_backups:
            oldest = backups.pop(0)
            os.remove(os.path.join(backup_dir, oldest))
            logger.info(f"Removed old backup: {oldest}")

# Singleton
backup_manager = BackupManager()
