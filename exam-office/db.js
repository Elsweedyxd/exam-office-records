// db.js
// Opens the SQLite database and creates the tables.
// ALL the app's data is saved in ONE file: data/exam-office.db
// (users, login sessions, students and marks). Deleting that file resets everything to the demo data.
const path = require('path');
const fs = require('fs');
// node:sqlite is the SQLite database built into Node.js (version 22.13 or newer),
// so nothing has to be compiled when installing. That means npm install works on any computer.
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

// The database folder. On the live server DATA_DIR is set to /var/lib/exam-office,
// on my laptop it is the data folder in the project. mkdirSync creates it if it is missing.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'exam-office.db');

// Open the database file (SQLite creates it the first time).
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL'); // safer when reading and writing at the same time
db.exec('PRAGMA foreign_keys = ON'); // makes ON DELETE CASCADE work

// Create the four tables if they do not exist yet.
// CHECK rules stop bad values being saved even if there is a bug somewhere else,
// UNIQUE stops two students having the same number, and the UNIQUE on marks stops duplicates.
// ON DELETE CASCADE means deleting a student or user also deletes their marks or sessions.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,              -- bcrypt hash, never the plain password
  role          TEXT NOT NULL CHECK (role IN ('officer','admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,              -- random 256-bit token stored in an HttpOnly cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL               -- unix ms
);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT NOT NULL,
  programme      TEXT NOT NULL,
  year_of_study  INTEGER NOT NULL CHECK (year_of_study BETWEEN 1 AND 4),
  status         TEXT NOT NULL CHECK (status IN ('Active','Interrupted','Withdrawn')),
  support_plan   INTEGER NOT NULL DEFAULT 0,  -- has a reasonable-adjustments plan
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id         INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  module_code        TEXT NOT NULL,
  assessment         TEXT NOT NULL CHECK (assessment IN ('Coursework','Exam','Practical')),
  attempt            TEXT NOT NULL CHECK (attempt IN ('First','Resit')),
  raw_mark           INTEGER NOT NULL CHECK (raw_mark BETWEEN 0 AND 100),
  late               INTEGER NOT NULL DEFAULT 0,
  days_late          INTEGER NOT NULL DEFAULT 0,
  mitigating         INTEGER NOT NULL DEFAULT 0,
  mitigating_reason  TEXT,
  final_mark         INTEGER NOT NULL,
  grade              TEXT NOT NULL,
  notes              TEXT,
  recorded_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, module_code, assessment, attempt)
);
`);

// ---------- Seed demo data the first time the database is created ----------
// Fills the database with demo data, but only the first time (when there are no users).
// It makes 2 demo accounts, 64 students and 2 to 4 marks each, so the tables have
// enough rows to test searching, sorting and paging.
function seed() {
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (hasUsers) return;
  const { calculate } = require('./rules');

  const addUser = db.prepare('INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,?)');
  addUser.run('Demo Administrator', 'admin@examoffice.test', bcrypt.hashSync('Admin123!', 10), 'admin');
  addUser.run('Demo Exam Officer', 'officer@examoffice.test', bcrypt.hashSync('Officer123!', 10), 'officer');

  const first = ['Amira','Omar','Layla','Youssef','Sara','Karim','Nour','Adam','Mariam','Ali','Hana','Ziad','Farah','Hassan','Salma','Tariq','Lina','Bilal','Jana','Rami','Emily','James','Priya','Chen','Sofia','Lucas','Aisha','Daniel','Grace','Noah'];
  const last  = ['Hassan','Ibrahim','Mahmoud','Khalil','Mansour','Saleh','Fathy','Nasser','Smith','Patel','Wong','Garcia','Brown','Okafor','Rossi'];
  const programmes = require('./rules').PROGRAMMES;
  const modules = require('./rules').MODULES.map(m => m.code);
  const statuses = ['Active','Active','Active','Active','Active','Active','Interrupted','Withdrawn'];

  const addStudent = db.prepare(`INSERT INTO students (student_number,first_name,last_name,email,programme,year_of_study,status,support_plan)
    VALUES (?,?,?,?,?,?,?,?)`);
  const addMark = db.prepare(`INSERT OR IGNORE INTO marks (student_id,module_code,assessment,attempt,raw_mark,late,days_late,mitigating,mitigating_reason,final_mark,grade,recorded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`);

  // A simple random number generator with a fixed start (42) so the demo data
  // is the same every time the database is reset.
  let rnd = 42; const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647; // deterministic
  const pick = a => a[Math.floor(r() * a.length)];

  // Doing all the inserts in one transaction is much faster than one by one.
  db.exec('BEGIN');
  try {
    for (let i = 0; i < 64; i++) {
      const fn = first[i % first.length], ln = pick(last);
      const num = 'S' + String(2300100 + i * 7);
      const info = addStudent.run(num, fn, ln, `${fn}.${ln}${i}@student.example.ac.uk`.toLowerCase(),
        pick(programmes), 1 + Math.floor(r() * 3), pick(statuses), r() < 0.2 ? 1 : 0);
      const nMarks = 2 + Math.floor(r() * 3);
      for (let k = 0; k < nMarks; k++) {
        const raw = Math.max(12, Math.min(96, Math.round(35 + r() * 55)));
        const late = r() < 0.1 ? 1 : 0;
        const days = late ? 1 + Math.floor(r() * 7) : 0;
        const mit = r() < 0.08 ? 1 : 0;
        const reason = mit ? pick(['Illness','Bereavement','Personal circumstances']) : null;
        const c = calculate(raw, late, days, mit);
        addMark.run(info.lastInsertRowid, pick(modules), pick(['Coursework','Coursework','Exam','Practical']), 'First',
          raw, late, days, mit, reason, c.finalMark, c.grade);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK'); // undo everything if one insert fails
    throw err;
  }
  console.log('Seeded demo data.');
}
seed();

// Other files use db to run queries.
module.exports = { db, DB_FILE };
