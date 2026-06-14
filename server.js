const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const app = express();
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: 'scribemate-accessible-session-key',
    resave: false,
    saveUninitialized: false,
  })
);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }
}

function loadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const file = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(file || '[]');
  } catch (error) {
    console.error('Failed to load JSON:', filePath, error);
    return [];
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

ensureDataDir();

const users = loadJSON(USERS_FILE);
const exams = loadJSON(EXAMS_FILE);
const submissions = loadJSON(SUBMISSIONS_FILE);

function saveAll() {
  saveJSON(USERS_FILE, users);
  saveJSON(EXAMS_FILE, exams);
  saveJSON(SUBMISSIONS_FILE, submissions);
}

function seedDefaultData() {
  if (users.length > 0) {
    return;
  }

  const teacherId = uuid();
  const studentA = uuid();
  const studentB = uuid();

  users.push(
    {
      id: teacherId,
      name: 'Scribemate Teacher',
      email: 'teacher@scribemate.edu',
      password: bcrypt.hashSync('Teacher123', 10),
      role: 'teacher',
      studentIds: [studentA, studentB],
    },
    {
      id: studentA,
      name: 'Alex Student',
      email: 'alex@student.scribemate.edu',
      password: bcrypt.hashSync('Student123', 10),
      role: 'student',
      teacherId,
    },
    {
      id: studentB,
      name: 'Maya Student',
      email: 'maya@student.scribemate.edu',
      password: bcrypt.hashSync('Student123', 10),
      role: 'student',
      teacherId,
    }
  );
  saveAll();
}

seedDefaultData();

function findUserByEmail(email) {
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function findUserById(id) {
  return users.find((user) => user.id === id);
}

function getTeacherStudents(teacherId) {
  return users.filter((user) => user.role === 'student' && user.teacherId === teacherId);
}

function getTeacherExams(teacherId) {
  return exams.filter((exam) => exam.teacherId === teacherId);
}

function getStudentExams(studentId) {
  return exams.filter((exam) => exam.assignedStudentIds.includes(studentId));
}

function getSubmissionsForTeacher(teacherId) {
  return submissions.filter((item) => item.teacherId === teacherId);
}

function getSubmissionsForExam(examId) {
  return submissions.filter((item) => item.examId === examId);
}

function getStudentSubmission(studentId, examId) {
  return submissions.find((item) => item.studentId === studentId && item.examId === examId);
}

app.locals.findUserById = findUserById;
app.locals.exams = exams;

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
  res.redirect('/student');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = findUserByEmail(email || '');

  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    return res.render('login', { error: 'Email or password is incorrect.' });
  }

  req.session.user = { id: user.id, name: user.name, role: user.role };
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/teacher', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  const students = getTeacherStudents(teacher.id);
  const teacherExams = getTeacherExams(teacher.id);
  const teacherSubs = getSubmissionsForTeacher(teacher.id);

  res.render('teacher_dashboard', {
    teacher,
    students,
    exams: teacherExams,
    submissions: teacherSubs,
  });
});

app.get('/teacher/students', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  const students = getTeacherStudents(teacher.id);
  res.render('teacher_students', { teacher, students, message: null, error: null });
});

app.post('/teacher/students', requireLogin, requireRole('teacher'), (req, res) => {
  const { name, email, password } = req.body;
  const teacher = findUserById(req.session.user.id);
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.render('teacher_students', {
      teacher,
      students: getTeacherStudents(teacher.id),
      error: 'All student fields are required.',
      message: null,
    });
  }

  if (findUserByEmail(normalizedEmail)) {
    return res.render('teacher_students', {
      teacher,
      students: getTeacherStudents(teacher.id),
      error: 'A user with that email already exists.',
      message: null,
    });
  }

  const studentId = uuid();
  users.push({
    id: studentId,
    name: name.trim(),
    email: normalizedEmail,
    password: bcrypt.hashSync(password, 10),
    role: 'student',
    teacherId: teacher.id,
  });
  teacher.studentIds = teacher.studentIds || [];
  teacher.studentIds.push(studentId);
  saveAll();

  res.render('teacher_students', {
    teacher,
    students: getTeacherStudents(teacher.id),
    error: null,
    message: 'Student account created successfully.',
  });
});

app.get('/teacher/exams', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  const teacherExams = getTeacherExams(teacher.id);
  res.render('teacher_exams', { teacher, exams: teacherExams, message: null, error: null });
});

app.get('/teacher/exams/new', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  res.render('teacher_new_exam', { teacher, error: null });
});

