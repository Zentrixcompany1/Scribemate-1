const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sections = {
  auth: document.getElementById('section-auth'),
  teacher: document.getElementById('section-teacher'),
  student: document.getElementById('section-student'),
  examDetail: document.getElementById('section-exam-detail'),
};
const navLogin = document.getElementById('nav-login');
const navDashboard = document.getElementById('nav-dashboard');
const navLogout = document.getElementById('nav-logout');
const voiceToggle = document.getElementById('voice-toggle');
const voiceStatus = document.getElementById('voice-status');
const toast = document.getElementById('toast');
let currentProfile = null;
let currentExam = null;
let currentQuestionIndex = 0;
let currentQuestionElements = [];
let voiceAssistantActive = false;
let dictationMode = false;
let speechRecognition = null;
let speechRecognitionSupported = false;
let speechSynthesisSupported = 'speechSynthesis' in window;
let audioContext = null;
let analyser = null;
let micStream = null;
let micRaf = null;
let committedAnswer = '';
let isRecognizing = false;

async function init() {
  bindEvents();
  initVoiceAssistant();
  // Auto signout on page refresh
  await supabaseClient.auth.signOut();
  showSection('auth');
}

function bindEvents() {
  navLogin.addEventListener('click', () => showSection('auth'));
  navDashboard.addEventListener('click', () => {
    if (currentProfile?.role === 'teacher') loadTeacherDashboard();
    else if (currentProfile?.role === 'student') loadStudentDashboard();
  });
  navLogout.addEventListener('click', logout);
  if (voiceToggle) {
    voiceToggle.addEventListener('click', toggleVoiceAssistant);
  }

  document.getElementById('form-login').addEventListener('submit', handleLogin);
  document.getElementById('form-register').addEventListener('submit', handleRegister);
  document.getElementById('form-create-exam').addEventListener('submit', handleCreateExam);
  document.getElementById('form-create-student').addEventListener('submit', handleCreateStudent);
  document.getElementById('form-submit-answer').addEventListener('submit', handleSubmitAnswer);
  document.getElementById('back-to-student').addEventListener('click', () => loadStudentDashboard());
}

function showSection(name) {
  Object.values(sections).forEach((section) => section.classList.add('hidden'));
  sections[name].classList.remove('hidden');
  navLogin.classList.toggle('hidden', !!currentProfile);
  navDashboard.classList.toggle('hidden', !currentProfile);
  navLogout.classList.toggle('hidden', !currentProfile);
  updateVoiceInterface();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3600);
}

function updateVoiceInterface() {
  if (!voiceToggle || !voiceStatus) return;
  const visible = !!currentProfile && speechRecognitionSupported;
  voiceToggle.classList.toggle('hidden', !visible);
  if (!visible) {
    voiceStatus.classList.add('hidden');
    voiceAssistantActive = false;
  }
}

function setVoiceStatus(text) {
  if (!voiceStatus) return;
  voiceStatus.textContent = text;
  voiceStatus.classList.remove('hidden');
}

const wakeWords = ['scribe', 'assistant', 'hey scribe', 'ok scribe'];

function initVoiceAssistant() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognitionSupported = Boolean(SpeechRecognition);
  if (!speechRecognitionSupported) return;

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'en-US';
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.maxAlternatives = 1;

  speechRecognition.addEventListener('result', (event) => {
    let transcript = '';
    
    // Get interim results for faster response
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    
    transcript = transcript.trim();
    if (!transcript) return;
    
    const normalized = transcript.toLowerCase();

    const hasWakeWord = wakeWords.some((word) => normalized.startsWith(word));
    const hasCommandKeyword = /\b(help|next|previous|back|read|submit|clear|dictate|write|stop|skip)\b/i.test(normalized);

    // Check for commands first, regardless of dictation mode
    if (hasCommandKeyword) {
      const cleaned = normalized.replace(new RegExp(`^(?:${wakeWords.join('|')})\s*`, 'i'), '').trim();
      handleVoiceCommand(cleaned);
      return;
    }

    // In dictation mode, show interim text immediately and commit on final
    if (dictationMode) {
      const answerField = document.getElementById('student-answer');
      if (answerField) {
        const lastResult = event.results[event.results.length - 1];
        const interimText = transcript;
        if (lastResult.isFinal) {
          // Commit final text to committedAnswer
          committedAnswer = `${committedAnswer}${committedAnswer ? ' ' : ''}${interimText}`.trim();
          answerField.value = committedAnswer;
        } else {
          // Show interim without committing
          answerField.value = `${committedAnswer}${committedAnswer ? ' ' : ''}${interimText}`.trim();
        }
      }
      return;
    }
  });

  speechRecognition.addEventListener('end', () => {
    if (voiceAssistantActive) {
      try {
        startRecognition();
      } catch (err) {
        console.warn('Recognition restart error', err);
      }
    }
  });

  speechRecognition.addEventListener('error', (event) => {
    if (event.error !== 'no-speech' && event.error !== 'audio-capture') {
      showToast('Voice error: ' + event.error);
    }
  });
}

