/* --- file: static/script.js --- */
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

    // Page-specific initializations
    initializeFileUpload();
    initializeTabSwitching();
    updateServiceCardState();
    initializeInterviewListeners(); // New listener setup

    // Activate the first tab on service pages by default
    const firstTabLink = document.querySelector('.service-sidebar .tab-link');
    if (firstTabLink) {
        switchTab(firstTabLink.getAttribute('data-tab'));
    }
});

// --- THEME MANAGEMENT ---
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
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
        themeIcons[0].style.display = theme === 'light' ? 'inline' : 'none'; // Moon
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


// --- LANDING PAGE: FILE UPLOAD ---
function initializeFileUpload() {
    const cvUploadInput = document.getElementById('cvUpload');
    // This function only runs if the upload box is on the page
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
            // Scroll to services section after a short delay
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
    const serviceCards = document.querySelectorAll('.service-card');
    if (serviceCards.length === 0) return;

    fetch('/check-cv-status')
        .then(response => response.json())
        .then(data => {
            const isCvUploaded = data.cv_uploaded;
            serviceCards.forEach(card => {
                const button = card.querySelector('.service-btn');
                if (isCvUploaded) {
                    card.style.opacity = '1';
                    card.style.pointerEvents = 'auto';
                    if(button) button.disabled = false;
                } else {
                    card.style.opacity = '0.6';
                    card.style.pointerEvents = 'none';
                    if(button) button.disabled = true;
                }
            });
        });
}


// --- SERVICE PAGES: TAB SWITCHING ---
function initializeTabSwitching() {
    const tabLinks = document.querySelectorAll('.tab-link');
    if (tabLinks.length === 0) return; // Only run on service pages

    tabLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const targetTabId = e.target.closest('a').getAttribute('data-tab');
            switchTab(targetTabId);
        });
    });
}

function switchTab(tabId) {
    const tabContainer = document.querySelector('.service-content');
    if (!tabContainer || !tabId) return;

    // Hide all tab content
    tabContainer.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Deactivate all tab links
    document.querySelectorAll('.tab-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show the target tab content and activate its link
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
function analyzeCV() {
    const jobDesc = document.getElementById('reviewJobDescription').value;
    const resultsContainer = document.getElementById('review-results');
    showLoader(resultsContainer);
    fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'review', job_description: jobDesc })
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
    // Use fallback empty arrays to prevent 'map' of undefined error
    const strengths = data.strengths || [];
    const weaknesses = data.weaknesses || [];
    const recommendations = data.recommendations || [];
    const missingKeywords = data.missing_keywords || [];

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
            <div class="result-category">
                <h4><span class="icon">🔍</span> Missing Keywords</h4>
                <ul>${missingKeywords.length > 0 ? missingKeywords.map(k => `<li>${k}</li>`).join('') : '<li>No missing keywords identified. Good match!</li>'}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">🚀</span> Actionable Recommendations</h4>
                <ul>${recommendations.length > 0 ? recommendations.map(r => `<li>${r}</li>`).join('') : '<li>No specific recommendations.</li>'}</ul>
            </div>
        </div>
    `;
}

function scanATS() {
    const resultsContainer = document.getElementById('ats-results');
    showLoader(resultsContainer);
    fetch('/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_type: 'ats', job_description: '' }) // Job description is not needed here
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        renderAtsResults(data);
        showNotification('ATS Scan complete!', 'success');
    })
    .catch(err => {
        showErrorInContainer(resultsContainer, err);
        showNotification(`Error: ${err.message}`, 'error');
    });
}

function renderAtsResults(data) {
    const container = document.getElementById('ats-results');
    if (!container) return;
    const atsScore = parseInt(data.ats_score, 10) || 0;
    // Use fallback empty arrays
    const formatIssues = data.format_issues || [];
    const improvements = data.improvements || [];

    container.innerHTML = `
        <div class="score-circle" style="--progress-value: ${atsScore};">
             <span class="score-value">${atsScore}%</span>
        </div>
        <p class="keyword-score"><strong>Overall ATS Compatibility Score</strong></p>
        <div class="review-details">
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
            // Send on Enter, but allow Shift+Enter for new lines
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
    
    showLoader(setupContainer); // Show loader while waiting for the first question
    
    fetch('/start-mock-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_description: jobDesc })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) throw new Error(data.error);
        
        setupContainer.style.display = 'none'; // Hide setup
        chatContainer.style.display = 'flex'; // Show chat
        document.getElementById('interviewFeedback').style.display = 'none';
        
        addMessageToChat('interviewer', data.question);
        updateQuestionCounter(data.question_number, data.total_questions);
    })
    .catch(err => {
        showErrorInContainer(setupContainer, err); // Show error in the setup container
        showNotification(`Error: ${err.message}`, 'error')
    });
}

