"""
Sign-in, sign-out and password-change endpoints.

The session token is returned in an HttpOnly cookie rather than a bearer token
because the frontend is plain server-served HTML: a cookie is sent
automatically with the navigation request for `dashboard.html`, so a single
mechanism protects both the pages and the JSON API. A bearer token in
localStorage could only ever protect the API.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, AdminUser, SystemSettings
from auth import (
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    create_session,
    destroy_all_sessions,
    destroy_session,
    get_session_username,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

MIN_PASSWORD_LENGTH = 4


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        # No `secure=True`: the app is served over plain HTTP on 127.0.0.1, and a
        # secure cookie would simply never be stored.
    )


@router.post("/login")
def login(req: LoginRequest, response: Response, db: Session = Depends(get_db)):
    username = (req.username or "").strip()
    user = db.query(AdminUser).filter(AdminUser.username == username).first()

    # Deliberately identical message for unknown user and wrong password so the
    # response cannot be used to enumerate account names.
    if not user or not verify_password(req.password or "", user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_session(user.username)
    _set_session_cookie(response, token)
    return {
        "success": True,
        "username": user.username,
        "must_change_password": bool(user.must_change_password),
    }


@router.post("/logout")
def logout(request: Request, response: Response):
    destroy_session(request.cookies.get(SESSION_COOKIE_NAME))
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"success": True}


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    """Public: lets the login page tell whether a session is already live."""
    username = get_session_username(request.cookies.get(SESSION_COOKIE_NAME))
    if not username:
        return {"authenticated": False}
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    return {
        "authenticated": True,
        "username": username,
        "must_change_password": bool(user.must_change_password) if user else False,
    }


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, request: Request, response: Response,
                    db: Session = Depends(get_db)):
    username = get_session_username(request.cookies.get(SESSION_COOKIE_NAME))
    if not username:
        raise HTTPException(status_code=401, detail="Not signed in")

    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")

    if not verify_password(req.current_password or "", user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    new_password = req.new_password or ""
    if len(new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"New password must be at least {MIN_PASSWORD_LENGTH} characters long",
        )
    if new_password == req.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from the current one")

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    db.commit()

    # Drop every existing session, then immediately re-issue one for this
    # caller so changing the password does not bounce the admin to the login
    # screen mid-task.
    destroy_all_sessions()
    _set_session_cookie(response, create_session(user.username))
    return {"success": True, "message": "Password changed successfully"}


# ── Public branding ──────────────────────────────────────────────────────────
# `/api/settings` is authenticated (it returns the decrypted SMTP password), but
# the login screen still needs the institute name for its heading, and the
# display language so a machine that has never signed in still opens in the
# language the office configured. This exposes only those two fields.

public_router = APIRouter(prefix="/api/public", tags=["Public"])


@public_router.get("/branding")
def get_branding(db: Session = Depends(get_db)):
    settings = db.query(SystemSettings).first()
    name = (settings.institute_name or "").strip() if settings else ""
    language = (getattr(settings, "ui_language", None) or "en") if settings else "en"
    return {
        "institute_name": name or "Biometric Attendance",
        "ui_language": language if language in ("en", "mr") else "en",
    }
