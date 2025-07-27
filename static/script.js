// =================================================================
//                 CareerCraft Pro - Main Script
//
// This script is designed for a Multi-Page Application.
// It checks for the existence of elements before manipulating them
// to avoid errors on pages where those elements are not present.
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Global initializations (run on every page)
    initializeTheme();
    initializeNavigation();
    initializeFAQ(); 

    // Page-specific initializations
    initializeFileUpload();
    initializeTabSwitching();
    updateServiceCardState();
    initializeInterviewListeners(); 

    // Activate the first tab on service pages by default
    const firstTabLink = document.querySelector('.service-sidebar .tab-link');
    if (firstTabLink && !document.querySelector('.service-sidebar .tab-link.active')) {
        switchTab(firstTabLink.getAttribute('data-tab'));
    }
});


// --- FAQ ACCORDION ---
function initializeFAQ() {
    const faqItems = document.querySelectorAll('.faq-item');
    if (faqItems.length === 0) return;

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        question.addEventListener('click', () => {
            item.classList.toggle('active');
        });
    });
}


// --- THEME MANAGEMENT ---
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

function toggleTheme() {
    const newTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const themeIcons = document.querySelectorAll('.theme-icon');
    if (themeIcons.length > 1) {
        themeIcons[0].style.display = theme === 'dark' ? 'none' : 'inline'; // Moon
        themeIcons[1].style.display = theme === 'dark' ? 'inline' : 'none';  // Sun
    }
}


// --- NAVIGATION ---
function initializeNavigation() {
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            navMenu.classList.toggle('mobile-active');
        });
    }
}

function navigateToService(service) {
    const servicePageUrl = {
        'cv': '/cv-services',
        'job-matcher': '/job-matcher',
        'interview': '/interview-preparation',
        'upskilling': '/upskilling'
    }[service];

    if (servicePageUrl) {
        window.location.href = servicePageUrl;
    }
}

function showLandingPage() {
    window.location.href = '/';
}

function scrollToUpload() {
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
        uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}


// --- LANDING PAGE: FILE UPLOAD & SERVICE UNLOCKING ---
function initializeFileUpload() {
    const cvUploadInput = document.getElementById('cvUpload');
    if (!cvUploadInput) return;

    const uploadBox = document.getElementById('uploadBox');
    uploadBox.addEventListener('dragover', e => e.preventDefault());
    uploadBox.addEventListener('dragleave', e => e.preventDefault());
    uploadBox.addEventListener('drop', e => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
            cvUploadInput.files = e.dataTransfer.files;
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });
}

function handleFileUpload(file) {
    if (!file) return;

    showNotification('Uploading and processing your CV...', 'info');
    const formData = new FormData();
    formData.append('cv_file', file);

    fetch('/upload-cv', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('CV uploaded successfully!', 'success');
            const uploadBox = document.getElementById('uploadBox');
            const uploadSuccess = document.getElementById('uploadSuccess');
            if (uploadBox && uploadSuccess) {
                uploadBox.style.display = 'none';
                uploadSuccess.style.display = 'block';
            }
            updateServiceCardState();
            setTimeout(() => {
                const servicesSection = document.getElementById('services');
                if (servicesSection) {
                    servicesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 500);
        } else {
            showNotification(data.error || 'An unknown error occurred.', 'error');
        }
    })
    .catch(error => {
        showNotification('Error uploading CV. Please try again.', 'error');
        console.error('Upload error:', error);
    });
}

function updateServiceCardState() {
    const serviceButtons = document.querySelectorAll('.service-btn');
    if (serviceButtons.length === 0) return;

    fetch('/check-cv-status')
        .then(response => response.json())
        .then(data => {
            const isCvUploaded = data.cv_uploaded;
            serviceButtons.forEach(button => {
                button.disabled = !isCvUploaded;
            });
        });
}


// --- SERVICE PAGES: TAB SWITCHING ---
function initializeTabSwitching() {
    const tabLinks = document.querySelectorAll('.tab-link');
    if (tabLinks.length === 0) return; 

    tabLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const targetTabId = e.currentTarget.getAttribute('data-tab');
            switchTab(targetTabId);
        });
    });
}

