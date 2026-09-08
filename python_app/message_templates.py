"""
Parent-notification message templates.

Up to 2.0 the email body was hardcoded in `email_service.py` and only the short
status phrase ("आला/आली आहे") was configurable through the `msg_*` settings.
That meant an institute could change five words and nothing else — not the
greeting, not the sign-off, not the sentence structure.

Now the *whole* body is a template per status, stored in settings, with
placeholders filled in at send time. The `msg_*` settings are kept and surface
as the `{status}` placeholder, so an existing 1.9 customisation keeps working
and produces a byte-identical email after the upgrade.
"""

from __future__ import annotations

# ── Placeholders ─────────────────────────────────────────────────────────────
# Documented here and shown in the Settings UI. Anything not in this list is
# left alone in the rendered output rather than raising — a stray "{" typed into
# the template must never stop a parent notification from going out.

PLACEHOLDERS = [
    ("{student}", "Student's full name"),
    ("{status}", "Short status phrase from the Status Words section"),
    ("{status_en}", "Raw status in English (Present / Late / Absent / Left Early / Left)"),
    ("{date}", "Date of the punch, YYYY-MM-DD"),
    ("{date_marathi}", "Date of the punch in Marathi digits and month name"),
    ("{time}", "Time of the punch, e.g. 09:15 AM"),
    ("{institute}", "Institute name from Settings"),
    ("{standard}", "Student's class"),
]

# Statuses the attendance engine produces, mapped to the settings column that
# holds each one's body template and each one's short phrase.
STATUS_FIELDS = {
    "Present": ("tpl_present", "msg_present"),
    "Late": ("tpl_late", "msg_late"),
    "Absent": ("tpl_absent", "msg_absent"),
    "Left Early": ("tpl_left_early", "msg_left_early"),
    "Left": ("tpl_left", "msg_left"),
}

DEFAULT_SUBJECT = "उपस्थिती सूचना: {institute}"

# Default short status phrases — unchanged from 1.9.
DEFAULT_STATUS_WORDS = {
    "msg_present": "आला/आली आहे (Present)",
    "msg_late": "उशिरा आला/आली आहे (Late Comer)",
    "msg_absent": "गैरहजर आहे (Absent)",
    "msg_left_early": "लवकर गेला/गेली आहे (Left Early)",
    "msg_left": "गेला/गेली आहे (Left)",
}

# The two bodies 1.9 hardcoded, verbatim, with the interpolated values replaced
# by placeholders. Absent has no meaningful punch time (the row is created by
# the auto-absence sweep, not by the device), which is why it is the one status
# whose default body omits {time}.
_BODY_WITH_TIME = (
    "प्रिय पालक,\n\n"
    "आपणास कळविण्यात येते की, आपले पाल्य {student} आज दिनांक {date} "
    "रोजी {time} वाजता सुरक्षितपणे अकॅडमीमध्ये {status}.\n\n"
    "आपल्या पाल्याच्या उपस्थितीची ही नोंद आपल्या माहितीसाठी पाठविण्यात येत आहे.\n\n"
    "कृपया ही माहिती नोंद करून घ्यावी.\n\n"
    "धन्यवाद.\n"
    "{institute}"
)

_BODY_WITHOUT_TIME = (
    "प्रिय पालक,\n\n"
    "आपणास कळविण्यात येते की, आपले पाल्य {student} आज दिनांक {date} "
    "रोजी अकॅडमीमध्ये {status}.\n\n"
    "आपल्या पाल्याच्या उपस्थितीची ही नोंद आपल्या माहितीसाठी पाठविण्यात येत आहे.\n\n"
    "कृपया ही माहिती नोंद करून घ्यावी.\n\n"
    "धन्यवाद.\n"
    "{institute}"
)

DEFAULT_TEMPLATES = {
    "tpl_present": _BODY_WITH_TIME,
    "tpl_late": _BODY_WITH_TIME,
    "tpl_absent": _BODY_WITHOUT_TIME,
    "tpl_left_early": _BODY_WITH_TIME,
    "tpl_left": _BODY_WITH_TIME,
}

# ── Marathi date rendering ───────────────────────────────────────────────────

_MARATHI_DIGITS = str.maketrans("0123456789", "०१२३४५६७८९")

_MARATHI_MONTHS = [
    "जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून",
    "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर",
]


def to_marathi_digits(text: str) -> str:
    """Convert ASCII digits to Devanagari digits."""
    return str(text).translate(_MARATHI_DIGITS)


def format_marathi_date(punch_time) -> str:
    """e.g. '२५ ऑगस्ट २०२६' — used by the {date_marathi} placeholder."""
    try:
        month = _MARATHI_MONTHS[punch_time.month - 1]
        return f"{to_marathi_digits(punch_time.day)} {month} {to_marathi_digits(punch_time.year)}"
    except Exception:
        return ""


# ── Rendering ────────────────────────────────────────────────────────────────


def build_context(student_name: str, punch_time, status: str, status_phrase: str,
                  institute_name: str, standard: str = "") -> dict:
    """Assemble the placeholder values for one notification."""
    date_str = time_str = marathi_date = ""
    if punch_time is not None:
        try:
            date_str = punch_time.strftime("%Y-%m-%d")
            time_str = punch_time.strftime("%I:%M %p")
            marathi_date = format_marathi_date(punch_time)
        except Exception:
            pass

    return {
        "student": student_name or "",
        "status": status_phrase or status or "",
        "status_en": status or "",
        "date": date_str,
        "date_marathi": marathi_date,
        "time": time_str,
        "institute": institute_name or "",
        "standard": standard or "",
    }


def render(template: str, context: dict) -> str:
    """
    Fill `{name}` placeholders from `context`.

    Deliberately a plain loop of str.replace rather than str.format: the
    templates are typed by a school administrator, so an unbalanced brace or an
    unknown `{foo}` is likely. format() would raise on those and silently drop
    the notification; this leaves the unknown text as-is and still sends.
    """
    if not template:
        return ""
    out = str(template)
    for key, value in context.items():
        out = out.replace("{" + key + "}", str(value))
    return out


def template_for_status(settings, status: str) -> str:
    """The configured body for this status, falling back to the shipped default."""
    tpl_field, _ = STATUS_FIELDS.get(status, ("tpl_present", "msg_present"))
    configured = (getattr(settings, tpl_field, None) or "").strip() if settings else ""
    return configured or DEFAULT_TEMPLATES.get(tpl_field, _BODY_WITH_TIME)


def status_phrase_for_status(settings, status: str) -> str:
    """The configured short phrase for this status ({status} placeholder)."""
    _, msg_field = STATUS_FIELDS.get(status, ("tpl_present", "msg_present"))
    configured = (getattr(settings, msg_field, None) or "").strip() if settings else ""
    return configured or DEFAULT_STATUS_WORDS.get(msg_field, status)


def subject_for(settings) -> str:
    configured = (getattr(settings, "email_subject", None) or "").strip() if settings else ""
    return configured or DEFAULT_SUBJECT


def all_defaults() -> dict:
    """Everything the Settings page needs to offer a "restore defaults" button."""
    return {
        "email_subject": DEFAULT_SUBJECT,
        **DEFAULT_STATUS_WORDS,
        **DEFAULT_TEMPLATES,
    }
