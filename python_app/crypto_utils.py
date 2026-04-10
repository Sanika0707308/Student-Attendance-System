"""
Simple encryption utility for SMTP passwords stored in SQLite.
Uses Fernet symmetric encryption with a machine-specific key.
"""
import os
import base64
import hashlib
from cryptography.fernet import Fernet

def _get_or_create_key() -> bytes:
    """
    Generate a machine-specific encryption key.
    The key is derived from a secret file stored next to the database.
    If the file doesn't exist, a new key is generated.
    """
    key_file = os.path.join(os.path.dirname(__file__), ".encryption_key")
    
    if os.path.exists(key_file):
        with open(key_file, "rb") as f:
            return f.read()
    else:
        key = Fernet.generate_key()
        with open(key_file, "wb") as f:
            f.write(key)
        return key

_fernet = None

def _get_fernet():
    global _fernet
    if _fernet is None:
        key = _get_or_create_key()
        _fernet = Fernet(key)
    return _fernet

def encrypt_password(plain_password: str) -> str:
    """Encrypt a plaintext password and return a base64-encoded string."""
    if not plain_password:
        return ""
    f = _get_fernet()
    encrypted = f.encrypt(plain_password.encode("utf-8"))
    return encrypted.decode("utf-8")

def decrypt_password(encrypted_password: str) -> str:
    """Decrypt an encrypted password back to plaintext."""
    if not encrypted_password:
        return ""
    try:
        f = _get_fernet()
        decrypted = f.decrypt(encrypted_password.encode("utf-8"))
        return decrypted.decode("utf-8")
    except Exception:
        # If decryption fails, the password was likely stored in plaintext (migration case)
        return encrypted_password
