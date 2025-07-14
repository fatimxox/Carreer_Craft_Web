import os
import json
import re
import logging
import uuid
from io import BytesIO
from datetime import datetime, timedelta, UTC

# --- Core Flask and Dependencies ---
from flask import Flask, render_template, request, jsonify, session, send_file
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename

# --- Document Processing ---
import PyPDF2
import docx
import pdfkit
from docx import Document
from docx.shared import Pt

# --- AI Integration ---Carreer_Craft_Web
import google.generativeai as genai

# ==============================================================================
# 1. APPLICATION SETUP & CONFIGURATION
# ==============================================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'your-secret-key-change-this')
app.config['SESSION_TYPE'] = 'filesystem'

# Configure Gemini API


# --- File Upload Configuration ---
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# --- Database Configuration ---
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///site.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- Gemini API Configuration ---
# IMPORTANT: The application's AI features will NOT work without this key set in your environment.
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'AIzaSyD0_YCI7NUgRDx-tZ-vGXCIwrAah6G9D4w')  # Replace with your actual API key
AI_FEATURES_ENABLED = bool(GEMINI_API_KEY)
if AI_FEATURES_ENABLED:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-1.5-flash')
        logger.info("Gemini AI features are ENABLED.")
    except Exception as e:
        model = None
        AI_FEATURES_ENABLED = False
        logger.error(f"Failed to configure Gemini AI. Features DISABLED. Error: {e}")
else:
    model = None
    logger.warning("AI Features are DISABLED. No Gemini API key found in environment variables.")

# ==============================================================================
# 2. DATABASE MODELS
# ==============================================================================

class CVData(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cv_text = db.Column(db.Text, nullable=False)
    upload_time = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(UTC))

class MockInterviewSession(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cv_data_id = db.Column(db.String(36), db.ForeignKey('cv_data.id'), nullable=False)
    questions = db.Column(db.Text, nullable=False)
    history = db.Column(db.Text, nullable=False, default='[]')
    current_index = db.Column(db.Integer, nullable=False, default=0)
    start_time = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(UTC))

# ==============================================================================
# 3. HELPER FUNCTIONS
# ==============================================================================

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in {'pdf', 'docx', 'txt'}

def extract_text_from_file(file_path):
    ext = file_path.rsplit('.', 1)[1].lower()
    text = ""
    try:
        if ext == 'pdf':
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    text += page.extract_text() or ""
        elif ext == 'docx':
            doc_obj = docx.Document(file_path)
            for para in doc_obj.paragraphs:
                text += para.text + '\n'
        elif ext == 'txt':
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
    except Exception as e:
        logger.error(f"Error extracting text from {file_path}: {e}")
    return text

def get_cv_text_from_db():
    cv_id = session.get('cv_id')
    if not cv_id: return None
    cv_data = db.session.get(CVData, cv_id)
    if not cv_data:
        session.pop('cv_id', None)
        return None
    return cv_data.cv_text

def get_interview_session_data(timeout_hours=4):
    session_id = session.get('interview_session_id')
    if not session_id: return None
    interview_session = db.session.get(MockInterviewSession, session_id)
    if not interview_session:
        session.pop('interview_session_id', None)
        return None
    
    # FIX: Make the naive datetime from the DB "aware" by setting its timezone to UTC.
    session_start_time_aware = interview_session.start_time.replace(tzinfo=UTC)

    if session_start_time_aware < (datetime.now(UTC) - timedelta(hours=timeout_hours)):
        logger.warning(f"Deleting expired interview session: {session_id}")
        db.session.delete(interview_session)
        db.session.commit()
        session.pop('interview_session_id', None)
        return None
        
    return {
        'id': interview_session.id,
        'questions': json.loads(interview_session.questions),
        'history': json.loads(interview_session.history),
        'current_index': interview_session.current_index,
    }

def clean_api_response(response_text):
    return re.sub(r'^```json\n|\n```$', '', response_text, flags=re.MULTILINE).strip()