function toggleVoiceAssistant() {
  if (!speechRecognitionSupported) {
    showToast('Voice commands are not supported in this browser.');
    return;
  }
  voiceAssistantActive = !voiceAssistantActive;
  dictationMode = false;
  if (voiceAssistantActive) {
    startRecognition();
    if (voiceToggle) voiceToggle.textContent = 'Stop Voice';
    setVoiceStatus('Voice assistant active');
    speakText('Voice assistant activated. Say Scribe before each command. Available commands include next question, skip question, previous question, read question, submit exam, clear answer, dictate answer, stop dictation, or help.');
  } else {
    stopRecognition();
    if (voiceToggle) voiceToggle.textContent = 'Voice Assist';
    setVoiceStatus('Voice assistant inactive');
  }
}

function startRecognition() {
  if (!speechRecognition) return;
  try {
    if (isRecognizing) return;
    isRecognizing = true;
    speechRecognition.start();
    // Start microphone level meter
    startMicMeter();
  } catch (err) {
    console.warn('Speech recognition start error', err);
    isRecognizing = false;
  }
}

function stopRecognition() {
  if (!speechRecognition) return;
  try {
    if (!isRecognizing) return;
    isRecognizing = false;
    speechRecognition.stop();
    // Stop microphone level meter
    stopMicMeter();
  } catch (err) {
    console.warn('Speech recognition stop error', err);
  }
}

function startMicMeter() {
  // If already running, skip
  if (micStream || micRaf) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    micStream = stream;
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128; // smaller for faster updates
    analyser.smoothingTimeConstant = 0.15; // quicker responsiveness
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.fftSize);
    const levelEl = document.getElementById('mic-level');
    const statusEl = document.getElementById('mic-status');
    function update() {
      if (!analyser) return;
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length) / 128;
      const percent = Math.min(100, Math.max(0, Math.round(rms * 200)));
      if (levelEl) levelEl.style.width = percent + '%';
      if (statusEl) statusEl.textContent = percent > 6 ? 'Detecting' : 'Idle';
      micRaf = requestAnimationFrame(update);
    }
    update();
  }).catch((err) => {
    console.warn('Mic meter error', err);
  });
}

function stopMicMeter() {
  if (micRaf) {
    cancelAnimationFrame(micRaf);
    micRaf = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
  const levelEl = document.getElementById('mic-level');
  const statusEl = document.getElementById('mic-status');
  if (levelEl) levelEl.style.width = '0%';
  if (statusEl) statusEl.textContent = 'Idle';
}

// Prewarm microphone permission to avoid prompt/latency when starting recognition
function prewarmMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve();
  return navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    // Immediately stop tracks but permission is granted for subsequent uses
    try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }).catch((err) => {
    console.warn('Prewarm mic permission failed', err);
  });
}

