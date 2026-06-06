from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import date as date_type, timedelta

from database import get_db, Holiday

router = APIRouter(prefix="/api/holidays", tags=["Holidays"])

class HolidayCreate(BaseModel):
    date: str
    description: str

class HolidayRangeCreate(BaseModel):
    from_date: str
    to_date: str
    description: str

class HolidayRead(BaseModel):
    id: int
    date: str
    description: str

    class Config:
        from_attributes = True

@router.get("/", response_model=List[HolidayRead])
def get_holidays(db: Session = Depends(get_db)):
    return db.query(Holiday).order_by(Holiday.date.desc()).all()

@router.post("/")
def create_holiday(holiday: HolidayCreate, db: Session = Depends(get_db)):
    # Check if holiday already exists
    existing = db.query(Holiday).filter(Holiday.date == holiday.date).first()
    if existing:
        raise HTTPException(status_code=400, detail="Holiday already exists for this date.")
        
    new_holiday = Holiday(date=holiday.date, description=holiday.description)
    db.add(new_holiday)
    db.commit()
    return {"message": "Holiday added successfully"}

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

    added = 0
    skipped = 0
    current = start
    while current <= end:
        date_str = current.isoformat()
        existing = db.query(Holiday).filter(Holiday.date == date_str).first()
        if not existing:
            db.add(Holiday(date=date_str, description=data.description))
            added += 1
        else:
            skipped += 1
        current += timedelta(days=1)

    db.commit()
    return {
        "message": f"Holiday range added: {added} day(s) added, {skipped} day(s) already existed.",
        "added": added,
        "skipped": skipped
    }

@router.delete("/{holiday_id}")
def delete_holiday(holiday_id: int, db: Session = Depends(get_db)):
    holiday = db.query(Holiday).filter(Holiday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")
        
    db.delete(holiday)
    db.commit()
    return {"message": "Holiday removed successfully"}
