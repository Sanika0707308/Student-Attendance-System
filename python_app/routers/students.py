from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from database import get_db, Student, get_configured_standards

router = APIRouter(prefix="/api/students", tags=["Students"])

# Pydantic models for validation
from pydantic import BaseModel, Field, field_validator
from typing import List

# Pydantic models for validation
class StudentCreate(BaseModel):
    name: str
    zk_id: str = Field(..., description="Numeric ID from the ZKTeco device")
    parent_email: str
    standard: str = "11th"

    @field_validator('zk_id')
    @classmethod
    def validate_zk_id(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError('ZKTeco ID must contain only digits')
        return v

    @field_validator('parent_email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        import re
        # Basic but strict email format check: local@domain.tld
        # Prevents malformed addresses like 'test@', 'abc123', '@domain.com'
        # that would silently fail on every SMTP send and clog the failed-emails queue.
        pattern = r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
        if not re.match(pattern, v.strip()):
            raise ValueError('Invalid email address format. Use format: name@domain.com')
        return v.strip().lower()

class StudentRead(StudentCreate):
    id: int
    # False for a graduated batch that was archived rather than deleted. Exposed
    # so the roster can badge them instead of silently mixing them in.
    is_active: bool = True

    class Config:
        from_attributes = True

@router.get("/", response_model=List[StudentRead])
def get_students(standard: str = None, include_archived: bool = False,
                 skip: int = 0, limit: int = 100000, db: Session = Depends(get_db)):
    query = db.query(Student)
    if standard:
        query = query.filter(Student.standard == standard)
    # Archived students are the graduated batch kept for their attendance
    # history. They are hidden unless asked for, so last year's leavers do not
    # pad this year's roster.
    if not include_archived:
        query = query.filter(Student.is_active == True)  # noqa: E712 — SQL boolean, not Python
    students = query.offset(skip).limit(limit).all()
    return students

@router.post("/", response_model=StudentRead)
def create_student(student: StudentCreate, db: Session = Depends(get_db)):
    db_student = db.query(Student).filter(Student.zk_id == student.zk_id).first()
    if db_student:
        raise HTTPException(status_code=400, detail="Student with this ZKTeco ID already registered")
    
    new_student = Student(
        name=student.name,
        zk_id=student.zk_id,
        parent_email=student.parent_email,
        standard=student.standard
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)
    return new_student

@router.delete("/{student_id}")
def delete_student(student_id: int, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    db.delete(student)
    db.commit()
    return {"message": "Student deleted"}

@router.put("/{student_id}", response_model=StudentRead)
def update_student(student_id: int, student_data: StudentCreate, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Check if the new ZK ID belongs to someone else
    if student_data.zk_id != student.zk_id:
        duplicate = db.query(Student).filter(Student.zk_id == student_data.zk_id).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="ZKTeco ID already in use")

    student.name = student_data.name
    student.zk_id = student_data.zk_id
    student.parent_email = student_data.parent_email
    student.standard = student_data.standard

    db.commit()
    db.refresh(student)
    return student


# ── Bulk import / export ─────────────────────────────────────────────────────
# Entering a whole roster one student at a time through the single-row form is
# the most tedious part of setting the app up, so accept a CSV. Validation goes
# through the same StudentCreate validators the single-add path uses, so the two
# routes can never drift apart on what counts as a valid ZK ID or email.

import base64
import csv
import io
from fastapi import UploadFile, File
from pydantic import ValidationError

CSV_COLUMNS = ["name", "zk_id", "parent_email", "standard"]


def _csv_to_base64(rows: list) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerows(rows)
    # utf-8-sig: Excel on Windows needs the BOM or it renders non-ASCII names as mojibake.
    return base64.b64encode(buffer.getvalue().encode("utf-8-sig")).decode("ascii")


@router.get("/export")
def export_students(db: Session = Depends(get_db)):
    """Every student as a base64 CSV, ready for the native save dialog."""
    rows = [CSV_COLUMNS]
    for s in db.query(Student).order_by(Student.standard, Student.name).all():
        rows.append([s.name or "", s.zk_id or "", s.parent_email or "", s.standard or ""])
    return {
        "filename": "students_export.csv",
        "count": len(rows) - 1,
        "content_base64": _csv_to_base64(rows),
    }


@router.get("/import-template")
def import_template(db: Session = Depends(get_db)):
    """A CSV with the expected header and one example row."""
    standards = get_configured_standards(db)
    rows = [
        CSV_COLUMNS,
        ["Sanika Patil", "101", "parent1@example.com", standards[0]],
        ["Rohan Deshmukh", "102", "parent2@example.com", standards[-1]],
    ]
    return {
        "filename": "students_import_template.csv",
        "content_base64": _csv_to_base64(rows),
    }


@router.post("/bulk-import")
async def bulk_import_students(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Import students from a CSV. Reports on every row rather than aborting the
    whole file on the first bad one — a roster typed by hand usually has a few
    malformed emails, and losing the other 200 rows to one typo is useless.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    # Excel writes utf-8-sig; fall back to cp1252 for files saved from older tools.
    try:
        text_content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text_content = raw.decode("cp1252")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Could not read the file's text encoding. Save it as CSV UTF-8 and try again.",
            )

    reader = csv.DictReader(io.StringIO(text_content))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="The CSV has no header row.")

    headers = {(h or "").strip().lower() for h in reader.fieldnames}
    missing = [c for c in ("name", "zk_id", "parent_email") if c not in headers]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=("Missing required column(s): " + ", ".join(missing) +
                    ". Expected header: " + ", ".join(CSV_COLUMNS)),
        )

    allowed_standards = get_configured_standards(db)
    existing_ids = {s.zk_id for s in db.query(Student.zk_id).all()}
    seen_in_file = set()

    added = skipped = failed = 0
    results = []

    for offset, raw_row in enumerate(reader):
        # Header is line 1, so the first data row is line 2 — report the number
        # the user actually sees in their spreadsheet.
        line_number = offset + 2
        row = {(k or "").strip().lower(): (v or "").strip()
               for k, v in raw_row.items() if k is not None}

        if not any(row.get(c) for c in CSV_COLUMNS):
            continue  # blank line

        name = row.get("name", "")
        zk_id = row.get("zk_id", "")
        standard = row.get("standard", "") or allowed_standards[0]

        def record(status: str, message: str):
            results.append({
                "line": line_number, "name": name, "zk_id": zk_id,
                "status": status, "message": message,
            })

        if standard not in allowed_standards:
            failed += 1
            record("error", f"Unknown standard '{standard}'. Allowed: " + ", ".join(allowed_standards))
            continue

        try:
            validated = StudentCreate(
                name=name,
                zk_id=zk_id,
                parent_email=row.get("parent_email", ""),
                standard=standard,
            )
        except ValidationError as exc:
            failed += 1
            reasons = "; ".join(e.get("msg", "invalid value").replace("Value error, ", "")
                                for e in exc.errors())
            record("error", reasons)
            continue

        if not validated.name.strip():
            failed += 1
            record("error", "Name is required.")
            continue

        if validated.zk_id in existing_ids:
            skipped += 1
            record("skipped", "A student with this ZK ID already exists.")
            continue

        if validated.zk_id in seen_in_file:
            skipped += 1
            record("skipped", "Duplicate ZK ID earlier in this file.")
            continue

        db.add(Student(
            name=validated.name.strip(),
            zk_id=validated.zk_id,
            parent_email=validated.parent_email,
            standard=validated.standard,
        ))
        seen_in_file.add(validated.zk_id)
        added += 1
        record("added", "Imported.")

    if added:
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to save imported students: {exc}")

    return {
        "added": added, "skipped": skipped, "failed": failed,
        "total": added + skipped + failed, "results": results,
    }


# ── Class-wise reset and year-end promotion ──────────────────────────────────
# Two operations that were previously only possible one student at a time:
# clearing out a finished batch, and moving every student up a class in
# September. Both are destructive, so both require the caller to echo back a
# confirmation phrase and both report exactly what they touched.

from database import Attendance  # noqa: E402 — grouped with the feature that uses it
from sqlalchemy import func  # noqa: E402


class BulkDeleteRequest(BaseModel):
    standard: str
    # Must equal the standard name. Guards against a mis-click wiping the wrong
    # class — the UI makes the user type it.
    confirm: str
    include_archived: bool = True


class ChangeStandardRequest(BaseModel):
    from_standard: str
    to_standard: str


class PromoteRequest(BaseModel):
    # What to do with the final class, which has nowhere left to go.
    #   "archive" — keep the students and their attendance history, hidden from
    #               the roster and excluded from absence marking
    #   "delete"  — remove them and their records permanently
    #   "keep"    — leave them where they are (they will share the class with
    #               the batch moving up)
    graduate_action: str = "archive"
    confirm: str = ""


def _standard_counts(db) -> dict:
    """{standard: {"active": n, "archived": n}} across everything on file."""
    counts = {}
    for standard, is_active, total in db.query(
        Student.standard, Student.is_active, func.count(Student.id)
    ).group_by(Student.standard, Student.is_active).all():
        key = standard or ""
        bucket = counts.setdefault(key, {"active": 0, "archived": 0})
        bucket["active" if is_active else "archived"] += total
    return counts


@router.get("/by-standard")
def students_by_standard(db: Session = Depends(get_db)):
    """
    Head count per class, including classes that are configured but empty and
    classes that hold students but are no longer configured (which happens after
    a class is renamed in Settings — those students would otherwise be
    invisible).
    """
    counts = _standard_counts(db)
    configured = get_configured_standards(db)
    rows = []
    for standard in configured:
        bucket = counts.get(standard, {"active": 0, "archived": 0})
        rows.append({
            "standard": standard, "configured": True,
            "active": bucket["active"], "archived": bucket["archived"],
            "total": bucket["active"] + bucket["archived"],
        })
    for standard, bucket in sorted(counts.items()):
        if standard not in configured:
            rows.append({
                "standard": standard, "configured": False,
                "active": bucket["active"], "archived": bucket["archived"],
                "total": bucket["active"] + bucket["archived"],
            })
    return {"standards": rows, "total": sum(r["total"] for r in rows)}


@router.post("/bulk-delete")
def bulk_delete_by_standard(req: BulkDeleteRequest, db: Session = Depends(get_db)):
    """
    Delete every student in one class, with their attendance records.

    This is the "reset the batch that just finished 12th" path. Deleting 60
    students one row at a time was the only way to do it before.
    """
    standard = (req.standard or "").strip()
    if not standard:
        raise HTTPException(status_code=400, detail="A class must be given.")
    if (req.confirm or "").strip() != standard:
        raise HTTPException(
            status_code=400,
            detail=f"Confirmation text must exactly match the class name '{standard}'.",
        )

    query = db.query(Student).filter(Student.standard == standard)
    if not req.include_archived:
        query = query.filter(Student.is_active == True)  # noqa: E712

    students = query.all()
    if not students:
        raise HTTPException(status_code=404, detail=f"No students found in '{standard}'.")

    student_ids = [s.id for s in students]

    try:
        # Attendance is removed explicitly rather than relying on the ORM's
        # delete-orphan cascade: a per-object cascade would load and delete rows
        # one student at a time, which is slow for a whole batch.
        attendance_removed = db.query(Attendance).filter(
            Attendance.student_id.in_(student_ids)
        ).delete(synchronize_session=False)
        db.query(Student).filter(Student.id.in_(student_ids)).delete(synchronize_session=False)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete class '{standard}': {exc}")

    return {
        "success": True,
        "standard": standard,
        "students_deleted": len(student_ids),
        "attendance_deleted": attendance_removed,
        "message": f"Deleted {len(student_ids)} student(s) from {standard} and {attendance_removed} attendance record(s).",
    }


@router.post("/change-standard")
def change_standard(req: ChangeStandardRequest, db: Session = Depends(get_db)):
    """Move every student in one class to another class."""
    source = (req.from_standard or "").strip()
    target = (req.to_standard or "").strip()
    if not source or not target:
        raise HTTPException(status_code=400, detail="Both classes must be given.")
    if source == target:
        raise HTTPException(status_code=400, detail="The two classes are the same.")

    allowed = get_configured_standards(db)
    if target not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"'{target}' is not a configured class. Add it in Settings first.",
        )

    moved = db.query(Student).filter(
        Student.standard == source,
        Student.is_active == True,  # noqa: E712
    ).update({Student.standard: target}, synchronize_session=False)

    if not moved:
        db.rollback()
        raise HTTPException(status_code=404, detail=f"No active students found in '{source}'.")

    db.commit()
    return {
        "success": True, "moved": moved, "from_standard": source, "to_standard": target,
        "message": f"Moved {moved} student(s) from {source} to {target}.",
    }


