from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import date as date_type, timedelta

from database import get_db, Holiday, get_configured_standards

router = APIRouter(prefix="/api/holidays", tags=["Holidays"])


def validate_standard(standard: str, db: Session) -> str:
    """
    Check a standard against the institute's configured class list rather than a
    hardcoded 11th/12th pair, so adding a class in Settings immediately works
    for holidays too. "All" is always accepted as the every-class wildcard.
    """
    normalized = (standard or "All").strip()
    allowed = get_configured_standards(db)
    if normalized != "All" and normalized not in allowed:
        raise HTTPException(
            status_code=422,
            detail="Standard must be All, or one of: " + ", ".join(allowed),
        )
    return normalized


def validate_date(value: str) -> str:
    try:
        return date_type.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date. Use YYYY-MM-DD.")

class HolidayCreate(BaseModel):
    date: str
    description: str
    standard: str = "All"

class HolidayRangeCreate(BaseModel):
    from_date: str
    to_date: str
    description: str
    standard: str = "All"

class HolidayRead(BaseModel):
    id: int
    date: str
    description: str
    standard: str = "All"

    class Config:
        from_attributes = True

@router.get("/", response_model=List[HolidayRead])
def get_holidays(db: Session = Depends(get_db)):
    return db.query(Holiday).order_by(Holiday.date.desc()).all()

@router.post("/")
def create_holiday(holiday: HolidayCreate, db: Session = Depends(get_db)):
    holiday_date = validate_date(holiday.date)
    standard = validate_standard(holiday.standard, db)
    existing_rules = db.query(Holiday).filter(Holiday.date == holiday_date).all()
    existing_standards = {rule.standard or "All" for rule in existing_rules}
    if standard != "All" and "All" in existing_standards:
        raise HTTPException(
            status_code=409,
            detail="An All Standards holiday already exists for this date. Delete it before adding an 11th or 12th holiday."
        )
    if standard == "All" and existing_standards:
        raise HTTPException(
            status_code=409,
            detail="Class-specific holidays already exist for this date. Delete them before adding an All Standards holiday."
        )
    # Check if holiday already exists for this date and standard
    if standard in existing_standards:
        raise HTTPException(status_code=400, detail="Holiday already exists for this date and standard.")
        
    new_holiday = Holiday(date=holiday_date, description=holiday.description.strip() or "Holiday", standard=standard)
    db.add(new_holiday)
    db.commit()
    db.refresh(new_holiday)
    return {
        "message": f"Holiday added for {standard}.",
        "holiday": {
            "id": new_holiday.id,
            "date": new_holiday.date,
            "description": new_holiday.description,
            "standard": new_holiday.standard,
        },
    }

@router.post("/range")
def create_holiday_range(data: HolidayRangeCreate, db: Session = Depends(get_db)):
    """Add holidays for every calendar day between from_date and to_date (inclusive)."""
    try:
        start = date_type.fromisoformat(data.from_date)
        end = date_type.fromisoformat(data.to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    if end < start:
        raise HTTPException(status_code=400, detail="to_date must be on or after from_date.")

    standard = validate_standard(data.standard, db)
    description = data.description.strip() or "Holiday"
    added = 0
    skipped = 0
    current = start
    while current <= end:
        date_str = current.isoformat()
        existing = db.query(Holiday).filter(
            Holiday.date == date_str,
            Holiday.standard == standard
        ).first()
        if not existing:
            db.add(Holiday(date=date_str, description=description, standard=standard))
            added += 1
        else:
            skipped += 1
        current += timedelta(days=1)

    db.commit()
    return {
        "message": f"Holiday range added for {standard}: {added} day(s) added, {skipped} day(s) already existed.",
        "added": added,
        "skipped": skipped,
        "standard": standard
    }

@router.delete("/{holiday_id}")
def delete_holiday(holiday_id: int, db: Session = Depends(get_db)):
    holiday = db.query(Holiday).filter(Holiday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")
        
    db.delete(holiday)
    db.commit()
    return {"message": "Holiday removed successfully"}