function switchTab(tabId) {
    const tabContainer = document.querySelector('.service-content');
    if (!tabContainer || !tabId) return;

    tabContainer.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));

    const targetContent = document.getElementById(tabId);
    const targetLink = document.querySelector(`.tab-link[data-tab="${tabId}"]`);
    if (targetContent) targetContent.classList.add('active');
    if (targetLink) targetLink.classList.add('active');
}


// --- API CALL & RENDERING FUNCTIONS ---
function showLoader(container) {
    container.innerHTML = '<div class="loader"></div>';
}

function showErrorInContainer(container, error) {
    container.innerHTML = `<div class="placeholder">An error occurred: ${error.message}. Please try again.</div>`;
}

// CV Services
function analyzeGeneralReview() {
    const resultsContainer = document.getElementById('review-results');
    showLoader(resultsContainer);
    fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'review', job_description: '' })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        renderReviewResults(data);
        showNotification('Analysis complete!', 'success');
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderReviewResults(data) {
    const container = document.getElementById('review-results');
    if (!container) return;
    const score = parseInt(data.score, 10) || 0;
    const strengths = data.strengths || [];
    const weaknesses = data.weaknesses || [];
    const recommendations = data.recommendations || [];
    const missingKeywords = data.missing_keywords || [];

    const keywordsHtml = missingKeywords.length > 0 ? `
        <div class="result-category">
            <h4><span class="icon">🔍</span> Missing Keywords</h4>
            <ul>${missingKeywords.map(k => `<li>${k}</li>`).join('')}</ul>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="score-circle" style="--progress-value: ${score};">
            <span class="score-value">${score}%</span>
        </div>
        <div class="review-details">
            <div class="result-category">
                <h4><span class="icon">👍</span> Strengths</h4>
                <ul>${strengths.length > 0 ? strengths.map(s => `<li>${s}</li>`).join('') : '<li>No specific strengths identified.</li>'}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">🤔</span> Areas for Improvement</h4>
                <ul>${weaknesses.length > 0 ? weaknesses.map(w => `<li>${w}</li>`).join('') : '<li>No major weaknesses identified.</li>'}</ul>
            </div>
            ${keywordsHtml}
            <div class="result-category">
                <h4><span class="icon">🚀</span> Actionable Recommendations</h4>
                <ul>${recommendations.length > 0 ? recommendations.map(r => `<li>${r}</li>`).join('') : '<li>No specific recommendations.</li>'}</ul>
            </div>
        </div>
    `;
}

