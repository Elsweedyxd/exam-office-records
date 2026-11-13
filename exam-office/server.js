// server.js
// The main server file. It does three jobs:
//  1. serves the HTML pages (inside one shared layout),
//  2. runs the JSON API that the front-end JavaScript calls (sign up, sign in, students, marks),
//  3. reads and writes everything in the SQLite database (see db.js).
// Run it with:  npm start   then open http://localhost:3000
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('./db');
const rules = require('./rules');

// Settings. On the live server these come from environment variables (see DEPLOY.md),
// otherwise the default values after || are used.
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || 'EXAMS-ADMIN-2026'; // needed to sign up as an administrator
const SESSION_HOURS = 8; // one working day
const app = express();
// Nginx sits in front of the app on the live server, so this tells Express to trust
// the headers Nginx sends. It is needed so the app knows when the visitor is using https.
app.set('trust proxy', 1); // behind Nginx in production
// Reads JSON sent by the browser into req.body. The size limit stops huge requests.
app.use(express.json({ limit: '50kb' }));

// ===== Security headers =====
// This runs on every request and adds security headers to the response.
// The Content-Security-Policy only allows scripts and styles from my own site,
// which blocks injected scripts (XSS). The other headers stop the site being put in an iframe.
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// ===== Sessions (token in HttpOnly cookie, row in the sessions table) =====
// Gets one cookie value from the request, for example the "sid" login cookie.
// The browser sends all cookies as one string like "a=1; sid=abc", so I split it up.
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
// Logs a user in. It makes a long random token, saves it in the sessions table
// with an expiry time, and sends it to the browser as a cookie.
// HttpOnly means JavaScript in the page cannot read the cookie, SameSite=Lax helps stop
// other sites sending requests as the user, and Secure is added when using https.
function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_HOURS * 3600e3;
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, expires);
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}
// Works out who is signed in. It reads the cookie, looks the token up in the
// sessions table and joins the users table to get their name and role.
// If there is no cookie, or the session has expired, it returns null.
function currentUser(req) {
  const token = readCookie(req, 'sid');
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.full_name,u.email,u.role,s.expires_at FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, fullName: row.full_name, email: row.email, role: row.role };
}
// Middleware: before every request I attach the signed in user (or null) to req.user
// so every route below can check it.
app.use((req, res, next) => { req.user = currentUser(req); next(); });
// Once an hour, delete old sessions that have expired so the table does not keep growing.
// unref() means this timer does not stop the server from shutting down.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

// requireAuth is added to API routes that need the user to be signed in.
// If they are not, it returns 401 and the front end sends them back to the sign-in page.
const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
// requireAdmin is only used on delete routes. Exam officers get a 403 (forbidden) message.
const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next()
  : res.status(403).json({ message: 'Only administrators can delete records.' });

// pause() waits a number of milliseconds. I use it on sign in and sign up
// so the "Signing in..." message is on screen long enough to be noticed.
const pause = ms => new Promise(r => setTimeout(r, ms));
// A simple check for an email shape: something@something.something
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ===== Auth API =====
// Rate limiter for sign in and sign up: max 30 tries per IP address in 15 minutes.
// This slows down anyone trying to guess passwords.
const authLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait 15 minutes and try again.' } });

// SIGN UP
// Checks every field, collects all problems in an errors object (field name -> message)
// and sends them back together so the form can show them all at once.
// If everything is fine the password is hashed with bcrypt (the real password is never saved),
// the user is added and they are signed in straight away.
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { fullName = '', email = '', password = '', confirmPassword = '', role = 'officer', adminCode = '' } = req.body || {};
  const errors = {};
  if (fullName.trim().length < 2) errors.fullName = 'Enter your full name.';
  if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter an email address in the format name@example.com.';
  else if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.trim())) errors.email = 'An account with this email already exists. Sign in instead.';
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errors.password = 'Password must be at least 8 characters and include a letter and a number.';
  if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
  if (!['officer', 'admin'].includes(role)) errors.role = 'Choose a role.';
  // Administrators can delete records, so signing up as one needs the access code.
  if (role === 'admin' && adminCode.trim() !== ADMIN_CODE) errors.adminCode = 'The administrator access code is not correct. Ask your office manager for the code.';
  await pause(600);
  if (Object.keys(errors).length) return res.status(422).json({ message: 'Please correct the highlighted fields.', errors });
  // 10 is the bcrypt cost: higher is slower to crack but also slower to run.
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,?)').run(fullName.trim(), email.trim(), hash, role);
  createSession(res, req, info.lastInsertRowid);
  res.status(201).json({ message: 'Account created.' });
});

