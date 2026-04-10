import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from structlog import get_logger
from database import SessionLocal, SystemSettings
from crypto_utils import decrypt_password

logger = get_logger()

def send_email_notification(student_name: str, punch_time, parent_email: str, action: str = "marked attendance at", smtp_server=None) -> bool:
    """
    Sends an Email to the parent when the student punches in/out.
    Returns True if sent successfully, False otherwise.
    Allows passing an existing smtp_server to reuse connections.
    """
    if not parent_email:
        logger.error(f"No parent email provided for {student_name}")
        return False

    subject = "उपस्थिती सूचना: विद्यामंदिर इन्स्टिट्यूट"
    
    # Marathi Message Templates (Unfied with Router Statuses)
    # Ensure action strings match the ones expected by parents
    if "गैरहजर" in action or "Absent" in action:
        body = (
            f"प्रिय पालक,\n\n"
            f"आपणास कळविण्यात येते की, आपले पाल्य {student_name} आज दिनांक {punch_time.strftime('%Y-%m-%d')} "
            f"रोजी अकॅडमीमध्ये गैरहजर असल्याचे आढळले आहे.\n\n"
            f"आपल्या पाल्याच्या उपस्थितीची ही नोंद आपल्या माहितीसाठी पाठविण्यात येत आहे.\n\n"
            f"कृपया ही माहिती नोंद करून घ्यावी.\n\n"
            f"धन्यवाद.\n"
            f"STC's विद्यामंदिर इन्स्टिट्यूट"
        )
    else:
        body = (
            f"प्रिय पालक,\n\n"
            f"आपणास कळविण्यात येते की, आपले पाल्य {student_name} आज दिनांक {punch_time.strftime('%Y-%m-%d')} "
            f"रोजी {punch_time.strftime('%I:%M %p')} वाजता सुरक्षितपणे अकॅडमीमध्ये {action}.\n\n"
            f"आपल्या पाल्याच्या उपस्थितीची ही नोंद आपल्या माहितीसाठी पाठविण्यात येत आहे.\n\n"
            f"कृपया ही माहिती नोंद करून घ्यावी.\n\n"
            f"धन्यवाद.\n"
            f"STC's विद्यामंदिर इन्स्टिट्यूट"
        )
    
    logger.info(f"PREPARING TO SEND EMAIL to {parent_email}: {student_name} {action}")

    internal_server = False
    try:
        db = SessionLocal()
        try:
            settings = db.query(SystemSettings).first()
        finally:
            db.close()
        
        if not settings or not settings.smtp_email or not settings.smtp_password:
            logger.error("SMTP Settings are missing. Cannot send email.")
            return False

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
            server.quit()
        
        logger.info(f"Email sent successfully to {parent_email}")
        return True

    except Exception as e:
        logger.error(f"Exception while sending Email: {e}")
        return False