function speakText(text) {
  if (!speechSynthesisSupported) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function goToQuestion(index) {
  if (!currentQuestionElements.length) {
    speakText('No questions available to navigate.');
    return;
  }
  if (index < 0) index = 0;
  if (index >= currentQuestionElements.length) index = currentQuestionElements.length - 1;
  currentQuestionIndex = index;
  currentQuestionElements.forEach((element, idx) => {
    element.style.background = idx === currentQuestionIndex ? 'rgba(208, 188, 119, 0.16)' : 'transparent';
  });
  const questionText = currentQuestionElements[currentQuestionIndex]?.textContent || 'Unable to read the current question.';
  speakText(`Question ${currentQuestionIndex + 1}: ${questionText}`);
  // Auto-enable dictation after reading the question
  setTimeout(() => {
    dictationMode = true;
    speakText('You can now dictate your answer. Say stop dictation when done.');
  }, questionText.length * 100);
}

function readCurrentQuestion() {
  if (!currentQuestionElements.length) {
    speakText('No questions available to read.');
    return;
  }
  const text = currentQuestionElements[currentQuestionIndex]?.textContent || 'Unable to read the current question.';
  speakText(text);
  // Auto-enable dictation after reading the question
  setTimeout(() => {
    dictationMode = true;
    speakText('You can now dictate your answer. Say stop dictation when done.');
  }, text.length * 100);
}

function handleVoiceCommand(command) {
  if (command.includes('help')) {
    speakText('Available commands are next question, skip question, previous question, read question, submit exam, clear answer, dictate answer, stop dictation, and help.');
    return;
  }
  if (command.includes('submit')) {
    const form = document.getElementById('form-submit-answer');
    if (form) form.requestSubmit?.();
    speakText('Exam submission requested.');
    return;
  }
  if (command.includes('stop dictation') || command.includes('stop writing')) {
    dictationMode = false;
    speakText('Dictation mode stopped.');
    return;
  }
  if (command.includes('dictate answer') || command.includes('start dictation') || command.includes('write answer') || command.includes('dictate')) {
    dictationMode = true;
    speakText('Dictation mode enabled. Speak your answer directly and say stop dictation when finished.');
    return;
  }
  if (command.includes('next') || command.includes('skip')) {
    goToQuestion(currentQuestionIndex + 1);
    return;
  }
  if (command.includes('previous') || command.includes('back')) {
    goToQuestion(currentQuestionIndex - 1);
    return;
  }
  if (command.includes('read') || command.includes('question')) {
    readCurrentQuestion();
    return;
  }
  if (command.includes('clear')) {
    const answerField = document.getElementById('student-answer');
    if (answerField) answerField.value = '';
    speakText('Answer cleared.');
    return;
  }
  speakText('Voice command not recognized. Say help for available commands.');
}

async function getCurrentUser() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.user || null;
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error || !data?.user || !data?.session?.user) {
    showToast(error?.message || 'Login failed.');
    return;
  }
  await loadProfile(data.session.user.id);
}

async function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value.trim();

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { name, role: 'teacher' } },
  });
  if (error) {
    showToast(error.message);
    return;
  }

  const user = data?.user;
  if (!user) {
    showToast('Account created. Attempting automatic login...');
    setTimeout(() => {
      handleAutoLogin(email, password);
    }, 1500);
    return;
  }

  const activeUser = await getCurrentUser();
  if (data.session && activeUser?.id === user.id) {
    const profileResult = await supabaseClient.from('profiles').insert([
      {
        id: user.id,
        name,
        email,
        role: 'teacher',
      },
    ]);

    if (profileResult.error) {
      showToast('Profile save failed. Please try logging in to complete setup.');
      return;
    }
    await loadProfile(user.id);
    return;
  }

  showToast('Account created! Logging you in automatically...');
  setTimeout(() => {
    handleAutoLogin(email, password);
  }, 1500);
  document.getElementById('form-register').reset();
}

async function handleAutoLogin(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showToast('Please log in manually with your credentials.');
    showSection('auth');
    return;
  }
  if (data?.user) {
    await loadProfile(data.user.id);
  }
}

async function loadProfile(userId) {
  const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
  if (error || !data) {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user || user.id !== userId) {
      showSection('auth');
      return;
    }
    const profile = await ensureUserProfile(user);
    if (!profile) {
      showSection('auth');
      return;
    }
    currentProfile = profile;
  } else {
    currentProfile = data;
  }

  if (currentProfile.role === 'teacher') {
    await loadTeacherDashboard();
  } else {
    await loadStudentDashboard();
  }
}

async function ensureUserProfile(user) {
  const metadata = user.user_metadata || {};
  const profile = {
    id: user.id,
    name: metadata.name || metadata.full_name || 'Scribe user',
    email: user.email,
    role: metadata.role || 'teacher',
    teacher_id: metadata.teacher_id || null,
  };

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.id !== user.id) {
    console.warn('No active authenticated session to insert missing profile.');
    return null;
  }

  const { data, error } = await supabaseClient.from('profiles').insert([profile]);
  if (error) {
    console.warn('Unable to create missing profile:', error.message || error);
    return null;
  }
  return data?.[0] || null;
}