// SIGN IN
// Finds the user by email and compares the typed password with the saved hash.
// The message does not say which one was wrong (email or password) so it does not
// help someone find out which emails have accounts.
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const errors = {};
  if (!email.trim()) errors.email = 'Enter your email address.';
  if (!password) errors.password = 'Enter your password.';
  await pause(700);
  if (Object.keys(errors).length) return res.status(422).json({ message: 'Please correct the highlighted fields.', errors });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.trim());
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ message: 'The email or password is incorrect. Check them and try again.' });
  createSession(res, req, user.id);
  res.json({ message: 'Signed in.' });
});

// SIGN OUT
// Deletes the session from the database and tells the browser to delete the cookie (Max-Age=0).
app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ message: 'Signed out.' });
});

// Returns the signed in user's details (used for the greeting and to know their role).
app.get('/api/me', requireAuth, (req, res) => res.json(req.user));
// Returns the lists used to fill the drop-downs (modules, programmes, reasons),
// so they are only written once, in rules.js.
app.get('/api/meta', requireAuth, (req, res) =>
  res.json({ modules: rules.MODULES, programmes: rules.PROGRAMMES, reasons: rules.MITIGATING_REASONS }));

// ===== Dashboard stats =====
// DASHBOARD NUMBERS
// One small COUNT query for each number on the dashboard, plus the 5 most recently updated marks.
app.get('/api/stats', requireAuth, (req, res) => {
  const one = sql => db.prepare(sql).get().n;
  res.json({
    students: one("SELECT COUNT(*) n FROM students WHERE status='Active'"),
    marks: one('SELECT COUNT(*) n FROM marks'),
    fails: one("SELECT COUNT(*) n FROM marks WHERE grade='Fail'"),
    mitigating: one('SELECT COUNT(*) n FROM marks WHERE mitigating=1'),
    late: one('SELECT COUNT(*) n FROM marks WHERE late=1'),
    recent: db.prepare(`SELECT m.id,m.module_code,m.assessment,m.final_mark,m.grade,m.updated_at,
        s.student_number, s.first_name||' '||s.last_name AS student_name
      FROM marks m JOIN students s ON s.id=m.student_id ORDER BY m.updated_at DESC, m.id DESC LIMIT 5`).all(),
  });
});

