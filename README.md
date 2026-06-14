# Scribemate

Scribemate is an accessible web application for teachers and students to manage exams, monitor answers, and download answer scripts.

## Features
- Teacher login with a default account
- Teacher dashboard for managing students and exams
- Students are added by teachers and assigned automatically to exams
- Student exam submission form with accessible layout
- Teacher view of submissions and downloadable answer scripts

## Run locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm start
   ```
3. Open the site at `http://localhost:3000`

## Default teacher account
- Email: `teacher@scribemate.edu`
- Password: `Teacher123`

## Notes
- Students can be created only by a teacher in the teacher dashboard.
- The app stores data in JSON files under `data/`.