async function loadTeacherDashboard() {
  const [students, exams, submissions] = await Promise.all([
    loadTeacherStudents(),
    loadTeacherExams(),
    loadTeacherSubmissions(),
  ]);

  document.getElementById('teacher-student-count').textContent = students.length;
  document.getElementById('teacher-exam-count').textContent = exams.length;
  document.getElementById('teacher-submission-count').textContent = submissions.length;

  renderStudentTable(students);
  renderExamTable(exams);
  showSection('teacher');
}

async function loadStudentDashboard() {
  // Disable voice assistant when leaving exam
  if (voiceAssistantActive) {
    voiceAssistantActive = false;
    stopRecognition();
    dictationMode = false;
    if (voiceToggle) voiceToggle.textContent = 'Voice Assist';
    setVoiceStatus('Voice assistant inactive');
  }
  
  const exams = await loadStudentExams();
  renderStudentExamTable(exams);
  showSection('student');
}

async function loadTeacherStudents() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .eq('teacher_id', currentProfile.id)
    .order('name', { ascending: true });
  if (error) {
    showToast('Unable to load students.');
    return [];
  }
  return data || [];
}

async function loadTeacherExams() {
  const { data, error } = await supabaseClient
    .from('exams')
    .select('*')
    .eq('teacher_id', currentProfile.id)
    .order('created_at', { ascending: false });
  if (error) {
    showToast('Unable to load exams.');
    return [];
  }
  return data || [];
}

async function loadTeacherSubmissions() {
  const { data, error } = await supabaseClient
    .from('submissions')
    .select('*')
    .eq('teacher_id', currentProfile.id);
  if (error) {
    showToast('Unable to load submissions.');
    return [];
  }
  return data || [];
}

async function loadStudentExams() {
  const { data, error } = await supabaseClient
    .from('exams')
    .select('*')
    .contains('assigned_student_ids', [currentProfile.id])
    .order('created_at', { ascending: false });
  if (error) {
    showToast('Unable to load exams.');
    return [];
  }
  return data || [];
}