// ===== Helpers for list endpoints =====
// Reads the page number and page size from the URL query, for example ?page=2&pageSize=25.
// Only 10, 25, 50 or 100 rows per page are allowed. offset is how many rows to skip in SQL.
function paging(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = [10, 25, 50, 100].includes(+req.query.pageSize) ? +req.query.pageSize : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
// Sort direction. Only ASC or DESC can come out of this, so it is safe to put in the SQL.
const dir = d => (d === 'desc' ? 'DESC' : 'ASC');

// ===== Students =====
// Checks a student form on the server. The browser checks too, but the server
// must check again because requests can be sent without using my form.
// Returns the errors and the student number in capitals.
function validateStudent(b, id) {
  const e = {};
  const num = (b.studentNumber || '').trim().toUpperCase();
  if (!/^S\d{7}$/.test(num)) e.studentNumber = 'Student number must be the letter S followed by 7 digits, for example S2300107.';
  else if (db.prepare('SELECT 1 FROM students WHERE student_number=? AND id<>?').get(num, id || 0)) e.studentNumber = `Student number ${num} is already registered.`;
  if (!(b.firstName || '').trim()) e.firstName = 'Enter the first name.';
  if (!(b.lastName || '').trim()) e.lastName = 'Enter the last name.';
  if (!EMAIL_RE.test((b.email || '').trim())) e.email = 'Enter an email address in the format name@example.com.';
  if (!rules.PROGRAMMES.includes(b.programme)) e.programme = 'Choose a programme.';
  if (![1, 2, 3, 4].includes(+b.yearOfStudy)) e.yearOfStudy = 'Choose a year of study.';
  if (!['Active', 'Interrupted', 'Withdrawn'].includes(b.status)) e.status = 'Choose a status.';
  return { e, num };
}
// Turns a database row (snake_case columns) into the JSON shape the front end uses (camelCase).
const studentOut = s => s && ({ id: s.id, studentNumber: s.student_number, firstName: s.first_name, lastName: s.last_name,
  email: s.email, programme: s.programme, yearOfStudy: s.year_of_study, status: s.status, supportPlan: !!s.support_plan,
  markCount: s.mark_count, average: s.average != null ? Math.round(s.average) : null });

// LIST STUDENTS (search, filter, sort, paging)
// I build the WHERE part from whichever filters were used. The values always go in as ? placeholders
// (prepared statements) so user input can never change the SQL (no SQL injection).
// The sort column comes from a fixed list (sorts) for the same reason.
// It returns the total count as well as the rows, so the page can say "Showing 1 to 25 of 64".
app.get('/api/students', requireAuth, (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = [], args = [];
  if (req.query.q) { where.push("(s.student_number LIKE ? OR s.first_name||' '||s.last_name LIKE ? OR s.email LIKE ?)"); const q = `%${req.query.q.trim()}%`; args.push(q, q, q); }
  if (req.query.programme) { where.push('s.programme=?'); args.push(req.query.programme); }
  if (req.query.status) { where.push('s.status=?'); args.push(req.query.status); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sorts = { number: 's.student_number', name: 's.last_name', programme: 's.programme', year: 's.year_of_study', status: 's.status', average: 'average' };
  const sort = sorts[req.query.sort] || 's.last_name';
  const total = db.prepare(`SELECT COUNT(*) n FROM students s ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT s.*, COUNT(m.id) mark_count, AVG(m.final_mark) average FROM students s
    LEFT JOIN marks m ON m.student_id=s.id ${w} GROUP BY s.id ORDER BY ${sort} ${dir(req.query.dir)}, s.id LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset);
  res.json({ total, page, pageSize, rows: rows.map(studentOut) });
});

// Short list of every student (number, name, programme, status)
// used for the suggestions on the marks entry form.
app.get('/api/students/options', requireAuth, (req, res) =>
  res.json(db.prepare("SELECT student_number n, first_name||' '||last_name name, programme, status FROM students ORDER BY last_name").all()));

// Find one student by their student number.
app.get('/api/students/lookup/:number', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE student_number=?').get(req.params.number.trim().toUpperCase());
  s ? res.json(studentOut(s)) : res.status(404).json({ message: 'No student found with that number.' });
});

// Get one student by id (used when editing).
app.get('/api/students/:id', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
  s ? res.json(studentOut(s)) : res.status(404).json({ message: 'Student not found.' });
});

// ADD A STUDENT. 422 means "the data has problems", 201 means "created".
app.post('/api/students', requireAuth, (req, res) => {
  const b = req.body || {}; const { e, num } = validateStudent(b);
  if (Object.keys(e).length) return res.status(422).json({ message: 'Please correct the highlighted fields.', errors: e });
  const info = db.prepare(`INSERT INTO students (student_number,first_name,last_name,email,programme,year_of_study,status,support_plan)
    VALUES (?,?,?,?,?,?,?,?)`).run(num, b.firstName.trim(), b.lastName.trim(), b.email.trim(), b.programme, +b.yearOfStudy, b.status, b.supportPlan ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid, message: `Student ${b.firstName.trim()} ${b.lastName.trim()} (${num}) saved.` });
});

// EDIT A STUDENT. changes is 0 if no row had that id, so I return 404.
app.put('/api/students/:id', requireAuth, (req, res) => {
  const b = req.body || {}; const { e, num } = validateStudent(b, +req.params.id);
  if (Object.keys(e).length) return res.status(422).json({ message: 'Please correct the highlighted fields.', errors: e });
  const r = db.prepare(`UPDATE students SET student_number=?,first_name=?,last_name=?,email=?,programme=?,year_of_study=?,status=?,support_plan=? WHERE id=?`)
    .run(num, b.firstName.trim(), b.lastName.trim(), b.email.trim(), b.programme, +b.yearOfStudy, b.status, b.supportPlan ? 1 : 0, req.params.id);
  r.changes ? res.json({ message: `Changes to ${b.firstName.trim()} ${b.lastName.trim()} saved.` }) : res.status(404).json({ message: 'Student not found.' });
});

// DELETE A STUDENT (administrators only). Their marks are deleted too
// because the marks table uses ON DELETE CASCADE.
app.delete('/api/students/:id', requireAuth, requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  r.changes ? res.json({ message: 'Student and their marks deleted.' }) : res.status(404).json({ message: 'Student not found.' });
});

// ===== Marks =====
// Same idea as studentOut but for marks.
const markOut = m => m && ({ id: m.id, studentId: m.student_id, studentNumber: m.student_number, studentName: m.student_name,
  moduleCode: m.module_code, assessment: m.assessment, attempt: m.attempt, rawMark: m.raw_mark, late: !!m.late, daysLate: m.days_late,
  mitigating: !!m.mitigating, mitigatingReason: m.mitigating_reason, finalMark: m.final_mark, grade: m.grade, notes: m.notes,
  recordedBy: m.recorded_by_name, updatedAt: m.updated_at });
// The base query for marks. It joins students (for the name and number)
// and users (for the name of the person who recorded it).
const MARK_SELECT = `SELECT m.*, s.student_number, s.first_name||' '||s.last_name AS student_name, u.full_name recorded_by_name
  FROM marks m JOIN students s ON s.id=m.student_id LEFT JOIN users u ON u.id=m.recorded_by`;

// Builds the WHERE part for the marks list from the filters in the URL.
// Used by both the table and the CSV download so they always match.
function markFilters(req) {
  const where = [], args = [];
  if (req.query.q) { const q = `%${req.query.q.trim()}%`; where.push("(s.student_number LIKE ? OR s.first_name||' '||s.last_name LIKE ? OR m.module_code LIKE ?)"); args.push(q, q, q); }
  if (req.query.module) { where.push('m.module_code=?'); args.push(req.query.module); }
  if (req.query.assessment) { where.push('m.assessment=?'); args.push(req.query.assessment); }
  if (req.query.grade) { where.push('m.grade=?'); args.push(req.query.grade); }
  if (req.query.student) { where.push('s.student_number=?'); args.push(req.query.student.toUpperCase()); }
  if (req.query.flag === 'late') where.push('m.late=1');
  if (req.query.flag === 'mitigating') where.push('m.mitigating=1');
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}
// Columns the marks table can be sorted by (fixed list so it is safe in SQL).
const MARK_SORTS = { student: 's.last_name', number: 's.student_number', module: 'm.module_code', assessment: 'm.assessment', mark: 'm.final_mark', grade: 'm.final_mark', updated: 'm.updated_at' };

// LIST MARKS. Newest first unless the user picked a sort column.
app.get('/api/marks', requireAuth, (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const { w, args } = markFilters(req);
  const sort = MARK_SORTS[req.query.sort] || 'm.updated_at';
  const sortDir = req.query.sort ? dir(req.query.dir) : 'DESC';
  const total = db.prepare(`SELECT COUNT(*) n FROM marks m JOIN students s ON s.id=m.student_id ${w}`).get(...args).n;
  const rows = db.prepare(`${MARK_SELECT} ${w} ORDER BY ${sort} ${sortDir}, m.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  res.json({ total, page, pageSize, rows: rows.map(markOut) });
});

// DOWNLOAD CSV of the marks that match the current filters.
// Every value is wrapped in quotes and any quote inside is doubled, which is how CSV escapes text.
// Content-Disposition makes the browser download it as a file.
app.get('/api/marks/export.csv', requireAuth, (req, res) => {
  const { w, args } = markFilters(req);
  const rows = db.prepare(`${MARK_SELECT} ${w} ORDER BY s.last_name, m.module_code`).all(...args);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Student number', 'Student name', 'Module', 'Assessment', 'Attempt', 'Raw mark', 'Late', 'Days late', 'Mitigating', 'Reason', 'Final mark', 'Grade', 'Updated'];
  const lines = rows.map(m => [m.student_number, m.student_name, m.module_code, m.assessment, m.attempt, m.raw_mark, m.late ? 'Yes' : 'No', m.days_late,
    m.mitigating ? 'Yes' : 'No', m.mitigating_reason, m.final_mark, m.grade, m.updated_at].map(esc).join(','));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="marks-export.csv"' });
  res.send([head.map(esc).join(','), ...lines].join('\r\n'));
});

// Get one mark (used when editing).
app.get('/api/marks/:id', requireAuth, (req, res) => {
  const m = db.prepare(`${MARK_SELECT} WHERE m.id=?`).get(req.params.id);
  m ? res.json(markOut(m)) : res.status(404).json({ message: 'Mark not found.' });
});

// Checks a mark before saving.
// It also stops marks for withdrawn students, and checks for a duplicate:
// the same student, module, assessment and attempt can only have one mark.
// For a duplicate it returns the id of the existing mark so the form can offer an "edit it instead" link.
function validateMark(b, id) {
  const e = {};
  const student = db.prepare('SELECT * FROM students WHERE student_number=?').get((b.studentNumber || '').trim().toUpperCase());
  if (!b.studentNumber) e.studentNumber = 'Enter a student number.';
  else if (!student) e.studentNumber = 'No student has this number. Check it, or add the student first.';
  else if (student.status === 'Withdrawn') e.studentNumber = `${student.first_name} ${student.last_name} has withdrawn, so marks cannot be recorded.`;
  if (!rules.MODULES.some(m => m.code === b.moduleCode)) e.moduleCode = 'Choose a module.';
  if (!['Coursework', 'Exam', 'Practical'].includes(b.assessment)) e.assessment = 'Choose the assessment type.';
  if (!['First', 'Resit'].includes(b.attempt)) e.attempt = 'Choose the attempt.';
  const raw = Number(b.rawMark);
  if (b.rawMark === '' || b.rawMark == null || !Number.isInteger(raw) || raw < 0 || raw > 100) e.rawMark = 'Mark must be a whole number from 0 to 100.';
  const days = Number(b.daysLate);
  if (b.late && (!Number.isInteger(days) || days < 1 || days > 60)) e.daysLate = 'Enter how many days late, from 1 to 60.';
  if (b.mitigating && !rules.MITIGATING_REASONS.includes(b.mitigatingReason)) e.mitigatingReason = 'Choose the reason for mitigating circumstances.';
  if ((b.notes || '').length > 500) e.notes = 'Notes must be 500 characters or fewer.';
  if (!Object.keys(e).length) {
    const dup = db.prepare('SELECT id FROM marks WHERE student_id=? AND module_code=? AND assessment=? AND attempt=? AND id<>?')
      .get(student.id, b.moduleCode, b.assessment, b.attempt, id || 0);
    if (dup) return { e: { studentNumber: `A ${b.attempt.toLowerCase()}-attempt ${b.assessment.toLowerCase()} mark for ${b.moduleCode} already exists for this student.` }, duplicateId: dup.id };
  }
  return { e, student, raw, days: b.late ? days : 0 };
}

// Used for both adding (no id) and editing (with id) a mark.
// The final mark and grade are always worked out here on the server with rules.calculate,
// so nobody can save a wrong grade by changing the page.
// 409 means conflict (duplicate). The success message names the student and mark so the user can check it.
function saveMark(req, res, id) {
  const b = req.body || {};
  const v = validateMark(b, id);
  if (Object.keys(v.e).length) return res.status(v.duplicateId ? 409 : 422).json({ message: 'Please correct the highlighted fields.', errors: v.e, duplicateId: v.duplicateId });
  const c = rules.calculate(v.raw, !!b.late, v.days, !!b.mitigating);
  const vals = [v.student.id, b.moduleCode, b.assessment, b.attempt, v.raw, b.late ? 1 : 0, v.days, b.mitigating ? 1 : 0,
    b.mitigating ? b.mitigatingReason : null, c.finalMark, c.grade, (b.notes || '').trim() || null, req.user.id];
  const who = `${v.student.first_name} ${v.student.last_name}`;
  if (id) {
    const r = db.prepare(`UPDATE marks SET student_id=?,module_code=?,assessment=?,attempt=?,raw_mark=?,late=?,days_late=?,mitigating=?,
      mitigating_reason=?,final_mark=?,grade=?,notes=?,recorded_by=?,updated_at=datetime('now') WHERE id=?`).run(...vals, id);
    if (!r.changes) return res.status(404).json({ message: 'Mark not found.' });
    return res.json({ id, message: `Mark updated: ${who}, ${b.moduleCode} ${b.assessment.toLowerCase()} — ${c.finalMark} (${c.grade}).` });
  }
  const info = db.prepare(`INSERT INTO marks (student_id,module_code,assessment,attempt,raw_mark,late,days_late,mitigating,mitigating_reason,final_mark,grade,notes,recorded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals);
  res.status(201).json({ id: info.lastInsertRowid, message: `Mark saved: ${who}, ${b.moduleCode} ${b.assessment.toLowerCase()} — ${c.finalMark} (${c.grade}).` });
}
// Routes for adding, editing and deleting marks.
app.post('/api/marks', requireAuth, (req, res) => saveMark(req, res));
app.put('/api/marks/:id', requireAuth, (req, res) => saveMark(req, res, +req.params.id));
app.delete('/api/marks/:id', requireAuth, requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM marks WHERE id=?').run(req.params.id);
  r.changes ? res.json({ message: 'Mark deleted.' }) : res.status(404).json({ message: 'Mark not found.' });
});

// Any other /api address that does not exist gets a JSON 404.
app.use('/api', (req, res) => res.status(404).json({ message: 'Not found.' }));

// ===== HTML pages (simple layout templating) =====
// HTML PAGES
// Each page in views/ only has its main content. render() puts it inside _layout.html
// (header, menu, footer) so these parts are the same on every page (consistency).
// The comments at the top of each view (title, script, nav) tell render() the page title,
// which scripts to load and which menu link to mark as the current page.
const VIEWS = path.join(__dirname, 'views');
const read = f => fs.readFileSync(path.join(VIEWS, f), 'utf8');
// Menu icons (simple line drawings, hidden from screen readers) and the main menu links: [key, address, text].
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  'mark-entry': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  marks: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  students: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
};
const icon = name => `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
const NAV = [
  ['dashboard', '/dashboard', 'Dashboard'],
  ['mark-entry', '/marks/new', 'Enter marks'],
  ['marks', '/marks', 'Marks records'],
  ['students', '/students', 'Students'],
  ['help', '/help', 'Help'],
];
// Builds the full HTML for a page.
// meta reads the "<!-- title: ... -->" lines at the top of the view file.
// esc() escapes the user's name so it cannot inject HTML.
// aria-current="page" tells screen readers which menu link is the page they are on.
function render(view, user) {
  const src = read(view + '.html');
  const meta = Object.fromEntries([...src.matchAll(/^<!--\s*(\w+):\s*(.*?)\s*-->/gm)].map(m => [m[1], m[2]]));
  const layout = read(user ? '_layout.html' : '_auth-layout.html');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nav = NAV.map(([key, href, label]) =>
    `<li><a href="${href}"${(meta.nav || view) === key ? ' aria-current="page"' : ''}>${icon(key)}<span>${label}</span></a></li>`).join('\n');
  const initials = user ? user.fullName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : '';
  return layout
    .replace('{{TITLE}}', esc(meta.title || 'Exam Office Records'))
    .replace('{{NAV}}', nav)
    .replace('{{USER_NAME}}', user ? esc(user.fullName) : '')
    .replace('{{INITIALS}}', esc(initials))
    .replace('{{USER_ROLE}}', user ? (user.role === 'admin' ? 'Administrator' : 'Exam officer') : '')
    .replace('{{SCRIPT}}', (meta.script || '').split(/\s+/).filter(Boolean).map(f => `<script src="/js/${f}" defer></script>`).join('\n  '))
    .replace('{{CONTENT}}', src.replace(/^<!--.*-->\n/gm, ''));
}
// Makes a route handler for a page.
// guest pages (sign in, sign up) send signed in users to the dashboard.
// All other pages send signed out users to the sign-in page, and ?next= remembers
// where they were going so they end up there after signing in.
const page = (view, opts = {}) => (req, res) => {
  if (opts.guest && req.user) return res.redirect('/dashboard');
  if (!opts.guest && !req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  res.type('html').send(render(view, opts.guest ? null : req.user));
};

// Page addresses.
app.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));
app.get('/login', page('login', { guest: true }));
app.get('/signup', page('signup', { guest: true }));
app.get('/dashboard', page('dashboard'));
app.get('/marks', page('marks'));
app.get('/marks/new', page('mark-entry'));
app.get('/marks/:id/edit', page('mark-entry'));
app.get('/students', page('students'));
app.get('/students/new', page('student-form'));
app.get('/students/:id/edit', page('student-form'));
app.get('/help', page('help'));

// Serves the files in public/ (CSS, JavaScript, icon). Cached for 1 hour.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// Anything else: show the "Page not found" page.
app.use((req, res) => res.status(404).type('html').send(render('not-found', req.user)));

// Start the server.
app.listen(PORT, () => console.log(`Exam Office Records running on http://localhost:${PORT}`));
