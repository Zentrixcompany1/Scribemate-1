require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { v4: uuid } = require('uuid');

const app = express();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables. Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'scribemate-accessible-session-key',
    resave: false,
    saveUninitialized: false,
  })
);

async function getProfileById(id) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  if (error) {
    console.error('getProfileById error', error);
    return null;
  }
  return data;
}

async function getProfileByEmail(email) {
  const { data, error } = await supabase.from('profiles').select('*').eq('email', email.toLowerCase()).single();
  if (error && error.code !== 'PGRST116') {
    console.error('getProfileByEmail error', error);
  }
  return data;
}

async function getTeacherStudents(teacherId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .eq('teacher_id', teacherId)
    .order('name', { ascending: true });

  if (error) {
    console.error('getTeacherStudents error', error);
    return [];
  }
  return data || [];
}

async function getTeacherExams(teacherId) {
  const { data, error } = await supabase
    .from('exams')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getTeacherExams error', error);
    return [];
  }
  return data || [];
}

async function getStudentExams(studentId) {
  const { data, error } = await supabase
    .from('exams')
    .select('*')
    .contains('assigned_student_ids', [studentId])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getStudentExams error', error);
    return [];
  }
  return data || [];
}

async function getSubmissionsForTeacher(teacherId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('getSubmissionsForTeacher error', error);
    return [];
  }
  return data || [];
}

async function getSubmissionsForExam(examId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('exam_id', examId)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('getSubmissionsForExam error', error);
    return [];
  }
  return data || [];
}

async function getStudentSubmission(studentId, examId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('student_id', studentId)
    .eq('exam_id', examId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('getStudentSubmission error', error);
  }
  return data;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.redirect('/login');
    }
    next();
  };
}

app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role === 'teacher') {
    return res.redirect('/teacher');
  }
  return res.redirect('/student');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  res.render('register', { error: null, message: null });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.render('register', {
      error: 'Name, email, and password are required.',
      message: null,
    });
  }

  const existing = await getProfileByEmail(normalizedEmail);
  if (existing) {
    return res.render('register', {
      error: 'A user with that email already exists.',
      message: null,
    });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.api.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'teacher' },
  });

  if (authError || !authData) {
    console.error('register auth error', authError);
    return res.render('register', {
      error: 'Unable to create teacher account. Please try again.',
      message: null,
    });
  }

  const { error: insertError } = await supabase.from('profiles').insert([
    { id: authData.id, email: normalizedEmail, name: name.trim(), role: 'teacher' },
  ]);

  if (insertError) {
    console.error('register profile error', insertError);
    return res.render('register', {
      error: 'Unable to save your profile. Please try again.',
      message: null,
    });
  }

  const { data: signInData, error: signInError } = await supabase.auth.signIn({
    email: normalizedEmail,
    password,
  });

  if (signInError || !signInData || !signInData.user) {
    return res.render('register', {
      error: 'Registration succeeded but sign-in failed. Please log in manually.',
      message: null,
    });
  }

  req.session.user = {
    id: signInData.user.id,
    name: name.trim(),
    role: 'teacher',
  };

  res.redirect('/teacher');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = (email || '').trim().toLowerCase();

  const { data: signInData, error: signInError } = await supabase.auth.signIn({
    email: normalizedEmail,
    password,
  });

  if (signInError || !signInData || !signInData.user) {
    return res.render('login', {
      error: 'Email or password is incorrect.',
    });
  }

  const profile = await getProfileById(signInData.user.id);
  if (!profile) {
    return res.render('login', {
      error: 'Unable to load profile. Contact your administrator.',
    });
  }

  req.session.user = {
    id: profile.id,
    name: profile.name,
    role: profile.role,
  };
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/teacher', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  const students = await getTeacherStudents(teacher.id);
  const exams = await getTeacherExams(teacher.id);
  const submissions = await getSubmissionsForTeacher(teacher.id);

  const recentSubmissions = await Promise.all(
    submissions.slice(0, 6).map(async (submission) => {
      const student = await getProfileById(submission.student_id);
      const exam = exams.find((item) => item.id === submission.exam_id);
      return {
        ...submission,
        student_name: student ? student.name : 'Unknown',
        exam_title: exam ? exam.title : 'Unknown exam',
      };
    })
  );

  res.render('teacher_dashboard', {
    teacher,
    students,
    exams,
    submissions: recentSubmissions,
    submissionsCount: submissions.length,
  });
});

