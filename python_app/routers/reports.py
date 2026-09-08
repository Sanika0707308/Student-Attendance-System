"""
Report downloads. Kept separate from /api/attendance so the read-only export
routes are obvious, and so the workbook building in reports_service stays out of
the CRUD router.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from reports_service import (
    build_daily_workbook,
    build_monthly_workbook,
    compute_daily_report,
    compute_monthly_report,
    to_base64,
)

router = APIRouter(prefix="/api/reports", tags=["Reports"])


def _safe_filename_part(value: str) -> str:
    """Strip anything Windows rejects in a filename, e.g. 'All Standards' -> 'All_Standards'."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "").strip())
    return cleaned.strip("_") or "All"


@router.get("/monthly-xlsx")
def monthly_xlsx(month: str, standard: str = "All", db: Session = Depends(get_db)):
    """
    Monthly summary as a real .xlsx, base64-encoded for the native save dialog.

    Returned as JSON rather than a binary response because the frontend hands the
    bytes to window.pywebview.api.save_file — the same bridge the CSV and PDF
    exports already use, so there is one save path with one cancel behaviour.
    """
    try:
        report = compute_monthly_report(db, month, standard)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not report["students"]:
        raise HTTPException(
            status_code=404,
            detail="No students found for this standard. Add students before exporting.",
        )

    payload = build_monthly_workbook(report)
    filename = f"Student_Attendance_Summary_{_safe_filename_part(standard)}_{month}.xlsx"
    return {
        "filename": filename,
        "content_base64": to_base64(payload),
        "student_count": len(report["students"]),
        "working_days": report["working_days"],
    }


@router.get("/daily-xlsx")
def daily_xlsx(date: str, standard: str = "All", db: Session = Depends(get_db)):
    """One sheet of IN/OUT times and statuses for a single date."""
    try:
        report = compute_daily_report(db, date, standard)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not report["students"]:
        raise HTTPException(
            status_code=404,
            detail="No students found for this standard. Add students before exporting.",
        )

    payload = build_daily_workbook(report)
    filename = f"Daily_Attendance_{_safe_filename_part(standard)}_{date}.xlsx"
    return {
        "filename": filename,
        "content_base64": to_base64(payload),
        "student_count": len(report["students"]),
    }


@router.get("/monthly-summary")
def monthly_summary(month: str, standard: str = "All", db: Session = Depends(get_db)):
    """
    The same numbers as the workbook, as JSON. Exposed so the working-day and
    percentage arithmetic can be checked against the on-screen table without
    opening a spreadsheet.
    """
    try:
        report = compute_monthly_report(db, month, standard)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # The grid and raw log are only needed for the workbook; keep the payload small.
    return {
        "institute_name": report["institute_name"],
        "month": report["month"],
        "standard_filter": report["standard_filter"],
        "working_days": report["working_days"],
        "avg_present_pct": report["avg_present_pct"],
        "avg_absent_pct": report["avg_absent_pct"],
        "students": report["students"],
    }
