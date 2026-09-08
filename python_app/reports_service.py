"""
Server-side report generation, including real .xlsx workbooks via openpyxl.

Until 2.0 the "Download Excel" button produced a CSV, and every figure in it was
computed in JavaScript. Doing the arithmetic here instead means the workbook, the
PDF and the on-screen table cannot drift apart.

The working-day rules below intentionally mirror frontend/js/reports.js exactly:

  * A working day is any date that has at least one attendance record — including
    auto-marked "Absent" rows. Those must count: on a day nobody attended, the
    only records are Absent, and skipping them would drop the day from the total
    and measure every percentage against zero.
  * A date only counts as a working day for a standard that was not on holiday
    that day, so 11th and 12th can legitimately show different totals.
  * A student is present on a date if they have any record there that is not
    "Absent".
"""

import base64
import calendar
import io
from datetime import datetime, time as time_cls

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from database import Attendance, Holiday, Student, SystemSettings

# Short codes for the day-by-day grid, so a month fits on one screen.
STATUS_CODES = {
    "Present": "P",
    "Late": "L",
    "Left Early": "LE",
    "Left": "O",
    "Absent": "A",
}

HEADER_FILL = PatternFill("solid", fgColor="2C3E50")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=14)
SUBTITLE_FONT = Font(size=10, color="555555")

FILL_GOOD = PatternFill("solid", fgColor="D5F5E3")    # >= 75%
FILL_WARN = PatternFill("solid", fgColor="FCF3CF")    # 50-74%
FILL_BAD = PatternFill("solid", fgColor="FADBD8")     # < 50%

THIN_BORDER = Border(*[Side(style="thin", color="D5DBDB")] * 4)


# ── Shared data assembly ─────────────────────────────────────────────────────

def _institute_name(db) -> str:
    settings = db.query(SystemSettings).first()
    name = (settings.institute_name or "").strip() if settings else ""
    return name or "Biometric Attendance"


def _mid_time(db) -> time_cls:
    settings = db.query(SystemSettings).first()
    raw = (getattr(settings, "mid_time", None) or "12:00") if settings else "12:00"
    try:
        return datetime.strptime(raw, "%H:%M").time()
    except ValueError:
        return time_cls(12, 0)


def _holiday_index(db) -> dict:
    """date string -> set of standards that are off that day ("All" covers every class)."""
    index = {}
    for holiday in db.query(Holiday).all():
        if not holiday.date:
            continue
        index.setdefault(holiday.date, set()).add(holiday.standard or "All")
    return index


def _is_holiday_for(index: dict, date_str: str, standard: str) -> bool:
    standards = index.get(date_str)
    if not standards:
        return False
    return "All" in standards or (standard or "11th") in standards