app.get('/teacher/students', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  const students = await getTeacherStudents(teacher.id);
  res.render('teacher_students', { teacher, students, message: null, error: null });
});

async function addStudentToExistingExams(teacherId, studentId) {
  const exams = await getTeacherExams(teacherId);
  await Promise.all(
    exams.map(async (exam) => {
      const assignedStudentIds = Array.isArray(exam.assigned_student_ids)
        ? [...exam.assigned_student_ids, studentId]
        : [studentId];
      await supabase
        .from('exams')
        .update({ assigned_student_ids: assignedStudentIds })
        .eq('id', exam.id);
    })
  );
}

app.post('/teacher/students', requireLogin, requireRole('teacher'), async (req, res) => {
  const { name, email, password } = req.body;
  const teacher = await getProfileById(req.session.user.id);
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.render('teacher_students', {
      teacher,
      students: await getTeacherStudents(teacher.id),
      error: 'All student fields are required.',
      message: null,
    });
  }

  const existing = await getProfileByEmail(normalizedEmail);
  if (existing) {
    return res.render('teacher_students', {
      teacher,
      students: await getTeacherStudents(teacher.id),
      error: 'A user with that email already exists.',
      message: null,
    });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.api.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'student', teacherId: teacher.id },
  });

  if (authError || !authData) {
    console.error('create student auth error', authError);
    return res.render('teacher_students', {
      teacher,
      students: await getTeacherStudents(teacher.id),
      error: 'Unable to create student account. Please try again.',
      message: null,
    });
  }

  const { error: insertError } = await supabase.from('profiles').insert([
    {
      id: authData.id,
      email: normalizedEmail,
      name: name.trim(),
      role: 'student',
      teacher_id: teacher.id,
    },
  ]);

  if (insertError) {
    console.error('create student profile error', insertError);
    return res.render('teacher_students', {
      teacher,
      students: await getTeacherStudents(teacher.id),
      error: 'Unable to save student profile. Please try again.',
      message: null,
    });
  }

  await addStudentToExistingExams(teacher.id, authData.id);

  res.render('teacher_students', {
    teacher,
    students: await getTeacherStudents(teacher.id),
    error: null,
    message: 'Student account created successfully.',
  });
});

app.get('/teacher/exams', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  const exams = await getTeacherExams(teacher.id);
  res.render('teacher_exams', { teacher, exams, message: null, error: null });
});

app.get('/teacher/exams/new', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  res.render('teacher_new_exam', { teacher, error: null });
});

app.post('/teacher/exams/new', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  const { title, description, questions } = req.body;
  const questionLines = (questions || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!title || questionLines.length === 0) {
    return res.render('teacher_new_exam', {
      teacher,
      error: 'Exam title and at least one question are required.',
    });
  }

  const students = await getTeacherStudents(teacher.id);
  const assignedStudentIds = students.map((student) => student.id);

  const exam = {
    id: uuid(),
    title: title.trim(),
    description: (description || '').trim(),
    questions: questionLines,
    teacher_id: teacher.id,
    assigned_student_ids: assignedStudentIds,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('exams').insert([exam]);
  if (error) {
    console.error('create exam error', error);
    return res.render('teacher_new_exam', {
      teacher,
      error: 'Unable to create exam. Please try again.',
    });
  }

  res.redirect('/teacher/exams');
});

app.get('/teacher/exams/:examId', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', req.params.examId)
    .eq('teacher_id', teacher.id)
    .single();

  if (examError || !exam) {
    return res.redirect('/teacher/exams');
  }

  const examSubmissions = await getSubmissionsForExam(exam.id);
  const submissionsWithNames = await Promise.all(
    examSubmissions.map(async (submission) => {
      const student = await getProfileById(submission.student_id);
      return {
        ...submission,
        student_name: student ? student.name : 'Unknown',
      };
    })
  );

  res.render('teacher_exam', { teacher, exam, submissions: submissionsWithNames });
});