function renderStudentTable(students) {
  const tbody = document.querySelector('#teacher-student-table tbody');
  tbody.innerHTML = students
    .map((student) => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.email)}</td></tr>`)
    .join('') || '<tr><td colspan="2">No students added yet.</td></tr>';
}

function renderExamTable(exams) {
  const tbody = document.querySelector('#teacher-exam-table tbody');
  tbody.innerHTML = exams
    .map(
      (exam) => `<tr><td>${escapeHtml(exam.title)}</td><td>${(exam.assigned_student_ids || []).length}</td><td>${new Date(exam.created_at).toLocaleDateString()}</td><td><button class="button button-tertiary" data-exam-id="${exam.id}">View</button></td></tr>`
    )
    .join('') || '<tr><td colspan="4">No exams created yet.</td></tr>';

  tbody.querySelectorAll('button[data-exam-id]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const examId = event.target.dataset.examId;
      await openTeacherExam(examId);
    });
  });
}

async function renderStudentExamTable(exams) {
  const tbody = document.querySelector('#student-exam-table tbody');
  const completed = exams.filter((e) => e.submitted).length;
  const pending = exams.length - completed;

  document.getElementById('student-exam-count').textContent = exams.length;
  document.getElementById('student-completed-count').textContent = completed;
  document.getElementById('student-pending-count').textContent = pending;

  tbody.innerHTML = exams
    .map((exam) => {
      const status = exam.submitted ? '<span style="color: #4ade80;">Submitted</span>' : '<span style="color: var(--primary);">Available</span>';
      const createdDate = new Date(exam.created_at).toLocaleDateString();
      return `<tr><td>${escapeHtml(exam.title)}</td><td>${createdDate}</td><td>${status}</td><td><button class="button button-primary" data-exam-id="${exam.id}" style="padding: 8px 16px; font-size: 0.9rem;">Take Exam</button></td></tr>`;
    })
    .join('') || '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">No exams assigned yet. Your teacher will assign exams here.</td></tr>';

  tbody.querySelectorAll('button[data-exam-id]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const examId = event.target.dataset.examId;
      await openStudentExam(examId);
    });
  });
}

async function openTeacherExam(examId) {
  const { data: exam, error } = await supabaseClient.from('exams').select('*').eq('id', examId).single();
  if (error || !exam) {
    showToast('Unable to open exam.');
    return;
  }
  const { data: submissions } = await supabaseClient.from('submissions').select('*').eq('exam_id', examId);
  const submissionCount = submissions?.length || 0;
  showToast(`This exam has ${submissionCount} submission(s).`);
}

async function openStudentExam(examId) {
  const { data: exam, error } = await supabaseClient.from('exams').select('*').eq('id', examId).single();
  if (error || !exam) {
    showToast('Unable to open exam.');
    return;
  }
  currentExam = exam;
  document.getElementById('exam-detail-title').textContent = exam.title;
  document.getElementById('exam-detail-description').textContent = exam.description || 'Instructions will appear here.';

  const questionsInfo = document.getElementById('exam-questions-info');
  const questionsList = document.getElementById('exam-questions-list');
  const questionsFileLink = document.getElementById('exam-questions-file-link');

  const questions = Array.isArray(exam.questions)
    ? exam.questions
    : String(exam.questions || '').split('\n').map((q) => q.trim()).filter(Boolean);

  if (questions.length) {
    questionsInfo.style.display = 'none';
    questionsFileLink.style.display = 'none';
    questionsList.style.display = 'block';
    questionsList.innerHTML = questions
      .map((q) => `<li>${escapeHtml(q)}</li>`)
      .join('');
    currentQuestionElements = Array.from(questionsList.children);
    currentQuestionIndex = 0;
    goToQuestion(0);
  } else {
    questionsInfo.style.display = 'block';
    questionsList.style.display = 'none';
    currentQuestionElements = [];
    if (exam.questions_file_url && exam.questions_file_name) {
      questionsFileLink.style.display = 'block';
      questionsFileLink.innerHTML = `
        <strong>Questions file:</strong> <a href="${escapeHtml(exam.questions_file_url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(exam.questions_file_name)}</a>
        <div style="margin-top: 8px; color: var(--text-secondary);">Open the uploaded questions file to read the exam content.</div>
      `;
    } else {
      questionsFileLink.style.display = 'none';
    }
  }

  const { data: submission } = await supabaseClient
    .from('submissions')
    .select('*')
    .eq('exam_id', exam.id)
    .eq('student_id', currentProfile.id)
    .single();

  // Maintain committedAnswer separately so we can show interim text quickly
  committedAnswer = submission?.answer || '';
  const answerFieldEl = document.getElementById('student-answer');
  if (answerFieldEl) answerFieldEl.value = committedAnswer;
  showSection('examDetail');
  
  // Auto-enable voice assistant for students in exam mode
  if (!voiceAssistantActive && speechRecognitionSupported) {
    voiceAssistantActive = true;
    // Prewarm mic permission to avoid prompt latency
    await prewarmMicPermission();
    startRecognition();
    if (voiceToggle) voiceToggle.textContent = 'Stop Voice';
    setVoiceStatus('Voice assistant active');
    speakText('Voice assistant activated. You can navigate questions by saying next question, previous question, or read question. Say dictate answer to start speaking your answer.');
  }
}

async function handleCreateExam(event) {
  event.preventDefault();
  const title = document.getElementById('exam-title').value.trim();
  const description = document.getElementById('exam-description').value.trim();
  const questionsFile = document.getElementById('exam-questions-file').files[0];

  if (!title) {
    showToast('Enter exam title.');
    return;
  }

  if (!questionsFile) {
    showToast('Upload a questions file (PDF, DOC, DOCX, or TXT).');
    return;
  }

  const examId = crypto.randomUUID();
  const filePath = `exams/${examId}/${questionsFile.name}`;
  // Create 'exams' bucket in Supabase Storage if it doesn't exist
  const { error: uploadError } = await supabaseClient.storage.from('exams').upload(filePath, questionsFile, { cacheControl: '3600', upsert: true });
  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    showToast('Unable to upload the questions file. Check your Supabase storage settings.');
    return;
  }

  const publicUrlResult = supabaseClient.storage.from('exams').getPublicUrl(filePath);
  const questionsFileUrl = publicUrlResult?.data?.publicUrl || null;

  let questionsArray = [];
  if (questionsFile.type === 'text/plain' || questionsFile.name.toLowerCase().endsWith('.txt')) {
    try {
      const questionsText = await questionsFile.text();
      questionsArray = questionsText
        .split('\n')
        .map((q) => q.trim())
        .filter(Boolean);
    } catch (err) {
      console.warn('Unable to extract text from questions file:', err);
    }
  }

  const students = await loadTeacherStudents();
  const { error } = await supabaseClient.from('exams').insert([
    {
      id: examId,
      title,
      description,
      questions: questionsArray,
      questions_file_name: questionsFile.name,
      questions_file_path: filePath,
      questions_file_url: questionsFileUrl,
      teacher_id: currentProfile.id,
      assigned_student_ids: students.map((student) => student.id),
    },
  ]);

  if (error) {
    console.error('Exam insert error:', error);
    showToast(error.message || 'Unable to create exam.');
    return;
  }

  showToast('Examination published to all enrolled students.');
  document.getElementById('form-create-exam').reset();
  await loadTeacherDashboard();
}

async function handleCreateStudent(event) {
  event.preventDefault();
  const name = document.getElementById('student-name').value.trim();
  const email = document.getElementById('student-email').value.trim();
  const password = document.getElementById('student-password').value.trim();
  const teacherPassword = document.getElementById('teacher-password').value.trim();

  if (!name || !email || !password || !teacherPassword) {
    showToast('Fill all fields to create a student.');
    return;
  }

  const teacherEmail = currentProfile.email;
  const signup = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { name, role: 'student', teacher_id: currentProfile.id } },
  });

  if (signup.error) {
    showToast(signup.error.message);
    return;
  }

  const studentId = signup.data.user?.id;
  if (!studentId) {
    showToast('Student account created. They should now be able to log in.');
    document.getElementById('form-create-student').reset();
    await loadTeacherDashboard();
    return;
  }

  const profileResult = await supabaseClient.from('profiles').insert([
      {
        id: studentId,
        name,
        email,
        role: 'student',
        teacher_id: currentProfile.id,
      },
    ]);

  if (profileResult.error) {
    console.error('Student profile insert error:', profileResult.error);
    showToast('Unable to save student profile. Please verify the student account was created in Supabase.');
    return;
  }

  const teacherExams = await loadTeacherExams();
  await Promise.all(
    teacherExams
      .filter((exam) => !Array.isArray(exam.assigned_student_ids) || !exam.assigned_student_ids.includes(studentId))
      .map((exam) => {
        const assigned = Array.isArray(exam.assigned_student_ids) ? [...exam.assigned_student_ids, studentId] : [studentId];
        return supabaseClient.from('exams').update({ assigned_student_ids: assigned }).eq('id', exam.id);
      })
  );

  const activeUser = await getCurrentUser();
  if (signup.data.session && activeUser?.id === studentId) {
    await supabaseClient.auth.signOut();
    const reLogin = await supabaseClient.auth.signInWithPassword({ email: teacherEmail, password: teacherPassword });
    if (reLogin.error) {
      showToast('Student created, but unable to sign back in. Please log in again.');
      showSection('auth');
      return;
    }

    showToast('Student account created successfully.');
    document.getElementById('form-create-student').reset();
    await loadProfile(reLogin.data.user.id);
    return;
  }

  showToast('Student account created! They can now log in with their credentials.');
  document.getElementById('form-create-student').reset();
  await loadTeacherDashboard();
}

async function handleSubmitAnswer(event) {
  event.preventDefault();
  const answer = document.getElementById('student-answer').value.trim();
  if (!answer || !currentExam) {
    showToast('Answer cannot be empty.');
    return;
  }

  const existing = await supabaseClient
    .from('submissions')
    .select('*')
    .eq('exam_id', currentExam.id)
    .eq('student_id', currentProfile.id)
    .single();

  if (existing.error && existing.error.code !== 'PGRST116') {
    showToast('Unable to check submission.');
    return;
  }

  if (existing.data) {
    const { error } = await supabaseClient
      .from('submissions')
      .update({ answer, submitted_at: new Date().toISOString() })
      .eq('id', existing.data.id);
    if (error) {
      showToast('Unable to update submission.');
      return;
    }
    showToast('Answer updated successfully.');
  } else {
    const { error } = await supabaseClient.from('submissions').insert([
      {
        id: crypto.randomUUID(),
        exam_id: currentExam.id,
        student_id: currentProfile.id,
        teacher_id: currentExam.teacher_id,
        answer,
        submitted_at: new Date().toISOString(),
      },
    ]);
    if (error) {
      showToast('Unable to submit answer.');
      return;
    }
    showToast('Your examination response has been submitted successfully.');
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentProfile = null;
  showSection('auth');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char]);
}

init();
