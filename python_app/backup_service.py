import os
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
                from config import DB_FILE, BACKUP_DIR
                
                already_exists = False
                if os.path.exists(BACKUP_DIR):
                    existing = os.listdir(BACKUP_DIR)
                    already_exists = any(f.startswith(f"attendance_backup_{today_str}") for f in existing)

                if not already_exists:
                    self._create_backup()
                    
            except Exception as e:
                logger.error(f"Backup error: {e}")
            
            # Check every 30 minutes
            time.sleep(1800)
    
    def _create_backup(self):
        """
        Create a safe atomic backup of attendance.db using SQLite's VACUUM INTO.
        
        IMPORTANT: We use VACUUM INTO instead of shutil.copy2() because:
        - shutil.copy2() copies raw bytes and can snapshot the file mid-write,
          producing a corrupt backup if ZKTeco polling writes at the same time.
        - VACUUM INTO is an atomic SQLite operation that waits for all pending writes,
          produces a clean defragmented copy, and is always fully consistent.
        """
        import sqlite3
        from config import DB_FILE, BACKUP_DIR
        
        if not os.path.exists(DB_FILE):
            logger.warning("Database file not found, skipping backup.")
            return
        
        # Timestamped backup filename
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        backup_filename = f"attendance_backup_{timestamp}.db"
        backup_path = os.path.join(BACKUP_DIR, backup_filename)
        
        # Use SQLite VACUUM INTO for a safe, atomic backup (works even under concurrent writes)
        try:
            conn = sqlite3.connect(DB_FILE, timeout=10)
            conn.execute(f"VACUUM INTO '{backup_path}'")
            conn.close()
            logger.info(f"Database backed up successfully (VACUUM INTO): {backup_filename}")
            print(f"[Backup] Database backed up: {backup_filename}")
        except Exception as e:
            logger.error(f"VACUUM INTO backup failed: {e}. Skipping this backup cycle.")
            # Do NOT fall back to shutil.copy2 — a corrupt backup is worse than no backup
            return
        
        # Cleanup old backups (keep only last N)
        self._cleanup_old_backups(BACKUP_DIR)
    
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