def compute_monthly_report(db, month: str, standard_filter: str = "All") -> dict:
    """
    Build the monthly summary for a "YYYY-MM" month. Mirrors reports.js so the
    workbook always agrees with what the Reports page shows.
    """
    try:
        parsed = datetime.strptime(month, "%Y-%m")
    except (ValueError, TypeError):
        raise ValueError("Invalid month. Use YYYY-MM.")

    _, last_day = calendar.monthrange(parsed.year, parsed.month)
    start = datetime.combine(parsed.date().replace(day=1), time_cls.min)
    end = datetime.combine(parsed.date().replace(day=last_day), time_cls.max)

    holiday_index = _holiday_index(db)

    # Active roster only: an archived (graduated) student would otherwise show
    # up every month with 0% attendance.
    students = (db.query(Student)
                .filter(Student.is_active == True)  # noqa: E712 — SQL boolean
                .order_by(Student.standard, Student.name).all())
    if standard_filter and standard_filter != "All":
        students = [s for s in students if (s.standard or "11th") == standard_filter]

    logs = (db.query(Attendance)
            .filter(Attendance.punch_time >= start, Attendance.punch_time <= end)
            .order_by(Attendance.punch_time.asc())
            .all())

    # Drop anything recorded on a day that turned out to be a holiday for that
    # student's class — a class-specific holiday must never count against the
    # other class.
    kept_logs = []
    for log in logs:
        student = log.student
        if not student:
            continue
        date_str = log.punch_time.date().isoformat()
        if _is_holiday_for(holiday_index, date_str, student.standard):
            continue
        kept_logs.append(log)

    unique_days = sorted({log.punch_time.date().isoformat() for log in kept_logs})

    working_days_cache = {}

    def working_days_for(standard: str) -> int:
        key = standard or "11th"
        if key not in working_days_cache:
            working_days_cache[key] = sum(
                1 for d in unique_days if not _is_holiday_for(holiday_index, d, key)
            )
        return working_days_cache[key]

    # Present dates and the per-day status grid, both keyed by ZK ID.
    present_dates = {s.zk_id: set() for s in students}
    grid = {s.zk_id: {} for s in students}

    for log in kept_logs:
        zk_id = log.student.zk_id
        if zk_id not in present_dates:
            continue  # filtered out by the standard selector
        date_str = log.punch_time.date().isoformat()
        if log.status != "Absent":
            present_dates[zk_id].add(date_str)
        # Logs are ascending, so the first record of the day wins the cell and a
        # later "Left" punch does not overwrite the morning Present/Late.
        existing = grid[zk_id].get(date_str)
        if existing is None or existing == "A":
            grid[zk_id][date_str] = STATUS_CODES.get(log.status, "?")

    rows = []
    total_expected = 0
    total_present = 0
    for s in students:
        student_working = working_days_for(s.standard)
        days_present = len(present_dates[s.zk_id])
        percentage = round(days_present / student_working * 100) if student_working else 0
        total_expected += student_working
        total_present += days_present
        rows.append({
            "zk_id": s.zk_id,
            "name": s.name,
            "standard": s.standard or "11th",
            "days_present": days_present,
            "working_days": student_working,
            "percentage": percentage,
        })

    if standard_filter and standard_filter != "All":
        headline_working_days = working_days_for(standard_filter)
    else:
        headline_working_days = len(unique_days)

    avg_present = round(total_present / total_expected * 100) if total_expected else 0

    return {
        "institute_name": _institute_name(db),
        "month": month,
        "standard_filter": standard_filter or "All",
        "working_days": headline_working_days,
        "avg_present_pct": avg_present,
        "avg_absent_pct": (100 - avg_present) if total_expected else 0,
        "dates": unique_days,
        "students": rows,
        "grid": grid,
        "logs": [{
            "date": log.punch_time.date().isoformat(),
            "time": log.punch_time.strftime("%H:%M:%S"),
            "zk_id": log.student.zk_id,
            "name": log.student.name,
            "standard": log.student.standard or "11th",
            "status": log.status,
            "is_manual": bool(log.is_manual),
        } for log in kept_logs],
    }


def compute_daily_report(db, date_str: str, standard_filter: str = "All") -> dict:
    """One row per student for a single date, with IN and OUT resolved."""
    try:
        target = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise ValueError("Invalid date. Use YYYY-MM-DD.")

    mid = _mid_time(db)
    holiday_index = _holiday_index(db)

    # Active roster only: an archived (graduated) student would otherwise show
    # up every month with 0% attendance.
    students = (db.query(Student)
                .filter(Student.is_active == True)  # noqa: E712 — SQL boolean
                .order_by(Student.standard, Student.name).all())
    if standard_filter and standard_filter != "All":
        students = [s for s in students if (s.standard or "11th") == standard_filter]

    logs = (db.query(Attendance)
            .filter(Attendance.punch_time >= datetime.combine(target, time_cls.min),
                    Attendance.punch_time <= datetime.combine(target, time_cls.max))
            .order_by(Attendance.punch_time.asc())
            .all())

    by_student = {}
    for log in logs:
        if not log.student:
            continue
        by_student.setdefault(log.student.zk_id, []).append(log)

    rows = []
    for s in students:
        on_holiday = _is_holiday_for(holiday_index, target.isoformat(), s.standard)
        student_logs = [] if on_holiday else by_student.get(s.zk_id, [])

        in_time = out_time = ""
        status = "Holiday" if on_holiday else "No Record"
        manual = False

        for log in student_logs:
            manual = manual or bool(log.is_manual)
            if log.status == "Absent":
                status = "Absent"
                continue
            if log.punch_time.time() < mid:
                if not in_time:
                    in_time = log.punch_time.strftime("%H:%M")
                    status = log.status
            else:
                out_time = log.punch_time.strftime("%H:%M")
                if not in_time:
                    status = log.status

        rows.append({
            "zk_id": s.zk_id,
            "name": s.name,
            "standard": s.standard or "11th",
            "in_time": in_time or "—",
            "out_time": out_time or "—",
            "status": status,
            "is_manual": manual,
        })

    return {
        "institute_name": _institute_name(db),
        "date": target.isoformat(),
        "standard_filter": standard_filter or "All",
        "students": rows,
    }