# ==============================================================================
# 4. AI-POWERED GENERATION FUNCTIONS
# ==============================================================================

def handle_ai_call(prompt, function_name):
    if not AI_FEATURES_ENABLED:
        return {"error": "AI features are currently unavailable. The server's API key may be missing."}
    try:
        response = model.generate_content(prompt)
        if not response.parts:
             raise ValueError("AI call blocked due to safety settings or other policy issues.")
        return json.loads(clean_api_response(response.text))
    except (json.JSONDecodeError, ValueError) as e:
        logger.error(f"AI JSON Parsing Error in {function_name}: {e}. Raw response: '{getattr(response, 'text', 'N/A')}'")
        return {"error": f"Failed to parse AI response. Details: {e}", "raw_response": getattr(response, 'text', '')}
    except Exception as e:
        logger.error(f"AI General Error in {function_name}: {e}")
        return {"error": f"An unexpected error occurred with the AI service: {e}", "raw_response": getattr(e, 'message', '')}

def analyze_cv_with_gemini(cv_text, analysis_type="review", job_description=""):
    prompts = {
        "review": f"Act as a professional CV reviewer. Analyze this CV against the provided job description. The JSON object must contain keys: 'score' (integer 0-100), 'strengths' (list of strings), 'weaknesses' (list of strings), 'missing_keywords' (list of strings of important keywords from the job description that are absent in the CV), and 'recommendations' (list of strings). CV: {cv_text}\nJob Description: {job_description}",
        "ats": f"Act as an Applicant Tracking System (ATS) simulator. Analyze this CV *only* for technical and formatting compatibility. Do not analyze content for a specific job. Provide the analysis as a JSON object with keys: 'ats_score' (integer 0-100 reflecting overall parseability and ATS-friendliness), 'format_issues' (list of strings detailing problems like complex tables, headers/footers, non-standard fonts, etc.), and 'improvements' (list of strings suggesting structural changes for better machine readability). CV: {cv_text}",
        "job_match": f"Act as a career coach. Compare this CV against the job description and calculate a match score. Provide the output as a JSON object with keys: 'match_score' (integer 0-100), 'gap_analysis' (a brief string paragraph), 'matched_skills' (list of strings), 'missing_requirements' (list of strings), and 'recommendations' (list of strings). CV: {cv_text}\nJob Description: {job_description}",
        "rewrite": f"Act as a professional CV writer. Rewrite the content of this CV to be more impactful and ATS-friendly. Provide the output as a JSON object with two keys: 'improved_cv' (a single string with the full rewritten CV text) and 'changes_made' (a list of strings detailing the key improvements). CV: {cv_text}"
    }
    return handle_ai_call(prompts.get(analysis_type, prompts["review"]), "analyze_cv_with_gemini")

def generate_email_with_gemini(email_type, context):
    prompt = f"Generate a professional '{email_type}' email based on the provided context. The output must be a valid JSON object with three keys: 'subject' (string), 'email_body' (string, using \\n for new lines), and 'tips' (list of strings for the user). Context: {context}"
    return handle_ai_call(prompt, "generate_email_with_gemini")

def generate_interview_questions_list(cv_text, job_description=""):
    prompt = f"Generate interview questions based on the CV and Job Description. Provide 3-5 questions for each category: General, Technical, and Behavioral. Format as a valid JSON object with 'General', 'Technical', and 'Behavioral' as keys, each containing a list of strings. CV: {cv_text} Job Description: {job_description}"
    return handle_ai_call(prompt, "generate_interview_questions_list")

def generate_answer_templates_with_gemini(cv_text, question):
    prompt = f"Generate 2-3 diverse answer templates for the interview question below, tailored to the provided CV. Use the STAR method where appropriate. Format as a valid JSON object with a 'question' key (string) and an 'answers' key (list of strings). CV: {cv_text} Question: {question}"
    return handle_ai_call(prompt, "generate_answer_templates_with_gemini")

