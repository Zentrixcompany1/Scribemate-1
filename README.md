# Scribemate

Scribemate is an accessible web application for teachers and students to manage exams, monitor answers, and download answer scripts.

## Features
- Teacher login and teacher registration
- Teacher dashboard for managing students and exams
- Students are added by teachers and assigned automatically to exams
- Student exam submission form with accessible layout
- Teacher view of submissions and downloadable answer scripts

## Run locally
1. Create a `.env` file from `.env.example` with your Supabase credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open the site at `http://localhost:3000`

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

## Notes
- Teachers can register using the teacher registration page.
- Students are created by teachers from the teacher dashboard.
- User and exam data is stored in Supabase, not local JSON files.