def _build_promotion_plan(db) -> list:
    """
    The class-to-class moves for one academic year, derived from the order of the
    class list in Settings: each class advances to the next one, and the last has
    nowhere to go, so it graduates.
    """
    standards = get_configured_standards(db)
    counts = _standard_counts(db)
    plan = []
    for index, standard in enumerate(standards):
        active = counts.get(standard, {}).get("active", 0)
        is_final = index == len(standards) - 1
        plan.append({
            "from_standard": standard,
            "to_standard": None if is_final else standards[index + 1],
            "graduating": is_final,
            "students": active,
        })
    return plan


@router.get("/promotion-plan")
def promotion_plan(db: Session = Depends(get_db)):
    """Preview of what "Promote All" will do, with head counts, before running it."""
    plan = _build_promotion_plan(db)
    return {
        "plan": plan,
        "confirm_phrase": "PROMOTE",
        "total_moving": sum(p["students"] for p in plan if not p["graduating"]),
        "total_graduating": sum(p["students"] for p in plan if p["graduating"]),
    }


@router.post("/promote")
def promote_all(req: PromoteRequest, db: Session = Depends(get_db)):
    """
    Advance every class by one at the end of the academic year.

    Runs the moves in reverse order — the final class is cleared first, then each
    class below it steps up. Forward order would promote 11th into 12th and then
    graduate the students who had just arrived there.
    """
    if (req.confirm or "").strip().upper() != "PROMOTE":
        raise HTTPException(status_code=400, detail="Type PROMOTE to confirm this change.")

    action = (req.graduate_action or "archive").strip().lower()
    if action not in ("archive", "delete", "keep"):
        raise HTTPException(status_code=400, detail="graduate_action must be archive, delete or keep.")

    plan = _build_promotion_plan(db)
    if len(plan) < 2:
        raise HTTPException(
            status_code=400,
            detail="Promotion needs at least two classes configured in Settings.",
        )

    steps = []
    graduated = 0
    attendance_deleted = 0

    try:
        for entry in reversed(plan):
            source = entry["from_standard"]
            active_filter = (Student.standard == source, Student.is_active == True)  # noqa: E712

            if entry["graduating"]:
                if action == "keep":
                    steps.append({"standard": source, "action": "kept", "students": entry["students"]})
                    continue

                leavers = db.query(Student.id).filter(*active_filter).all()
                leaver_ids = [row[0] for row in leavers]
                if not leaver_ids:
                    steps.append({"standard": source, "action": action, "students": 0})
                    continue

                if action == "archive":
                    db.query(Student).filter(Student.id.in_(leaver_ids)).update(
                        {Student.is_active: False}, synchronize_session=False
                    )
                else:
                    attendance_deleted += db.query(Attendance).filter(
                        Attendance.student_id.in_(leaver_ids)
                    ).delete(synchronize_session=False)
                    db.query(Student).filter(Student.id.in_(leaver_ids)).delete(
                        synchronize_session=False
                    )

                graduated += len(leaver_ids)
                steps.append({"standard": source, "action": action, "students": len(leaver_ids)})
                continue

            moved = db.query(Student).filter(*active_filter).update(
                {Student.standard: entry["to_standard"]}, synchronize_session=False
            )
            steps.append({
                "standard": source, "action": "promoted",
                "to_standard": entry["to_standard"], "students": moved,
            })

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Promotion failed, nothing was changed: {exc}")

    promoted = sum(s["students"] for s in steps if s["action"] == "promoted")
    verb = {"archive": "archived", "delete": "deleted", "keep": "left in place"}[action]
    return {
        "success": True,
        "promoted": promoted,
        "graduated": graduated,
        "graduate_action": action,
        "attendance_deleted": attendance_deleted,
        # Reversed back to class order so the UI reads top-down like the class list.
        "steps": list(reversed(steps)),
        "message": f"Promoted {promoted} student(s); {graduated} final-year student(s) {verb}.",
    }


@router.post("/{student_id}/restore")
def restore_student(student_id: int, db: Session = Depends(get_db)):
    """Un-archive one student, e.g. a leaver who came back for a repeat year."""
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    student.is_active = True
    db.commit()
    return {"success": True, "message": f"{student.name} restored to the active roster."}