def recommend_career_paths_with_gemini(cv_text):
    prompt = f"Analyze this CV and recommend 3 distinct career paths. For each path, describe required skills and actionable transition steps. Format as a valid JSON object with a 'career_paths' key, which is a list of objects. Each object must have 'path', 'required_skills' (list), and 'transition_steps' (list). CV: {cv_text}"
    return handle_ai_call(prompt, "recommend_career_paths_with_gemini")

def suggest_projects_with_gemini(cv_text):
    prompt = f"Based on the skills in this CV, suggest 3 impactful project ideas to strengthen it. Format as a valid JSON object with a 'projects' key, containing a list of objects. Each object must have 'idea', 'skills_developed' (list), and 'estimated_time'. CV: {cv_text}"
    return handle_ai_call(prompt, "suggest_projects_with_gemini")

def generate_mini_course_with_gemini(cv_text):
    prompt = f"Generate a personalized mini-course outline to fill a potential skill gap from this CV. Format as a valid JSON object with keys: 'title', 'description', 'objectives' (list), and 'modules' (list). CV: {cv_text}"
    return handle_ai_call(prompt, "generate_mini_course_with_gemini")

def analyze_interview_answers(interview_history):
    if not interview_history:
        return {'strengths': [], 'weaknesses': [], 'tips': ['No answers were provided to analyze.']}
    formatted_history = "\n".join([f"Q: {item['question']}\nA: {item['answer']}" for item in interview_history])
    prompt = f"Analyze the following interview transcript and provide a constructive performance review. Format as a JSON object with 'strengths' (list), 'weaknesses' (list), and 'tips' (list) keys. Transcript: {formatted_history}"
    return handle_ai_call(prompt, "analyze_interview_answers")

# ==============================================================================
# 5. PDF GENERATION
# ==============================================================================

# IMPORTANT NOTE: PDF generation requires the 'wkhtmltopdf' utility to be installed on the system
# and accessible in the system's PATH. If it's not installed, this function will fail.
# See: https://wkhtmltopdf.org/downloads.html
def generate_ats_pdf(text_content: str) -> BytesIO:
    html_template = f"""
    <html><head><style>
        body {{ font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; white-space: pre-wrap; }}
    </style></head><body>{text_content}</body></html>"""
    try:
        # The 'False' argument tells pdfkit to return the PDF as a byte string
        pdf = pdfkit.from_string(html_template, False)
        return BytesIO(pdf)
    except OSError as e:
        # This error block is triggered if wkhtmltopdf is not found.
        logger.error(f"pdfkit PDF generation failed: {e}. Check that wkhtmltopdf is installed and in your system's PATH.")
        error_html = f"<html><body><h1>PDF Generation Failed</h1><p>Error: {e}</p><p>This feature requires the 'wkhtmltopdf' command-line tool. Please ensure it is installed and accessible via the system's PATH.</p></body></html>"
        # Return a PDF containing the error message.
        error_pdf = pdfkit.from_string(error_html, False)
        return BytesIO(error_pdf)

# ==============================================================================
# 6. PAGE-RENDERING ROUTES
# ==============================================================================

@app.route('/')
def land_page():
    return render_template('land_page.html')

@app.route('/cv-services')
def cv_services():
    return render_template('cv_services.html')

@app.route('/job-matcher')
def job_matcher():
    return render_template('job_matcher.html')

@app.route('/interview-preparation')
def interview_preparation():
    return render_template('interview_preparation.html')

@app.route('/upskilling')
def upskilling():
    return render_template('upskilling.html')

# ==============================================================================
# 7. API ENDPOINTS
# ==============================================================================