function scanATSAndKeywords() {
    const jobDesc = document.getElementById('atsJobDescription').value;
    if (!jobDesc.trim()) {
        showNotification('Please paste a job description for a keyword match.', 'warning');
        return;
    }
    const resultsContainer = document.getElementById('ats-results');
    showLoader(resultsContainer);

    const atsPromise = fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'ats' })
    }).then(res => res.json());

    const reviewPromise = fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'review', job_description: jobDesc })
    }).then(res => res.json());

    Promise.all([atsPromise, reviewPromise])
    .then(([atsData, reviewData]) => {
        if (atsData.error || reviewData.error) {
            throw new Error(atsData.error || reviewData.error);
        }
        renderCombinedATSResults(atsData, reviewData);
        showNotification('Comprehensive scan complete!', 'success');
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderCombinedATSResults(atsData, reviewData) {
    const container = document.getElementById('ats-results');
    if (!container) return;

    const atsScore = parseInt(atsData.ats_score, 10) || 0;
    const formatIssues = atsData.format_issues || [];
    const improvements = atsData.improvements || [];
    const missingKeywords = reviewData.missing_keywords || [];

    container.innerHTML = `
        <div class="score-circle" style="--progress-value: ${atsScore};">
             <span class="score-value">${atsScore}%</span>
        </div>
        <p class="keyword-score"><strong>Overall ATS Compatibility Score</strong></p>
        <div class="review-details">
            <div class="result-category">
                <h4><span class="icon">🔍</span> Missing Keywords from Job Description</h4>
                <ul>${missingKeywords.length > 0 ? missingKeywords.map(k => `<li>${k}</li>`).join('') : '<li>No missing keywords identified. Good match!</li>'}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">📄</span> Formatting & Structural Issues</h4>
                <ul>${formatIssues.length > 0 ? formatIssues.map(i => `<li>${i}</li>`).join('') : '<li>No major formatting issues found. Good job!</li>'}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">✨</span> Recommended Improvements</h4>
                <ul>${improvements.length > 0 ? improvements.map(i => `<li>${i}</li>`).join('') : '<li>Your CV seems well-optimized for parsing.</li>'}</ul>
            </div>
        </div>
    `;
}

function rewriteCV() {
    const resultsContainer = document.getElementById('rewriter-output');
    showLoader(resultsContainer);
    fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'rewrite' })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        renderRewriteResults(data);
        showNotification('CV rewrite complete!', 'success');
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderRewriteResults(data) {
    const container = document.getElementById('rewriter-output');
    if (!container) return;
    container.innerHTML = `
        <div class="result-header">
            <h4>Improved CV Content</h4>
            <button class="copy-btn" onclick="copyToClipboard('rewritten-cv-text')" title="Copy to Clipboard">📋</button>
        </div>
        <pre id="rewritten-cv-text">${data.improved_cv || 'No content generated.'}</pre>
        <h4>Changes Made</h4>
        <ul>${(data.changes_made || []).map(c => `<li>${c}</li>`).join('')}</ul>
        <button class="btn-primary" onclick="downloadContentAsPDF('rewritten-cv-text')">Download as PDF</button>
    `;
}

// ... (rest of the script.js file remains the same) ...

// Job Matcher
function analyzeMatch() {
    const jobDesc = document.getElementById('matcherJobDescription').value;
    if (!jobDesc.trim()) {
        showNotification('Please paste a job description.', 'warning');
        return;
    }
    const resultsContainer = document.getElementById('match-results');
    showLoader(resultsContainer);
    fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'job_match', job_description: jobDesc })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        renderMatchResults(data);
        showNotification('Job match analysis complete!', 'success');
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderMatchResults(data) {
    const container = document.getElementById('match-results');
    if(!container) return;
    const matchScore = parseInt(data.match_score, 10) || 0;
    container.innerHTML = `
        <div class="score-circle" style="--progress-value: ${matchScore};">
            <span class="score-value">${matchScore}%</span>
        </div>
        <h4>Gap Analysis</h4>
        <p>${data.gap_analysis || 'Not available.'}</p>
        <div class="review-details">
            <div class="result-category">
                <h4><span class="icon">✅</span> Matched Skills & Requirements</h4>
                <ul>${(data.matched_skills || []).map(s => `<li>${s}</li>`).join('')}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">❌</span> Missing Requirements</h4>
                <ul>${(data.missing_requirements || []).map(s => `<li>${s}</li>`).join('')}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">💡</span> Recommendations to Improve Match</h4>
                <ul>${(data.recommendations || []).map(r => `<li>${r}</li>`).join('')}</ul>
            </div>
        </div>
    `;
}

function generateEmail() {
    const emailType = document.getElementById('emailType').value;
    const context = document.getElementById('emailContext').value;
    const resultsContainer = document.getElementById('email-output');
    showLoader(resultsContainer);
    fetch('/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_type: emailType, context: context })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        renderEmailResults(data);
        showNotification('Email generated!', 'success');
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderEmailResults(data) {
    const container = document.getElementById('email-output');
    if (!container) return;
    const emailBody = `Subject: ${data.subject || ''}\n\n${data.email_body || ''}`;
    container.innerHTML = `
        <div class="result-header">
            <h4>Generated Email</h4>
            <button class="copy-btn" onclick="copyToClipboard('generated-email-text')" title="Copy to Clipboard">📋</button>
        </div>
        <pre id="generated-email-text">${emailBody}</pre>
        <h4>Tips for Sending</h4>
        <ul>${(data.tips || []).map(t => `<li>${t}</li>`).join('')}</ul>
        <button class="btn-primary" onclick="downloadContentAsPDF('generated-email-text')">Download as PDF</button>
    `;
}


// --- Interview Prep ---
function initializeInterviewListeners() {
    const responseInput = document.getElementById('responseInput');
    if (responseInput) {
        responseInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault(); 
                sendResponse();
            }
        });
    }
}

