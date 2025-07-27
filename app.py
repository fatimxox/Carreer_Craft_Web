import os
import json
import re
import logging
import uuid
from io import BytesIO
from datetime import datetime, timedelta, UTC
from html import escape

# --- Core Flask and Dependencies ---
from flask import Flask, render_template, request, jsonify, session, send_file
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename

# --- Document Processing ---
import PyPDF2
import docx
import pdfkit # Requires wkhtmltopdf to be installed on the system

# --- AI Integration ---
import google.generativeai as genai

# ==============================================================================
# 1. APPLICATION SETUP & CONFIGURATION
# ==============================================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'your-secret-key-for-production')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///site.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- Gemini API Configuration ---
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'AIzaSyAYkR5arVG7lIGAd-Dl219gm6B-zXAgg9A')
AI_FEATURES_ENABLED = bool(GEMINI_API_KEY) and GEMINI_API_KEY != 'YOUR_API_KEY_HERE'

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
    logger.warning("AI Features are DISABLED. No valid Gemini API key found.")

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
    return cv_data.cv_text if cv_data else None

def get_interview_session_data(timeout_hours=4):
    session_id = session.get('interview_session_id')
    if not session_id: return None
    interview_session = db.session.get(MockInterviewSession, session_id)
    if not interview_session:
        session.pop('interview_session_id', None)
        return None
    
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
# 4. AI-POWERED GENERATION FUNCTIONS (WITH ENHANCED PROMPTS)
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
        return {"error": f"Failed to parse AI response. Please try again. Details: {e}", "raw_response": getattr(response, 'text', '')}
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

# **ENHANCED PROMPT**
def generate_interview_questions_list(cv_text, job_description=""):
    prompt = f"""
    Act as a senior hiring manager. Generate a balanced set of interview questions based on the provided CV and Job Description.
    Your goal is to create a realistic interview simulation.
    - Prioritize questions that merge the candidate's experience (from the CV) with the specific requirements and responsibilities of the Job Description.
    - Create scenario-based behavioral questions relevant to the role.
    - Create technical questions directly related to the skills listed in the job description.
    - Include 1-2 general/ice-breaker questions.
    Format the output as a valid JSON object with 'General', 'Technical', and 'Behavioral' as keys, each containing a list of 3-4 string questions.
    CV: {cv_text}
    Job Description: {job_description}
    """
    return handle_ai_call(prompt, "generate_interview_questions_list")

def generate_answer_templates_with_gemini(cv_text, question):
    prompt = f"Generate 2-3 diverse answer templates for the interview question below, tailored to the provided CV. Use the STAR method where appropriate. Format as a valid JSON object with a 'question' key (string) and an 'answers' key (list of strings). CV: {cv_text} Question: {question}"
    return handle_ai_call(prompt, "generate_answer_templates_with_gemini")

# **ENHANCED PROMPT**
def recommend_career_paths_with_gemini(cv_text):
    prompt = f"""
    Analyze this CV and recommend 3 distinct and actionable career paths. For each path, provide specific, modern advice.
    Format as a valid JSON object with a 'career_paths' key, which is a list of objects.
    Each object must have:
    - 'path': The job title/career path (e.g., "Product Manager", "DevOps Engineer").
    - 'required_skills': A list of 3-5 crucial skills needed for this role that may be a stretch from the current CV.
    - 'transition_steps': A list of concrete, actionable steps to take (e.g., "Complete the Google Project Management Certificate on Coursera", "Build a portfolio project using AWS Lambda and S3 to demonstrate serverless skills").
    CV: {cv_text}
    """
    return handle_ai_call(prompt, "recommend_career_paths_with_gemini")

# **ENHANCED PROMPT**
def suggest_projects_with_gemini(cv_text):
    prompt = f"""
    Based on the skills in this CV, suggest 3 modern, impactful project ideas to strengthen it for a job search.
    Format as a valid JSON object with a 'projects' key, containing a list of objects.
    Each object must have:
    - 'idea': A clear, concise project idea (e.g., "Full-Stack E-commerce API").
    - 'skills_developed': A list of specific, in-demand skills this project will develop (e.g., "REST API Design", "User Authentication with JWT", "Database Schema Design").
    - 'estimated_time': A realistic time estimate (e.g., "40-60 hours").
    Make the projects relevant to potential career growth based on the CV.
    CV: {cv_text}
    """
    return handle_ai_call(prompt, "suggest_projects_with_gemini")