# ── Workbook construction ────────────────────────────────────────────────────

def _write_header_row(sheet, row_index: int, headers: list) -> None:
    for column, label in enumerate(headers, start=1):
        cell = sheet.cell(row=row_index, column=column, value=label)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER


def _autosize(sheet, minimum: int = 8, maximum: int = 42) -> None:
    """Approximate Excel's auto-fit; openpyxl cannot measure rendered text."""
    for column_cells in sheet.columns:
        longest = max((len(str(c.value)) for c in column_cells if c.value is not None), default=0)
        letter = get_column_letter(column_cells[0].column)
        sheet.column_dimensions[letter].width = max(minimum, min(maximum, longest + 3))


def _percentage_fill(percentage: int) -> PatternFill:
    if percentage >= 75:
        return FILL_GOOD
    if percentage >= 50:
        return FILL_WARN
    return FILL_BAD


def build_monthly_workbook(report: dict) -> bytes:
    """Three sheets: the summary table, a day-by-day grid, and the raw log."""
    workbook = Workbook()

    # ── Summary ──
    summary = workbook.active
    summary.title = "Summary"
    summary["A1"] = report["institute_name"]
    summary["A1"].font = TITLE_FONT
    summary["A2"] = "Monthly Attendance Summary"
    summary["A2"].font = Font(bold=True, size=11)
    summary["A3"] = (f"Month: {report['month']}    |    Standard: {report['standard_filter']}"
                     f"    |    Working days: {report['working_days']}")
    summary["A3"].font = SUBTITLE_FONT
    summary["A4"] = (f"Average attendance: {report['avg_present_pct']}%    |    "
                     f"Average absence: {report['avg_absent_pct']}%")
    summary["A4"].font = SUBTITLE_FONT

    headers = ["ZK ID", "Student Name", "Standard", "Days Present", "Working Days", "Attendance %"]
    _write_header_row(summary, 6, headers)

    for offset, row in enumerate(report["students"], start=7):
        summary.cell(row=offset, column=1, value=row["zk_id"])
        summary.cell(row=offset, column=2, value=row["name"])
        summary.cell(row=offset, column=3, value=row["standard"])
        summary.cell(row=offset, column=4, value=row["days_present"])
        summary.cell(row=offset, column=5, value=row["working_days"])
        percent_cell = summary.cell(row=offset, column=6, value=row["percentage"] / 100)
        percent_cell.number_format = "0%"
        percent_cell.fill = _percentage_fill(row["percentage"])
        for column in range(1, 7):
            summary.cell(row=offset, column=column).border = THIN_BORDER

    _autosize(summary)
    summary.freeze_panes = "A7"
    if report["students"]:
        summary.auto_filter.ref = f"A6:F{6 + len(report['students'])}"

    # ── Day-by-day grid ──
    grid_sheet = workbook.create_sheet("Daily Grid")
    grid_sheet["A1"] = f"{report['institute_name']} — Day-by-day attendance ({report['month']})"
    grid_sheet["A1"].font = TITLE_FONT
    grid_sheet["A2"] = "P = Present, L = Late, LE = Left Early, O = Left, A = Absent, - = no record"
    grid_sheet["A2"].font = SUBTITLE_FONT

    dates = report["dates"]
    # Only the day-of-month is shown in the header; the full month is in the title.
    grid_headers = ["ZK ID", "Student Name", "Standard"] + [d[-2:] for d in dates]
    _write_header_row(grid_sheet, 4, grid_headers)

    for offset, row in enumerate(report["students"], start=5):
        grid_sheet.cell(row=offset, column=1, value=row["zk_id"])
        grid_sheet.cell(row=offset, column=2, value=row["name"])
        grid_sheet.cell(row=offset, column=3, value=row["standard"])
        student_grid = report["grid"].get(row["zk_id"], {})
        for date_offset, date_str in enumerate(dates, start=4):
            code = student_grid.get(date_str, "-")
            cell = grid_sheet.cell(row=offset, column=date_offset, value=code)
            cell.alignment = Alignment(horizontal="center")
            cell.border = THIN_BORDER
            if code == "A":
                cell.fill = FILL_BAD
            elif code in ("L", "LE"):
                cell.fill = FILL_WARN
            elif code in ("P", "O"):
                cell.fill = FILL_GOOD

    _autosize(grid_sheet, minimum=5, maximum=30)
    for date_offset in range(4, 4 + len(dates)):
        grid_sheet.column_dimensions[get_column_letter(date_offset)].width = 5
    grid_sheet.freeze_panes = "D5"

    # ── Raw log ──
    log_sheet = workbook.create_sheet("Raw Log")
    log_headers = ["Date", "Time", "ZK ID", "Student Name", "Standard", "Status", "Entered By"]
    _write_header_row(log_sheet, 1, log_headers)
    for offset, entry in enumerate(report["logs"], start=2):
        log_sheet.cell(row=offset, column=1, value=entry["date"])
        log_sheet.cell(row=offset, column=2, value=entry["time"])
        log_sheet.cell(row=offset, column=3, value=entry["zk_id"])
        log_sheet.cell(row=offset, column=4, value=entry["name"])
        log_sheet.cell(row=offset, column=5, value=entry["standard"])
        log_sheet.cell(row=offset, column=6, value=entry["status"])
        log_sheet.cell(row=offset, column=7, value="Manual" if entry["is_manual"] else "Device")
    _autosize(log_sheet)
    log_sheet.freeze_panes = "A2"
    if report["logs"]:
        log_sheet.auto_filter.ref = f"A1:G{1 + len(report['logs'])}"

    return _workbook_bytes(workbook)