function startInterview() {
    const jobDesc = document.getElementById('mockJobDescription').value;
    const setupContainer = document.getElementById('interviewSetup');
    const chatContainer = document.getElementById('interviewChat');
    
    if(!setupContainer || !chatContainer) return;
    
    showLoader(setupContainer);
    
    fetch('/start-mock-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_description: jobDesc })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        setupContainer.style.display = 'none';
        chatContainer.style.display = 'flex';
        document.getElementById('interviewFeedback').style.display = 'none';
        
        addMessageToChat('interviewer', data.question);
        updateQuestionCounter(data.question_number, data.total_questions);
    })
    .catch(err => {
        setupContainer.innerHTML = `
           <div class="content-header">
               <h2>AI Mock Interview</h2>
               <p>Practice with our AI interviewer and get real-time feedback. Provide an optional job description for tailored questions.</p>
           </div>
           <div class="input-group">
               <label for="mockJobDescription">Job Description (Optional)</label>
               <textarea id="mockJobDescription" placeholder="Paste a job description for a more relevant interview..."></textarea>
           </div>
           <button class="btn-primary" onclick="startInterview()">Start Mock Interview</button>
        `;
        showErrorInContainer(setupContainer, err);
        showNotification(`Error: ${err.message}`, 'error')
    });
}

function sendResponse() {
    const input = document.getElementById('responseInput');
    const sendButton = document.querySelector('.chat-send');
    const answer = input.value.trim();
    if (!answer) return;

    addMessageToChat('user', answer);
    input.value = '';
    input.disabled = true;
    if(sendButton) sendButton.disabled = true;

    fetch('/submit-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: answer })
    })
    .then(response => response.json())
    .then(data => {
        input.disabled = false;
        if(sendButton) sendButton.disabled = false;
        input.focus();

        if (data.success && data.question) {
            addMessageToChat('interviewer', data.question);
            updateQuestionCounter(data.question_number, data.total_questions);
        } else if (data.success && data.report) {
            renderInterviewReport(data.report);
            showNotification('Interview complete! Here is your report.', 'success');
        } else {
            throw new Error(data.report_error || data.error || 'An unexpected response was received.');
        }
    })
    .catch(err => {
        addMessageToChat('interviewer', `An error occurred: ${err.message}. Please try ending the interview to get a report on your completed questions, or reload to start over.`);
        input.disabled = false;
        if(sendButton) sendButton.disabled = false;
    });
}

function endInterview() {
    const chatContainer = document.getElementById('interviewChat');
    const feedbackContainer = document.getElementById('interviewFeedback');
    if(!chatContainer || !feedbackContainer) return;

    chatContainer.style.display = 'none';
    feedbackContainer.style.display = 'block';
    showLoader(feedbackContainer);

    fetch('/end-mock-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.report) {
            renderInterviewReport(data.report);
            showNotification('Interview ended. Here is your report.', 'success');
        } else {
            throw new Error(data.report_error || data.error || 'Could not retrieve the interview report.');
        }
    })
    .catch(err => {
        renderInterviewReport({
            strengths: [],
            weaknesses: [`An error occurred while generating the report: ${err.message}`],
            tips: ["Your interview progress might not have been saved. Please try again."]
        });
    });
}

