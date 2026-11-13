# Exam Office Records

An accessible, keyboard-friendly web app for a university exam office: staff sign in, look up students,
enter coursework/exam marks quickly, and search, sort and edit records.

**Stack:** HTML, CSS and vanilla JavaScript (front end) · Node.js + Express (back end) · SQLite, using the `node:sqlite` module built into Node.js (database).

## Run it on your computer

1. Install Node.js 22.13 or newer (https://nodejs.org – the LTS version is best).
2. In this folder:
   ```bash
   npm install
   npm start
   ```
   On Windows PowerShell, if you see "running scripts is disabled", use `npm.cmd install` and `npm.cmd start`.
3. Open http://localhost:3000

Demo accounts (created automatically the first time):

| Role | Email | Password |
|---|---|---|
| Administrator (can delete) | admin@examoffice.test | Admin123! |
| Exam officer | officer@examoffice.test | Officer123! |

You can also create your own account on the **Create an account** page. Choosing "Administrator" asks for an
access code (default `EXAMS-ADMIN-2026`, change it with the `ADMIN_CODE` environment variable).

To put it online with your own domain, follow **DEPLOY.md**. It has two options: a DigitalOcean droplet, or Render (paid instance with a persistent disk).

## Where the data is stored

Everything is stored **on the server** in a single SQLite database file:

- Locally: `data/exam-office.db` (created on first start)
- On the live server: `/var/lib/exam-office/exam-office.db` (set by `DATA_DIR` in DEPLOY.md)

| Table | What it holds |
|---|---|
| `users` | Staff accounts: name, email, role, and a **bcrypt hash** of the password (the real password is never stored) |
| `sessions` | Who is signed in: a random token (also stored in the browser as an `HttpOnly` cookie called `sid`) and its expiry (8 hours) |
| `students` | Student number, name, email, programme, year, enrolment status, support-plan flag |
| `marks` | One row per assessment: student, module, type, attempt, raw mark, late/days late, mitigating circumstances, final mark, grade, notes, who recorded it and when |

The browser only keeps three small conveniences in `localStorage` (last module, last assessment type, rows per
page) and one-off "flash" messages in `sessionStorage`. No records are kept in the browser or in the JavaScript files.
Data persists across refreshes, closing the browser and server restarts. To reset to the demo data, stop the
server and delete the `.db` file (and the `-wal`/`-shm` files next to it).

To inspect the database: install "DB Browser for SQLite" (https://sqlitebrowser.org) and open the file.

## Project structure

```
server.js            Express server: pages, JSON API, sign-up/sign-in, sessions, validation
db.js                Creates the SQLite tables and seeds demo data
rules.js             Modules, programmes, grade boundaries, late-penalty rules
views/               HTML pages (wrapped in _layout.html by server.js)
public/css/styles.css
public/js/common.js  API helper, status messages (aria-live), form error summary, busy buttons
public/js/table.js   Reusable sortable / filterable / paginated table
public/js/*.js       One script per page
DEPLOY.md            Step-by-step: DigitalOcean droplet + Namecheap domain + HTTPS
```

## API summary

| Method & path | Purpose |
|---|---|
| `POST /api/auth/signup`, `/login`, `/logout` | Accounts and sessions |
| `GET /api/stats` | Dashboard numbers |
| `GET/POST /api/students`, `GET/PUT/DELETE /api/students/:id` | Students (DELETE: admin only) |
| `GET/POST /api/marks`, `GET/PUT/DELETE /api/marks/:id` | Marks (DELETE: admin only) |
| `GET /api/marks/export.csv` | Download the filtered marks list |

List endpoints accept `q`, filters, `sort`, `dir`, `page` and `pageSize`, so large tables are paged on the server.

## Accessibility features (summary)

- Landmarks (`header`, `nav`, `main`, `footer`), skip link, one `h1` per page, no skipped heading levels
- Every input has a visible `<label>`; groups use `fieldset`/`legend`; hints and errors linked with `aria-describedby`
- Error summary at the top of forms that receives focus and links to each field; inline errors with `aria-invalid`
- Status messages (saved, deleted, result counts, loading) announced through `aria-live` regions
- Sortable table headers are buttons with `aria-sort`; pagination moves focus to the result count
- Native `<dialog>` for delete confirmation (focus trapped, Esc cancels, focus returns to the trigger)
- Two-tone focus ring visible on light and dark backgrounds; 44px minimum button height
- Colour contrast AA or better; status/grades/errors always have text or icons as well as colour
- Tables reflow into labelled cards on narrow screens and at 200–400% zoom – no horizontal scrolling
- Respects `prefers-reduced-motion` and Windows high-contrast (`forced-colors`)
- Correct `autocomplete` values on sign-in/sign-up; show/hide password toggle with `aria-pressed`

## Credits

Libraries: Express, bcryptjs, express-rate-limit, and Node's built-in node:sqlite. Error-summary pattern inspired by the GOV.UK Design System documentation.
