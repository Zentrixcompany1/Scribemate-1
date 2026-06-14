# Scribe Exam Management System

Scribe is a government-grade examination platform for educational institutions. Teachers create exams and manage student credentials; students take exams in a secure, professional environment with full question visibility and response submission.

## Features
- **Teacher Registration & Dashboard:** Teachers register and manage their institution's exams
- **Student Enrollment:** Teachers create student accounts and provide credentials
- **File-Based Exam Questions:** Upload exam questions as PDF, DOC, DOCX, or TXT files
- **Automatic Assignment:** Students are auto-assigned to exams upon enrollment
- **Professional Student Portal:** Students view assigned exams with exam metadata
- **Secure Exam Taking:** Students read questions and submit written responses
- **Response Management:** Teachers view and download all student responses
- **Credential Control:** Only teacher-created students can access the system

## Run locally
1. Open `config.js` and update `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your Supabase project values.
2. Open `index.html` directly in your browser, or use any static server.

## Deploy with GitHub Pages
1. Push this repository to GitHub.
2. In repository settings, enable GitHub Pages from the `main` branch and root folder.
3. Your live link will be available at `https://<your-username>.github.io/<repo-name>`.

## Supabase setup
Create the following tables in your Supabase project:

```sql
create table profiles (
  id uuid primary key references auth.users(id),
  email text unique not null,
  name text not null,
  role text not null check (role in ('teacher','student')),
  teacher_id uuid references profiles(id)
);

create table exams (
  id uuid primary key,
  title text not null,
  description text,
  questions jsonb not null,
  teacher_id uuid references profiles(id),
  assigned_student_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table submissions (
  id uuid primary key,
  exam_id uuid references exams(id),
  student_id uuid references profiles(id),
  teacher_id uuid references profiles(id),
  answer text not null,
  submitted_at timestamptz not null default now()
);
```

### Disable email confirmation (required)
1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Providers** → **Email**
3. Toggle **Confirm email** to OFF
4. Save changes

**Important:** This setting is essential for smooth operation. Students receive login credentials from their teacher; they do not self-register.

### File Upload Configuration
The exam questions file should be in one of these formats:
- **.txt** — Plain text (one question per line)
- **.pdf** — PDF document (text-extractable)
- **.doc / .docx** — Microsoft Word document

The system extracts and displays the text content to students during the exam.

## Supabase row-level security (RLS)
For the app to work correctly, enable RLS on each table and add these policies.

### Profiles
```sql
alter table profiles enable row level security;
create policy "Allow authenticated users to insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Allow teachers to insert student profiles" on profiles for insert with check (role = 'student' and teacher_id = auth.uid());
create policy "Allow users to read own profile" on profiles for select using (auth.uid() = id);
create policy "Allow teachers to read student profiles" on profiles for select using (role = 'student' and teacher_id = auth.uid());
```

### Exams
```sql
alter table exams enable row level security;
create policy "Allow teacher exam inserts" on exams for insert with check (teacher_id = auth.uid());
create policy "Allow teacher exam select" on exams for select using (teacher_id = auth.uid());
create policy "Allow student exam select" on exams for select using (assigned_student_ids @> array[auth.uid()]::uuid[]);
```

### Submissions
```sql
alter table submissions enable row level security;
create policy "Allow teacher submission access" on submissions for select using (teacher_id = auth.uid());
create policy "Allow student submission access" on submissions for select using (student_id = auth.uid());
create policy "Allow student submission insert" on submissions for insert with check (student_id = auth.uid());
create policy "Allow student submission update" on submissions for update using (student_id = auth.uid());
```

## Notes
- Teachers can register using the teacher registration page.
- Students are created by teachers from the teacher dashboard.
- User and exam data is stored in Supabase, not local JSON files.