function renderInterviewReport(report) {
    const chatContainer = document.getElementById('interviewChat');
    const reportContainer = document.getElementById('interviewFeedback');
    if(!chatContainer || !reportContainer) return;

    chatContainer.style.display = 'none';
    reportContainer.style.display = 'block';

    const strengths = report.strengths || [];
    const weaknesses = report.weaknesses || [];
    const tips = report.tips || [];

    reportContainer.innerHTML = `
        <h3>Interview Performance Report</h3>
        <div class="review-details">
            <div class="result-category">
                <h4><span class="icon">👍</span> Strengths</h4>
                <ul>${strengths.length > 0 ? strengths.map(s => `<li>${s}</li>`).join('') : '<li>No specific strengths were identified.</li>'}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">🤔</span> Areas for Improvement</h4>
                <ul>${weaknesses.length > 0 ? weaknesses.map(w => `<li>${w}</li>`).join('') : '<li>No specific weaknesses were identified.</li>'}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">🚀</span> Actionable Tips</h4>
                <ul>${tips.length > 0 ? tips.map(t => `<li>${t}</li>`).join('') : '<li>No specific tips were generated.</li>'}</ul>
            </div>
        </div>
        <button class="btn-primary" onclick="window.location.reload()" style="margin-top: 2rem;">Start New Interview</button>
    `;
}

function addMessageToChat(sender, text) {
    const chatBox = document.getElementById('chatMessages');
    if (!chatBox) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const contentP = document.createElement('p');
    contentP.textContent = text; 
    contentP.innerHTML = contentP.innerHTML.replace(/\n/g, '<br>');

    messageDiv.innerHTML = `
        <div class="message-avatar">${sender === 'interviewer' ? '🤖' : '👤'}</div>
        <div class="message-content"></div>
    `;
    messageDiv.querySelector('.message-content').appendChild(contentP);

    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function updateQuestionCounter(current, total) {
    const counter = document.getElementById('questionCounter');
    if(counter) counter.textContent = `Question ${current} of ${total}`;
}

function loadInterviewQuestions() {
    const jobDesc = document.getElementById('questionsJobDescription').value;
    const resultsContainer = document.getElementById('questions-list');
    showLoader(resultsContainer);
    fetch('/generate-interview-questions-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_description: jobDesc })
    })
    .then(r => r.json()).then(data => {
        if (data.error) throw new Error(data.error);
        renderQuestionList(data);
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error')
    });
}

function renderQuestionList(data) {
    const container = document.getElementById('questions-list');
    if (!container) return;
    const general = data.General || [];
    const behavioral = data.Behavioral || [];
    const technical = data.Technical || [];

    container.innerHTML = `
        <div class="review-details">
            ${general.length > 0 ? `<div class="result-category"><h4><span class="icon">💬</span> General Questions</h4><ul>${general.map(q => `<li>${q}</li>`).join('')}</ul></div>` : ''}
            ${behavioral.length > 0 ? `<div class="result-category"><h4><span class="icon">⭐</span> Behavioral Questions</h4><ul>${behavioral.map(q => `<li>${q}</li>`).join('')}</ul></div>` : ''}
            ${technical.length > 0 ? `<div class="result-category"><h4><span class="icon">💻</span> Technical Questions</h4><ul>${technical.map(q => `<li>${q}</li>`).join('')}</ul></div>` : ''}
        </div>
    `;
}