# **ENHANCED PROMPT**
def generate_mini_course_with_gemini(cv_text):
    prompt = f"""
    Analyze the provided CV to identify a potential skill gap for career progression. Generate a personalized mini-course outline to fill that gap.
    The course should be practical and project-oriented.
    Format as a valid JSON object with keys:
    - 'title': A compelling course title (e.g., "From Developer to DevOps: A Practical Introduction").
    - 'description': A brief, motivating paragraph about the course.
    - 'objectives': A list of 3-4 clear learning objectives.
    - 'modules': A list of 4-5 module titles that represent a logical learning flow (e.g., "Module 1: CI/CD with GitHub Actions", "Module 2: Infrastructure as Code with Terraform").
    CV: {cv_text}
    """
    return handle_ai_call(prompt, "generate_mini_course_with_gemini")

# **ENHANCED PROMPT**
def analyze_interview_answers(interview_history):
    if not interview_history:
        return {'strengths': ["No answers were provided to analyze."], 'weaknesses': [], 'tips': []}
    formatted_history = "\n".join([f"Q: {item['question']}\nA: {item['answer']}" for item in interview_history])
    prompt = f"""
    Analyze the following interview transcript and provide a constructive performance review.
    Crucially, you *must* identify at least one 'strength'. If the answers are poor, find a positive aspect like "Good effort to structure the answer" or "Polite and professional tone". Do not leave the strengths list empty.
    For 'weaknesses', be specific and constructive.
    For 'tips', provide highly actionable advice.
    Format as a JSON object with 'strengths' (list of strings), 'weaknesses' (list of strings), and 'tips' (list of strings) keys.
    Transcript: {formatted_history}
    """
    return handle_ai_call(prompt, "analyze_interview_answers")

# ==============================================================================
# 5. PDF GENERATION (WITH ENHANCED "LATEX" STYLE)
# ==============================================================================
def generate_ats_pdf(text_content: str) -> BytesIO:
    safe_content = escape(text_content).replace('\n', '<br>')
    
    html_template = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>CareerCraft Pro Document</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
        <style>
            body {{
                font-family: 'EB Garamond', serif;
                font-size: 12pt;
                line-height: 1.6;
                color: #212121;
                margin: 2cm;
            }}
            pre {{
                font-family: 'EB Garamond', serif;
                white-space: pre-wrap;
                word-wrap: break-word;
                background-color: transparent;
                border: none;
                padding: 0;
                margin: 0;
                font-size: 12pt;
            }}
            h1, h2, h3, h4, strong {{
                font-family: 'Lato', sans-serif;
                font-weight: 700;
                color: #000;
            }}
            h4, strong {{
                 margin-top: 1em;
                 margin-bottom: 0.2em;
                 display: block;
                 font-size: 13pt;
                 border-bottom: 1px solid #ccc;
                 padding-bottom: 3px;
            }}
        </style>
    </head>
    <body>
        <h1>CareerCraft Pro Generated Document</h1>
        <pre>{safe_content}</pre>
    </body>
    </html>
    """
    try:
        # Options to ensure better rendering
        options = {
            'page-size': 'A4',
            'margin-top': '20mm',
            'margin-right': '20mm',
            'margin-bottom': '20mm',
            'margin-left': '20mm',
            'encoding': "UTF-8"
        }
        pdf = pdfkit.from_string(html_template, False, options=options)
        return BytesIO(pdf)
    except OSError as e:
        logger.error(f"pdfkit PDF generation failed: {e}. Check that wkhtmltopdf is installed and in your system's PATH.")
        error_html = f"<html><body><h1>PDF Generation Failed</h1><p>Error: {e}</p><p>This feature requires the 'wkhtmltopdf' command-line tool. Please ensure it is installed and accessible via the system's PATH.</p></body></html>"
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

    unique_filename = f"{uuid.uuid4()}_{secure_filename(file.filename)}"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
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

@app.route('/analyze-cv', methods=['POST'])
def analyze_cv_api():
    cv_text = get_cv_text_from_db()
    if not cv_text: return jsonify({'error': 'CV not found. Please upload it first.'}), 400
    req_data = request.json
    analysis_type = req_data.get('analysis_type')
    job_description = req_data.get('job_description', '')
    if not analysis_type: return jsonify({'error': 'Analysis type not specified.'}), 400
    
    result = analyze_cv_with_gemini(cv_text, analysis_type, job_description)
    if 'error' in result: return jsonify(result), 500
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
    if 'error' in result: return jsonify(result), 500
    return jsonify(result)

@app.route('/download-cv', methods=['POST'])
def download_cv_as_pdf():
    content = request.json.get('cv_content')
    if not content: return jsonify({'error': 'No content provided'}), 400
    
    try:
        pdf_buffer = generate_ats_pdf(content)
        pdf_buffer.seek(0)
        return send_file(pdf_buffer, as_attachment=True, download_name='CareerCraft_Document.pdf', mimetype='application/pdf')
    except Exception as e:
        # This catches errors from pdfkit if it's not installed, etc.
        logger.error(f"PDF generation route failed: {e}")
        return jsonify({'error': str(e)}), 500

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