def build_daily_workbook(report: dict) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Daily Attendance"

    sheet["A1"] = report["institute_name"]
    sheet["A1"].font = TITLE_FONT
    sheet["A2"] = f"Daily Attendance — {report['date']}"
    sheet["A2"].font = Font(bold=True, size=11)
    sheet["A3"] = f"Standard: {report['standard_filter']}"
    sheet["A3"].font = SUBTITLE_FONT

    headers = ["ZK ID", "Student Name", "Standard", "IN Time", "OUT Time", "Status", "Entered By"]
    _write_header_row(sheet, 5, headers)

    for offset, row in enumerate(report["students"], start=6):
        sheet.cell(row=offset, column=1, value=row["zk_id"])
        sheet.cell(row=offset, column=2, value=row["name"])
        sheet.cell(row=offset, column=3, value=row["standard"])
        sheet.cell(row=offset, column=4, value=row["in_time"])
        sheet.cell(row=offset, column=5, value=row["out_time"])
        status_cell = sheet.cell(row=offset, column=6, value=row["status"])
        sheet.cell(row=offset, column=7, value="Manual" if row["is_manual"] else "Device")
        if row["status"] in ("Absent", "No Record"):
            status_cell.fill = FILL_BAD
        elif row["status"] in ("Late", "Left Early"):
            status_cell.fill = FILL_WARN
        elif row["status"] in ("Present", "Left"):
            status_cell.fill = FILL_GOOD
        for column in range(1, 8):
            sheet.cell(row=offset, column=column).border = THIN_BORDER

    _autosize(sheet)
    sheet.freeze_panes = "A6"
    if report["students"]:
        sheet.auto_filter.ref = f"A5:G{5 + len(report['students'])}"

    return _workbook_bytes(workbook)


def _workbook_bytes(workbook: Workbook) -> bytes:
    stream = io.BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def to_base64(payload: bytes) -> str:
    """Encode for the JSAPI.save_file bridge, which takes base64 text."""
    return base64.b64encode(payload).decode("ascii")
