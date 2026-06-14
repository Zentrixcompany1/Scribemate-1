const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sections = {
  auth: document.getElementById('section-auth'),
  teacher: document.getElementById('section-teacher'),
  student: document.getElementById('section-student'),
  examDetail: document.getElementById('section-exam-detail'),
};
const navLogin = document.getElementById('nav-login');
const navRegister = document.getElementById('nav-register');
const navDashboard = document.getElementById('nav-dashboard');
const navLogout = document.getElementById('nav-logout');
const toast = document.getElementById('toast');
let currentProfile = null;
let currentExam = null;

async function init() {
  bindEvents();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    await loadProfile(session.user.id);
    return;
  }
  showSection('auth');
}

function bindEvents() {
  navLogin.addEventListener('click', () => showSection('auth'));
  navRegister.addEventListener('click', () => showSection('auth'));
  navDashboard.addEventListener('click', () => {
    if (currentProfile?.role === 'teacher') loadTeacherDashboard();
    else if (currentProfile?.role === 'student') loadStudentDashboard();
  });
  navLogout.addEventListener('click', logout);

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
  navRegister.classList.toggle('hidden', !!currentProfile);
  navDashboard.classList.toggle('hidden', !currentProfile);
  navLogout.classList.toggle('hidden', !currentProfile);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3600);
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
    name: metadata.name || metadata.full_name || 'Scribemate user',
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
  
  if (exam.questions) {
    questionsInfo.style.display = 'none';
    questionsList.style.display = 'block';
    questionsList.innerHTML = exam.questions
      .split('\n')
      .map((q) => q.trim())
      .filter(Boolean)
      .map((q) => `<li>${escapeHtml(q)}</li>`)
      .join('');
  } else {
    questionsInfo.style.display = 'block';
    questionsList.style.display = 'none';
  }

  const { data: submission } = await supabaseClient
    .from('submissions')
    .select('*')
    .eq('exam_id', exam.id)
    .eq('student_id', currentProfile.id)
    .single();

  document.getElementById('student-answer').value = submission?.answer || '';
  showSection('examDetail');
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

  let questionsText = '';
  try {
    questionsText = await questionsFile.text();
  } catch (err) {
    showToast('Unable to read file. Please use a text-based format (TXT, PDF text, or DOC).');
    return;
  }

  if (!questionsText.trim()) {
    showToast('Questions file appears to be empty.');
    return;
  }

  const students = await loadTeacherStudents();
  const { error } = await supabaseClient.from('exams').insert([
    {
      id: crypto.randomUUID(),
      title,
      description,
      questions: questionsText,
      teacher_id: currentProfile.id,
      assigned_student_ids: students.map((student) => student.id),
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) {
    showToast('Unable to create exam.');
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

  const activeUser = await getCurrentUser();
  if (signup.data.session && activeUser?.id === studentId) {
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
      showToast('Unable to save student profile.');
      return;
    }

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
