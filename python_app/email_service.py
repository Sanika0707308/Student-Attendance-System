import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from structlog import get_logger
from database import SessionLocal, SystemSettings
from crypto_utils import decrypt_password
from message_templates import build_context, render, subject_for, template_for_status

logger = get_logger()

from typing import Tuple

def send_email_notification(student_name: str, punch_time, parent_email: str, action: str = "marked attendance at", smtp_server=None, status: str = None, standard: str = "") -> Tuple[bool, str]:
    """
    Sends an Email to the parent when the student punches in/out.
    Returns (True, "") if sent successfully, (False, error_reason) otherwise.
    Allows passing an existing smtp_server to reuse connections.

    `action` is the short status phrase (the `msg_*` setting). The surrounding
    body is no longer hardcoded here: since 2.0 the whole subject and body come
    from per-status templates in Settings, so an institute can rewrite the entire
    message instead of just those few words.
    """
    if not parent_email:
        err_msg = f"No parent email provided for {student_name}"
        logger.error(err_msg)
        return False, err_msg

    db = SessionLocal()
    try:
        settings = db.query(SystemSettings).first()
        institute_name = (settings.institute_name or "Biometric Attendance").strip() if settings else "Biometric Attendance"

        # Resolve the status. Older callers pass only `action`, so fall back to
        # sniffing it the way 1.9 did rather than defaulting everyone to Present.
        resolved_status = status
        if not resolved_status:
            resolved_status = "Absent" if ("गैरहजर" in action or "Absent" in action) else "Present"

        context = build_context(
            student_name=student_name,
            punch_time=punch_time,
            status=resolved_status,
            status_phrase=action,
            institute_name=institute_name,
            standard=standard,
        )
        subject = render(subject_for(settings), context)
        body = render(template_for_status(settings, resolved_status), context)
    finally:
        db.close()

    # A template emptied down to whitespace would send a blank email, which is
    # worse than sending nothing — surface it as a failure the admin can see in
    # the failed-emails list.
    if not body.strip():
        err_msg = f"Message template for status '{resolved_status}' is empty. Set it in Settings → Parent Message Templates."
        logger.error(err_msg)
        return False, err_msg
    if not subject.strip():
        subject = f"Attendance Notification: {institute_name}"

    logger.info(f"PREPARING TO SEND EMAIL to {parent_email}: {student_name} {action}")

    internal_server = False
    try:
        if not settings or not settings.smtp_email or not settings.smtp_password:
            err_msg = "SMTP Settings are missing. Cannot send email."
            logger.error(err_msg)
            return False, err_msg

        # Create the email message
        msg = MIMEMultipart()
        msg['From'] = settings.smtp_email
        msg['To'] = parent_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain', 'utf-8'))
        
        # Use existing server or create new one
        server = smtp_server
        if server is None:
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=30)
            server.starttls()
            server.login(settings.smtp_email, decrypt_password(settings.smtp_password))
            internal_server = True
            
        text = msg.as_string()
        server.sendmail(settings.smtp_email, parent_email, text)
        
        if internal_server:
            try:
                server.quit()
            except Exception:
                pass
        
        logger.info(f"Email sent successfully to {parent_email}")
        return True, ""

    except smtplib.SMTPAuthenticationError as e:
        err_msg = f"SMTP authentication failed: {e.smtp_error.decode('utf-8') if isinstance(e.smtp_error, bytes) else e.smtp_error}"
        logger.error(f"SMTP Authentication Error: {err_msg}")
        return False, err_msg
    except smtplib.SMTPRecipientsRefused as e:
        err_msg = f"Invalid recipient email: {list(e.recipients.keys())}"
        logger.error(f"SMTP Recipients Refused: {err_msg}")
        return False, err_msg
    except smtplib.SMTPConnectError as e:
        err_msg = f"Connection timeout: {str(e)}"
        logger.error(f"SMTP Connection Error: {err_msg}")
        return False, err_msg
    except smtplib.SMTPHeloError as e:
        err_msg = f"HELO command failed: {str(e)}"
        logger.error(f"SMTP HELO Error: {err_msg}")
        return False, err_msg
    except smtplib.SMTPSenderRefused as e:
        err_msg = f"Sender address refused: {str(e)}"
        logger.error(f"SMTP Sender Refused: {err_msg}")
        return False, err_msg
    except smtplib.SMTPDataError as e:
        err_msg = f"Gmail rejected the message: {str(e)}"
        logger.error(f"SMTP Data Error: {err_msg}")
        return False, err_msg
    except Exception as e:
        err_msg = f"Network error: {str(e)}"
        logger.error(f"Exception while sending Email: {err_msg}")
        return False, err_msg