function getAnswerTemplate() {
    const question = document.getElementById('templateQuestion').value;
    if (!question.trim()) {
        showNotification('Please enter a question.', 'warning');
        return;
    }
    const resultsContainer = document.getElementById('template-results');
    showLoader(resultsContainer);
    fetch('/answer-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question })
    })
    .then(r => r.json()).then(data => {
        if(data.error) throw new Error(data.error);
        renderAnswerTemplates(data);
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderAnswerTemplates(data) {
    const container = document.getElementById('template-results');
    if(!container) return;
    const questionText = document.createElement('span');
    questionText.textContent = data.question; // Sanitize
    container.innerHTML = `
        <h4>Answer Templates for: "${questionText.innerHTML}"</h4>
        ${(data.answers || []).map((ans, i) => `
            <div class="result-card">
                <strong>Template ${i+1}:</strong>
                <p>${ans.replace(/\n/g, '<br>')}</p>
            </div>
        `).join('')}
    `;
}

// Upskilling
function loadCareerPaths() {
    const resultsContainer = document.getElementById('career-paths-results');
    showLoader(resultsContainer);
    fetch('/career-paths', { method: 'POST' })
    .then(r => r.json()).then(data => {
        if(data.error) throw new Error(data.error);
        renderCareerPaths(data);
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderCareerPaths(data) {
    const container = document.getElementById('career-paths-results');
    if(!container) return;
    container.innerHTML = (data.career_paths || []).map(path => `
        <div class="result-card">
            <h4><span class="icon">🛤️</span> ${path.path}</h4>
            <p><strong>Required Skills:</strong> ${(path.required_skills || []).join(', ')}</p>
            <p><strong>How to transition:</strong></p>
            <ul>${(path.transition_steps || []).map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
    `).join('');
}

function loadProjectSuggestions() {
    const resultsContainer = document.getElementById('project-suggestions-results');
    showLoader(resultsContainer);
    fetch('/project-suggestions', { method: 'POST' })
    .then(r => r.json()).then(data => {
        if(data.error) throw new Error(data.error);
        renderProjectSuggestions(data);
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderProjectSuggestions(data) {
    const container = document.getElementById('project-suggestions-results');
    if(!container) return;
    container.innerHTML = (data.projects || []).map(p => `
        <div class="result-card">
            <h4><span class="icon">💡</span> ${p.idea}</h4>
            <p><strong>Skills you'll develop:</strong> ${(p.skills_developed || []).join(', ')}</p>
            <p><strong>Estimated time:</strong> ${p.estimated_time}</p>
        </div>
    `).join('');
}

function loadMiniCourse() {
    const resultsContainer = document.getElementById('mini-course-results');
    showLoader(resultsContainer);
    fetch('/mini-course', { method: 'POST' })
    .then(r => r.json()).then(data => {
        if(data.error) throw new Error(data.error);
        renderMiniCourse(data);
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderMiniCourse(data) {
    const container = document.getElementById('mini-course-results');
    if(!container) return;
    container.innerHTML = `
        <div class="result-card">
            <h3><span class="icon">🎓</span> ${data.title || 'Personalized Course'}</h3>
            <p>${data.description || ''}</p>
            <h4>Learning Objectives</h4>
            <ul>${(data.objectives || []).map(o => `<li>${o}</li>`).join('')}</ul>
            <h4>Course Modules</h4>
            <ul>${(data.modules || []).map(m => `<li>${m}</li>`).join('')}</ul>
        </div>
    `;
}


function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);
    setTimeout(() => { notification.classList.add('show'); }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => { if (notification.parentNode) document.body.removeChild(notification); }, 500);
    }, 4000);
}

function downloadContentAsPDF(elementId) {
    const contentElement = document.getElementById(elementId);
    if (!contentElement) {
        showNotification('Content to download not found.', 'error');
        return;
    }
    const content = contentElement.innerText;
    const filename = 'CareerCraft_Document.pdf';
    showNotification('Generating PDF...', 'info');

    fetch('/download-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv_content: content })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().catch(() => response.text()).then(errorBody => {
                const errorMessage = errorBody.error || errorBody.message || (typeof errorBody === 'string' && errorBody.substring(0, 100)) || 'Unknown server error';
                throw new Error(errorMessage);
            });
        }
        if (response.headers.get("Content-Type") !== "application/pdf") {
            return response.json().then(err => {
                throw new Error(err.error || 'Server did not return a valid PDF file.');
            });
        }
        return response.blob();
    })
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showNotification('PDF downloaded!', 'success');
    })
    .catch(err => {
        showNotification(`Download Error: ${err.message}`, 'error');
        console.error('Download error:', err);
    });
}


function copyToClipboard(elementId) {
    const textElement = document.getElementById(elementId);
    if (!textElement) {
        showNotification('Error: Content to copy not found.', 'error');
        return;
    }
    const textToCopy = textElement.innerText;
    navigator.clipboard.writeText(textToCopy).then(() => {
        showNotification('Copied to clipboard!', 'success');
    }).catch(err => {
        showNotification('Failed to copy text.', 'error');
        console.error('Clipboard error:', err);
    });
}