@app.route('/upload-cv', methods=['POST'])
def upload_cv():
    if 'cv_file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400
    file = request.files['cv_file']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid or no file selected'}), 400

    filename = secure_filename(file.filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    try:
        file.save(file_path)
        cv_text = extract_text_from_file(file_path)
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

    if not cv_text or not cv_text.strip():
        return jsonify({'error': 'Could not extract text from the uploaded file.'}), 400

    try:
        new_cv = CVData(cv_text=cv_text)
        db.session.add(new_cv)
        db.session.commit()
        session['cv_id'] = new_cv.id
        logger.info(f"CV uploaded successfully and stored with ID: {new_cv.id}")
        return jsonify({'success': True, 'message': 'CV processed successfully.'})
    except Exception as e:
        db.session.rollback()
        logger.error(f"Database error on CV upload: {e}")
        return jsonify({'error': 'Failed to save CV data.'}), 500

@app.route('/check-cv-status', methods=['GET'])
def check_cv_status():
    cv_uploaded = get_cv_text_from_db() is not None
    return jsonify({'cv_uploaded': cv_uploaded, 'ai_enabled': AI_FEATURES_ENABLED})

# --- CV Services & Job Matcher ---
@app.route('/analyze-cv', methods=['POST'])
def analyze_cv_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'CV not found. Please upload it first.'}), 400
    
    req_data = request.json
    analysis_type = req_data.get('analysis_type')
    job_description = req_data.get('job_description', '')
    
    if not analysis_type: return jsonify({'error': 'Analysis type not specified.'}), 400
    
    result = analyze_cv_with_gemini(cv_text, analysis_type, job_description)
    if 'error' in result:
        return jsonify(result), 500
    return jsonify(result)

@app.route('/generate-email', methods=['POST'])
def generate_email_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'CV not found. Please upload it first.'}), 400
    
    req_data = request.json
    email_type = req_data.get('email_type')
    context = req_data.get('context', '')
    
    if not email_type: return jsonify({'error': 'Email type not specified.'}), 400
    
    full_context = f"CV Text: {cv_text}\nAdditional Info: {context}"
    result = generate_email_with_gemini(email_type, full_context)
    if 'error' in result:
        return jsonify(result), 500
    return jsonify(result)

@app.route('/download-cv', methods=['POST'])
def download_cv_as_pdf():
    content = request.json.get('cv_content')
    if not content: return jsonify({'error': 'No content provided'}), 400
    
    pdf_buffer = generate_ats_pdf(content)
    pdf_buffer.seek(0)
    
    return send_file(pdf_buffer, as_attachment=True, download_name='generated_document.pdf', mimetype='application/pdf')

# --- Interview Prep ---
@app.route('/start-mock-interview', methods=['POST'])
def start_mock_interview():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'CV not found.'}), 400
    if not AI_FEATURES_ENABLED: return jsonify({"error": "AI features are unavailable."}), 503

    job_description = request.json.get('job_description', '')
    question_result = generate_interview_questions_list(cv_text, job_description)

    if 'error' in question_result: return jsonify(question_result), 500

    all_questions = (question_result.get('General', []) + question_result.get('Technical', []) + question_result.get('Behavioral', []))
    if not all_questions: return jsonify({'error': 'The AI could not generate interview questions.'}), 500

    try:
        new_interview = MockInterviewSession(cv_data_id=session['cv_id'], questions=json.dumps(all_questions))
        db.session.add(new_interview)
        db.session.commit()
        session['interview_session_id'] = new_interview.id
        return jsonify({'success': True, 'question': all_questions[0], 'question_number': 1, 'total_questions': len(all_questions)})
    except Exception as e:
        db.session.rollback()
        logger.error(f"DB error starting mock interview: {e}")
        return jsonify({'error': 'Failed to create the interview session in the database.'}), 500