function sendResponse() {
    const input = document.getElementById('responseInput');
    const answer = input.value.trim();
    if (!answer) return;

    addMessageToChat('user', answer);
    input.value = '';
    input.disabled = true;
    document.querySelector('.chat-send').disabled = true;


    fetch('/submit-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: answer })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errorData => {
                throw new Error(errorData.report_error || errorData.error || 'Server error');
            });
        }
        return response.json();
    })
    .then(data => {
        input.disabled = false;
        document.querySelector('.chat-send').disabled = false;
        if (data.success && data.question) {
            addMessageToChat('interviewer', data.question);
            updateQuestionCounter(data.question_number, data.total_questions);
        } else if (data.success && data.report) {
            renderInterviewReport(data.report);
            showNotification('Interview complete! Here is your report.', 'success');
        } else {
            throw new Error(data.error || 'An unexpected response was received.');
        }
    })
    .catch(err => {
        renderInterviewReport({
            strengths: [],
            weaknesses: [`An error occurred: ${err.message}`],
            tips: ["Please try starting a new interview. The AI service may be unavailable."]
        });
        input.disabled = false;
        document.querySelector('.chat-send').disabled = false;
    });
}

function endInterview() {
    const chatContainer = document.getElementById('interviewChat');
    const feedbackContainer = document.getElementById('interviewFeedback');
    
    if(!chatContainer || !feedbackContainer) return;

    chatContainer.style.display = 'none';
    feedbackContainer.style.display = 'block';
    showLoader(feedbackContainer); // Show loader while fetching the final report

    fetch('/end-mock-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errorData => {
                throw new Error(errorData.report_error || errorData.error || 'Server error');
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.success && data.report) {
            renderInterviewReport(data.report);
            showNotification('Interview ended. Here is your report.', 'success');
        } else {
            throw new Error(data.error || 'Could not retrieve the interview report.');
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
    // Sanitize text to prevent HTML injection
    const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
    messageDiv.innerHTML = `
        <div class="message-avatar">${sender === 'interviewer' ? '🤖' : '👤'}</div>
        <div class="message-content"><p>${sanitizedText.replace(/\n/g, '<br>')}</p></div>
    `;
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
    container.innerHTML = `
        <div class="review-details">
            <div class="result-category">
                <h4><span class="icon">💬</span> General Questions</h4>
                <ul>${(data.General || []).map(q => `<li>${q}</li>`).join('')}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">⭐</span> Behavioral Questions</h4>
                <ul>${(data.Behavioral || []).map(q => `<li>${q}</li>`).join('')}</ul>
            </div>
            <div class="result-category">
                <h4><span class="icon">💻</span> Technical Questions</h4>
                <ul>${(data.Technical || []).map(q => `<li>${q}</li>`).join('')}</ul>
            </div>
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
    container.innerHTML = `
        <h4>Answer Templates for: "${data.question}"</h4>
        ${(data.answers || []).map((ans, i) => `
            <div class="template-answer">
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

// --- UTILITY FUNCTIONS ---

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    // Use a class for styling
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);
    // Trigger animation
    setTimeout(() => { notification.classList.add('show'); }, 10);

    // Remove after duration
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => document.body.removeChild(notification), 500);
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

    fetch('/download-cv', { // This endpoint works for any text-to-pdf
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv_content: content })
    })
    .then(response => {
        if (!response.ok) {
             // Try to get a more specific error message from the response body if possible
            return response.json().then(err => { throw new Error(err.error || 'PDF generation failed on server.') });
        }
        if (response.headers.get("Content-Type") !== "application/pdf") {
            throw new Error('Server did not return a valid PDF file.');
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
    .catch(err => showNotification(`Download Error: ${err.message}`, 'error'));
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