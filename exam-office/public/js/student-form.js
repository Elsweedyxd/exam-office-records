// student-form.js
// Add a student and Edit a student (the same form is used for both).
'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const { afterClick, $, api, busy, isBusy, showErrors, clearErrors, setFieldError, toast, flash, getMeta, fillSelect } = App;
  const form = $('#student-form');
  // If the address is /students/5/edit this is edit mode for student 5, otherwise it is a new student.
  const m = location.pathname.match(/^\/students\/(\d+)\/edit$/);
  const editId = m ? +m[1] : null;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let submitted = false;

  const meta = await getMeta();
  fillSelect(form.programme, meta.programmes);

  // Edit mode: change the heading and button text and fill the form with the saved details.
  if (editId) {
    $('#page-title').textContent = 'Edit student details';
    document.title = 'Edit student – Exam Office Records';
    $('#save-btn').textContent = 'Save changes';
    $('#form-loading').hidden = false; form.hidden = true;
    try {
      const s = await api(`/api/students/${editId}`);
      form.studentNumber.value = s.studentNumber; form.firstName.value = s.firstName; form.lastName.value = s.lastName;
      form.email.value = s.email; form.programme.value = s.programme; form.yearOfStudy.value = s.yearOfStudy;
      form.querySelector(`[name="status"][value="${s.status}"]`).checked = true;
      form.supportPlan.checked = s.supportPlan;
    } catch (err) { toast(err.message, 'error'); }
    $('#form-loading').hidden = true; form.hidden = false;
  }
  form.studentNumber.focus();

  // Suggest the email from the name (sensible default, can be overwritten)
  // Suggests the student email from their name (a sensible default).
  // If the user types their own email it is not overwritten.
  let emailTouched = !!editId;
  form.email.addEventListener('input', () => { emailTouched = true; });
  const suggest = () => {
    if (emailTouched) return;
    const f = form.firstName.value.trim().toLowerCase().replace(/\s+/g, ''), l = form.lastName.value.trim().toLowerCase().replace(/\s+/g, '');
    if (f && l) form.email.value = `${f}.${l}@student.example.ac.uk`;
  };
  form.firstName.addEventListener('change', suggest); form.lastName.addEventListener('change', suggest);

  // Reads the form into an object.
  const data = () => ({
    studentNumber: form.studentNumber.value.trim().toUpperCase(), firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim(),
    email: form.email.value.trim(), programme: form.programme.value, yearOfStudy: +form.yearOfStudy.value,
    status: form.status.value, supportPlan: form.supportPlan.checked,
  });
  // Browser checks with clear messages that say how to fix the problem.
  function validate(d) {
    const e = {};
    if (!d.studentNumber) e.studentNumber = 'Enter the student number.';
    else if (!/^S\d{7}$/.test(d.studentNumber)) e.studentNumber = 'Student number must be the letter S followed by 7 digits, for example S2300107.';
    if (!d.firstName) e.firstName = 'Enter the first name.';
    if (!d.lastName) e.lastName = 'Enter the last name.';
    if (!d.email) e.email = 'Enter the student email address.';
    else if (!EMAIL_RE.test(d.email)) e.email = 'Enter an email address in the format name@example.com.';
    if (!d.programme) e.programme = 'Choose a programme.';
    return e;
  }
  form.addEventListener('focusout', ev => {
    if (!submitted || !ev.target.name) return;
    // Don't reflow the form while the user is heading to a submit button (the button would move under the pointer)
    if (ev.relatedTarget?.type === 'submit') return;
    const name = ev.target.name;
    afterClick(() => setFieldError(form, name, validate(data())[name] || ''));
  });

  // Save, then go back to the students list filtered to this student so they can see it saved.
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#save-btn');
    if (isBusy(btn)) return;
    submitted = true;
    const d = data();
    const errs = validate(d);
    if (Object.keys(errs).length) return showErrors(form, errs);
    clearErrors(form);
    busy(btn, true);
    try {
      const res = await api(editId ? `/api/students/${editId}` : '/api/students', { method: editId ? 'PUT' : 'POST', body: d });
      flash(res.message);
      location.href = '/students?q=' + encodeURIComponent(d.studentNumber);
    } catch (err) {
      busy(btn, false);
      if (err.errors && Object.keys(err.errors).length) showErrors(form, err.errors);
      else toast(err.message, 'error');
    }
  });
});
