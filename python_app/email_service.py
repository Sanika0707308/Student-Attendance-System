import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from structlog import get_logger
from database import SessionLocal, SystemSettings

logger = get_logger()

def send_email_notification(student_name, punch_time, parent_email, action="IN"):
    
    if not parent_email:
        logger.error("No parent email")
        return False

    subject = "उपस्थिती सूचना: विद्यामंदिर इन्स्टिट्यूट"

    # ✅ Proper action-based messages
    if action == "ABSENT":
        body = f"प्रिय पालक,\n\nआपले पाल्य {student_name} आज दिनांक {punch_time.strftime('%Y-%m-%d')} रोजी अकॅडमीमध्ये गैरहजर होते.\n\nधन्यवाद.\nSTC's विद्यामंदिर इन्स्टिट्यूट"

    elif action == "EARLY_EXIT":
        body = f"प्रिय पालक,\n\nआपले पाल्य {student_name} आज {punch_time.strftime('%Y-%m-%d')} रोजी {punch_time.strftime('%I:%M %p')} वाजता लवकर अकॅडमीमधून निघाले.\n\nधन्यवाद.\nSTC's विद्यामंदिर इन्स्टिट्यूट"

    elif action == "OUT":
        body = f"प्रिय पालक,\n\nआपले पाल्य {student_name} आज {punch_time.strftime('%Y-%m-%d')} रोजी {punch_time.strftime('%I:%M %p')} वाजता अकॅडमीमधून निघाले.\n\nधन्यवाद.\nSTC's विद्यामंदिर इन्स्टिट्यूट"

    else:  # IN
        body = f"प्रिय पालक,\n\nआपले पाल्य {student_name} आज {punch_time.strftime('%Y-%m-%d')} रोजी {punch_time.strftime('%I:%M %p')} वाजता अकॅडमीमध्ये उपस्थित झाले.\n\nधन्यवाद.\nSTC's विद्यामंदिर इन्स्टिट्यूट"

    logger.info(f"Sending email to {parent_email} for {student_name} ({action})")

    try:
        db = SessionLocal()
        try:
            settings = db.query(SystemSettings).first()
        finally:
            db.close()

        if not settings or not settings.smtp_email or not settings.smtp_password:
            logger.error("SMTP settings missing")
            return False

        # ✅ Create email
        msg = MIMEMultipart()
        msg['From'] = settings.smtp_email
        msg['To'] = parent_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain', 'utf-8'))

        # ✅ Send email
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(settings.smtp_email, settings.smtp_password)
            server.sendmail(settings.smtp_email, parent_email, msg.as_string())

        logger.info("Email sent successfully")
        return True

    except Exception as e:
        logger.error(f"Error: {e}")
        return False