app.post('/teacher/exams/new', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  const { title, description, questions } = req.body;
  const questionLines = (questions || '').split('\n').map((line) => line.trim()).filter(Boolean);

  if (!title || questionLines.length === 0) {
    return res.render('teacher_new_exam', {
      teacher,
      error: 'Exam title and at least one question are required.',
    });
  }

  const assignedStudents = getTeacherStudents(teacher.id).map((student) => student.id);
  const exam = {
    id: uuid(),
    title: title.trim(),
    description: (description || '').trim(),
    questions: questionLines,
    teacherId: teacher.id,
    assignedStudentIds: assignedStudents,
    createdAt: new Date().toISOString(),
  };
  exams.push(exam);
  saveAll();

  res.redirect('/teacher/exams');
});

app.get('/teacher/exams/:examId', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  const exam = exams.find((item) => item.id === req.params.examId && item.teacherId === teacher.id);

  if (!exam) {
    return res.redirect('/teacher/exams');
  }

  const examSubmissions = getSubmissionsForExam(exam.id);
  res.render('teacher_exam', { teacher, exam, submissions: examSubmissions });
});

app.get('/teacher/submissions/:examId', requireLogin, requireRole('teacher'), (req, res) => {
  const teacher = findUserById(req.session.user.id);
  const exam = exams.find((item) => item.id === req.params.examId && item.teacherId === teacher.id);

  if (!exam) {
    return res.redirect('/teacher/exams');
  }

  const examSubmissions = getSubmissionsForExam(exam.id).map((submission) => ({
    ...submission,
    student: findUserById(submission.studentId),
  }));

  res.render('teacher_submissions', { teacher, exam, submissions: examSubmissions });
});

app.get('/download/:submissionId', requireLogin, (req, res) => {
  const submission = submissions.find((item) => item.id === req.params.submissionId);
  if (!submission) {
    return res.redirect('/');
  }

  const exam = exams.find((item) => item.id === submission.examId);
  const student = findUserById(submission.studentId);
  const teacher = findUserById(req.session.user.id);

  if (!exam || !student) {
    return res.redirect('/');
  }

  if (req.session.user.role === 'teacher' && exam.teacherId !== teacher.id) {
    return res.redirect('/');
  }
  if (req.session.user.role === 'student' && submission.studentId !== req.session.user.id) {
    return res.redirect('/');
  }

  const filename = `scribemate-${student.name.replace(/\s+/g, '-')}-${exam.title.replace(/\s+/g, '-')}.txt`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`Student: ${student.name}\nExam: ${exam.title}\nSubmitted: ${new Date(submission.submittedAt).toLocaleString()}\n\nAnswer:\n${submission.answer}`);
});

app.get('/student', requireLogin, requireRole('student'), (req, res) => {
  const student = findUserById(req.session.user.id);
  const assignedExams = getStudentExams(student.id);
  const studentSubs = submissions.filter((item) => item.studentId === student.id);
  res.render('student_dashboard', { student, exams: assignedExams, submissions: studentSubs });
});

app.get('/student/exams/:examId', requireLogin, requireRole('student'), (req, res) => {
  const student = findUserById(req.session.user.id);
  const exam = exams.find((item) => item.id === req.params.examId && item.assignedStudentIds.includes(student.id));

  if (!exam) {
    return res.redirect('/student');
  }

  const submission = getStudentSubmission(student.id, exam.id);
  res.render('student_exam', { student, exam, submission });
});

app.post('/student/exams/:examId', requireLogin, requireRole('student'), (req, res) => {
  const student = findUserById(req.session.user.id);
  const exam = exams.find((item) => item.id === req.params.examId && item.assignedStudentIds.includes(student.id));

  if (!exam) {
    return res.redirect('/student');
  }

  const answer = (req.body.answer || '').trim();
  if (!answer) {
    const submission = getStudentSubmission(student.id, exam.id);
    return res.render('student_exam', {
      student,
      exam,
      submission,
      error: 'Please enter your answer before submitting.',
    });
  }

  let submission = getStudentSubmission(student.id, exam.id);
  if (!submission) {
    submission = {
      id: uuid(),
      examId: exam.id,
      studentId: student.id,
      teacherId: exam.teacherId,
      answer,
      submittedAt: new Date().toISOString(),
    };
    submissions.push(submission);
  } else {
    submission.answer = answer;
    submission.submittedAt = new Date().toISOString();
  }

  saveAll();
  res.redirect('/student');
});

app.use((req, res) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scribemate running on http://localhost:${PORT}`);
});