@app.route('/submit-answer', methods=['POST'])
def submit_answer():
    interview_data = get_interview_session_data()
    if not interview_data: return jsonify({'report_error': 'Interview session has expired or was not found.'}), 400

    session_id = interview_data['id']
    user_answer = request.json.get('answer', '').strip()
    if not user_answer: return jsonify({'error': 'Answer cannot be empty.'}), 400

    interview_db = db.session.get(MockInterviewSession, session_id)
    current_question = interview_data['questions'][interview_data['current_index']]
    interview_data['history'].append({"question": current_question, "answer": user_answer})
    
    interview_db.history = json.dumps(interview_data['history'])
    interview_db.current_index += 1
    db.session.commit()

    if interview_db.current_index < len(interview_data['questions']):
        return jsonify({'success': True, 'question': interview_data['questions'][interview_db.current_index], 'question_number': interview_db.current_index + 1, 'total_questions': len(interview_data['questions'])})
    else:
        report = analyze_interview_answers(interview_data['history'])
        db.session.delete(interview_db)
        db.session.commit()
        session.pop('interview_session_id', None)
        if 'error' in report: return jsonify({'report_error': report['error']}), 500
        return jsonify({'success': True, 'report': report})

@app.route('/end-mock-interview', methods=['POST'])
def end_mock_interview():
    interview_data = get_interview_session_data()
    if not interview_data: return jsonify({'success': True, 'report': {'strengths': [], 'weaknesses': [], 'tips': ['Interview session timed out or was not found.']}})

    session_id = interview_data['id']
    interview_db = db.session.get(MockInterviewSession, session_id)
    report = analyze_interview_answers(interview_data['history'])
    
    db.session.delete(interview_db)
    db.session.commit()
    session.pop('interview_session_id', None)
    
    if 'error' in report: return jsonify({'report_error': report['error']}), 500
    return jsonify({'success': True, 'report': report})

@app.route('/generate-interview-questions-list', methods=['POST'])
def generate_interview_questions_list_api():
    cv_text = get_cv_text_from_db();
    if not cv_text: return jsonify({'error': 'No CV uploaded.'}), 400
    result = generate_interview_questions_list(cv_text, request.json.get('job_description', ''))
    if 'error' in result: return jsonify(result), 500
    return jsonify(result)

@app.route('/answer-template', methods=['POST'])
def answer_template_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'No CV uploaded.'}), 400
    question = request.json.get('question', '').strip()
    if not question: return jsonify({'error': 'Question is required.'}), 400
    result = generate_answer_templates_with_gemini(cv_text, question)
    if 'error' in result: return jsonify(result), 500
    return jsonify(result)

# --- Upskilling ---
@app.route('/career-paths', methods=['POST'])
def career_paths_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'No CV uploaded.'}), 400
    result = recommend_career_paths_with_gemini(cv_text)
    if 'error' in result: return jsonify(result), 500
    return jsonify(result)

@app.route('/project-suggestions', methods=['POST'])
def project_suggestions_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'No CV uploaded.'}), 400
    result = suggest_projects_with_gemini(cv_text)
    if 'error' in result: return jsonify(result), 500
    return jsonify(result)

@app.route('/mini-course', methods=['POST'])
def mini_course_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'No CV uploaded.'}), 400
    result = generate_mini_course_with_gemini(cv_text)
    if 'error' in result: return jsonify(result), 500
    return jsonify(result)

# ==============================================================================
# 8. APP INITIALIZATION & CLEANUP
# ==============================================================================

def cleanup_old_data(cv_days_old=1, interview_hours_old=4):
    with app.app_context():
        try:
            cv_threshold = datetime.now(UTC) - timedelta(days=cv_days_old)
            interview_threshold = datetime.now(UTC) - timedelta(hours=interview_hours_old)
            
            num_cv = db.session.query(CVData).filter(CVData.upload_time < cv_threshold).delete()
            num_int = db.session.query(MockInterviewSession).filter(MockInterviewSession.start_time < interview_threshold).delete()
            
            db.session.commit()
            if num_cv > 0 or num_int > 0:
                logger.info(f"Cleanup: Deleted {num_cv} old CVs and {num_int} old interviews.")
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error during database cleanup: {e}")

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        cleanup_old_data()
    app.run(debug=True, host='0.0.0.0', port=5001)