app.get('/teacher/submissions/:examId', requireLogin, requireRole('teacher'), async (req, res) => {
  const teacher = await getProfileById(req.session.user.id);
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', req.params.examId)
    .eq('teacher_id', teacher.id)
    .single();

  if (examError || !exam) {
    return res.redirect('/teacher/exams');
  }

  const examSubmissions = await getSubmissionsForExam(exam.id);
  const submissions = await Promise.all(
    examSubmissions.map(async (submission) => {
      const student = await getProfileById(submission.student_id);
      return {
        ...submission,
        student,
      };
    })
  );

  res.render('teacher_submissions', { teacher, exam, submissions });
});

app.get('/download/:submissionId', requireLogin, async (req, res) => {
  const { data: submission, error: submissionError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', req.params.submissionId)
    .single();

  if (submissionError || !submission) {
    return res.redirect('/');
  }

  const exam = await supabase
    .from('exams')
    .select('*')
    .eq('id', submission.exam_id)
    .single()
    .then((result) => result.data);
  const student = await getProfileById(submission.student_id);
  const currentUser = req.session.user;

  if (!exam || !student) {
    return res.redirect('/');
  }

  if (currentUser.role === 'teacher' && exam.teacher_id !== currentUser.id) {
    return res.redirect('/');
  }
  if (currentUser.role === 'student' && submission.student_id !== currentUser.id) {
    return res.redirect('/');
  }

  const filename = `scribemate-${student.name.replace(/\s+/g, '-')}-${exam.title.replace(/\s+/g, '-')}.txt`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`Student: ${student.name}\nExam: ${exam.title}\nSubmitted: ${new Date(submission.submitted_at).toLocaleString()}\n\nAnswer:\n${submission.answer}`);
});

app.get('/student', requireLogin, requireRole('student'), async (req, res) => {
  const student = await getProfileById(req.session.user.id);
  const exams = await getStudentExams(student.id);
  const studentSubs = await supabase.from('submissions').select('*').eq('student_id', student.id);
  const submissions = studentSubs.data || [];

  res.render('student_dashboard', { student, exams, submissions });
});

app.get('/student/exams/:examId', requireLogin, requireRole('student'), async (req, res) => {
  const student = await getProfileById(req.session.user.id);
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', req.params.examId)
    .contains('assigned_student_ids', [student.id])
    .single();

  if (examError || !exam) {
    return res.redirect('/student');
  }

  const submission = await getStudentSubmission(student.id, exam.id);
  res.render('student_exam', { student, exam, submission });
});

app.post('/student/exams/:examId', requireLogin, requireRole('student'), async (req, res) => {
  const student = await getProfileById(req.session.user.id);
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', req.params.examId)
    .contains('assigned_student_ids', [student.id])
    .single();

  if (examError || !exam) {
    return res.redirect('/student');
  }

  const answer = (req.body.answer || '').trim();
  if (!answer) {
    const submission = await getStudentSubmission(student.id, exam.id);
    return res.render('student_exam', {
      student,
      exam,
      submission,
      error: 'Please enter your answer before submitting.',
    });
  }

  const existingSubmission = await getStudentSubmission(student.id, exam.id);
  if (!existingSubmission) {
    const { error } = await supabase.from('submissions').insert([
      {
        id: uuid(),
        exam_id: exam.id,
        student_id: student.id,
        teacher_id: exam.teacher_id,
        answer,
        submitted_at: new Date().toISOString(),
      },
    ]);

    if (error) {
      console.error('create submission error', error);
      return res.render('student_exam', {
        student,
        exam,
        submission: null,
        error: 'Unable to submit your answer. Please try again.',
      });
    }
  } else {
    const { error } = await supabase
      .from('submissions')
      .update({ answer, submitted_at: new Date().toISOString() })
      .eq('id', existingSubmission.id);

    if (error) {
      console.error('update submission error', error);
      return res.render('student_exam', {
        student,
        exam,
        submission: existingSubmission,
        error: 'Unable to update your answer. Please try again.',
      });
    }
  }

  res.redirect('/student');
});

app.use((req, res) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scribemate running on http://localhost:${PORT}`);
});
