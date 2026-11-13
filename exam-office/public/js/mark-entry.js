// mark-entry.js
// The marks entry form, built for entering lots of marks quickly. It is used for adding and editing.
'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const { afterClick, $, api, busy, isBusy, showErrors, clearErrors, setFieldError, toggleSection, toast, flash, getMeta, fillSelect, escapeHtml } = App;
  const form = $('#mark-form');
  // /marks/12/edit means edit mark 12, /marks/new means a new mark.
  const editMatch = location.pathname.match(/^\/marks\/(\d+)\/edit$/);
  const editId = editMatch ? +editMatch[1] : null;
  // Small wrapper for localStorage (it can fail in private browsing).
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let submitted = false;

  // ---------- Load reference data ----------
  // Load the drop-down lists and the list of students for the suggestions.
  const [meta, students] = await Promise.all([getMeta(), api('/api/students/options')]);
  fillSelect(form.moduleCode, meta.modules, 'code', m => `${m.code} – ${m.title}`);
  fillSelect(form.mitigatingReason, meta.reasons);
  const byNumber = new Map(students.map(s => [s.n.toUpperCase(), s]));
  const dl = $('#student-options');
  students.forEach(s => { const o = document.createElement('option'); o.value = s.n; o.label = `${s.name} – ${s.programme}`; dl.append(o); });

  // ---------- Recognition over recall: confirm who the number belongs to ----------
  // After the student number is typed, show the student's name and programme under the box
  // so the user can check it is the right person (recognition over recall, error prevention).
  // If a full name is typed and only one student has it, it is changed to their number.
  // The message is in a polite live region so screen readers read it too.
  const confirmEl = $('#student-confirm');
  function resolveStudent() {
    let v = form.studentNumber.value.trim();
    // Allow typing a full name: convert to the number if it is unique
    if (v && !byNumber.has(v.toUpperCase())) {
      const matches = students.filter(s => s.name.toLowerCase() === v.toLowerCase());
      if (matches.length === 1) { v = matches[0].n; form.studentNumber.value = v; }
    }
    const s = byNumber.get(v.toUpperCase());
    confirmEl.className = 'student-confirm';
    if (!v) confirmEl.textContent = '';
    else if (!s) { confirmEl.textContent = /^S\d{7}$/i.test(v) ? 'No student has this number.' : ''; confirmEl.classList.toggle('warn', !!confirmEl.textContent); }
    else if (s.status === 'Withdrawn') { confirmEl.textContent = `${s.name} has withdrawn – marks cannot be recorded.`; confirmEl.classList.add('warn'); }
    else { confirmEl.textContent = `${s.name}, ${s.programme}${s.status !== 'Active' ? ` (${s.status})` : ''}`; confirmEl.classList.add('ok'); }
    return s;
  }
  let lookupTimer;
  form.studentNumber.addEventListener('input', () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(resolveStudent, 300); });
  form.studentNumber.addEventListener('change', resolveStudent);

  // ---------- Dynamic sections ----------
  // Extra fields that appear only when needed: days late, and the mitigating reason.
  // When "late" is ticked, focus moves to the days box so the user can type straight away.
  const lateSection = $('#late-section');
  const mitSection = $('#mitigating-section');
  form.late.addEventListener('change', () => { toggleSection(lateSection, form.late.checked); if (form.late.checked) form.daysLate.focus(); updatePreview(); });
  form.querySelectorAll('[name="mitigating"]').forEach(r => r.addEventListener('change', () => {
    toggleSection(mitSection, form.mitigating.value === 'yes'); updatePreview();
  }));

  // ---------- Live result preview ----------
  // Live preview of the final mark, grade and penalty while typing.
  const pm = $('#preview-mark'), pg = $('#preview-grade'), pp = $('#preview-penalty');
  function updatePreview() {
    const raw = form.rawMark.value.trim();
    if (!/^\d{1,3}$/.test(raw) || +raw > 100) { pm.textContent = '–'; pg.textContent = '–'; pp.textContent = 'None'; return; }
    const c = Rules.calculate(+raw, form.late.checked, +form.daysLate.value || 0, form.mitigating.value === 'yes');
    pm.textContent = c.finalMark; pg.textContent = c.grade; pp.textContent = c.penalty;
  }
  ['input', 'change'].forEach(t => { form.rawMark.addEventListener(t, updatePreview); form.daysLate.addEventListener(t, updatePreview); });

  // ---------- Notes character count ----------
  // Characters left in the notes box. It is not read out on every key press (that would be annoying),
  // but it is linked to the box so screen readers read it when the box gets focus.
  const notesCount = $('#notes-count');
  const updateCount = () => {
    const left = 500 - form.notes.value.length;
    notesCount.textContent = `You have ${left} character${left === 1 ? '' : 's'} remaining.`;
  };
  notesCount.removeAttribute('aria-live'); // avoid announcing on every keystroke; read via aria-describedby
  form.notes.addEventListener('input', updateCount);

  // ---------- Client-side validation (error prevention) ----------
  // Reads the form into the object that is sent to the server.
  function data() {
    return {
      studentNumber: form.studentNumber.value.trim().toUpperCase(),
      moduleCode: form.moduleCode.value,
      assessment: form.assessment.value,
      attempt: form.attempt.value,
      rawMark: form.rawMark.value.trim() === '' ? '' : Number(form.rawMark.value.trim()),
      late: form.late.checked,
      daysLate: form.late.checked ? Number(form.daysLate.value.trim() || NaN) : 0,
      mitigating: form.mitigating.value === 'yes',
      mitigatingReason: form.mitigating.value === 'yes' ? form.mitigatingReason.value : '',
      notes: form.notes.value,
    };
  }
  // Browser checks. Messages explain exactly what is wrong and how to fix it.
  function validate(d) {
    const e = {};
    const s = byNumber.get(d.studentNumber);
    if (!d.studentNumber) e.studentNumber = 'Enter a student number.';
    else if (!/^S\d{7}$/.test(d.studentNumber)) e.studentNumber = 'Student number must be the letter S followed by 7 digits, for example S2300107.';
    else if (!s) e.studentNumber = 'No student has this number. Check it, or add the student first.';
    else if (s.status === 'Withdrawn') e.studentNumber = `${s.name} has withdrawn, so marks cannot be recorded.`;
    if (!d.moduleCode) e.moduleCode = 'Choose a module.';
    if (form.rawMark.value.trim() === '') e.rawMark = 'Enter the mark out of 100.';
    else if (!/^\d+$/.test(form.rawMark.value.trim()) || d.rawMark > 100) e.rawMark = 'Mark must be a whole number from 0 to 100.';
    if (d.late && (!Number.isInteger(d.daysLate) || d.daysLate < 1 || d.daysLate > 60)) e.daysLate = 'Enter how many days late, from 1 to 60.';
    if (d.mitigating && !d.mitigatingReason) e.mitigatingReason = 'Choose the reason for mitigating circumstances.';
    return e;
  }
  // Re-check a field when leaving it, after the first submit (same as the other forms).
  form.addEventListener('focusout', ev => {
    if (!submitted || !ev.target.name) return;
    // Don't reflow the form while the user is heading to a submit button (the button would move under the pointer)
    if (ev.relatedTarget?.type === 'submit') return;
    const name = ev.target.name;
    afterClick(() => setFieldError(form, name, validate(data())[name] || ''));
  });

  // ---------- Prefill: edit mode, ?student=, remembered module ----------
  // Fill the form:
  // - edit mode loads the saved mark and only shows one save button
  // - a new mark reuses the last module and assessment type (saves time when entering a whole class)
  // - ?student=S1234567 in the address fills the student (from the "Add mark" link on the students page)
  // Then focus goes to the first empty field.
  if (editId) {
    $('#page-title').textContent = 'Edit a mark';
    document.title = 'Edit a mark – Exam Office Records';
    $('#save-another').hidden = true;
    $('#save-done').textContent = 'Save changes';
    $('#save-done').classList.replace('btn-secondary', 'btn-primary');
    $('#form-loading').hidden = false;
    form.hidden = true;
    try {
      const m = await api(`/api/marks/${editId}`);
      form.studentNumber.value = m.studentNumber;
      form.moduleCode.value = m.moduleCode;
      form.querySelector(`[name="assessment"][value="${m.assessment}"]`).checked = true;
      form.querySelector(`[name="attempt"][value="${m.attempt}"]`).checked = true;
      form.rawMark.value = m.rawMark;
      form.late.checked = m.late; toggleSection(lateSection, m.late);
      form.daysLate.value = m.late ? m.daysLate : '';
      form.querySelector(`[name="mitigating"][value="${m.mitigating ? 'yes' : 'no'}"]`).checked = true;
      toggleSection(mitSection, m.mitigating);
      form.mitigatingReason.value = m.mitigatingReason || '';
      form.notes.value = m.notes || '';
    } catch (err) { toast(err.message, 'error'); }
    $('#form-loading').hidden = true;
    form.hidden = false;
  } else {
    const lastModule = store.get('lastModule');
    if (lastModule) form.moduleCode.value = lastModule;
    const lastAssessment = store.get('lastAssessment');
    if (lastAssessment) { const r = form.querySelector(`[name="assessment"][value="${lastAssessment}"]`); if (r) r.checked = true; }
    const pre = new URLSearchParams(location.search).get('student');
    if (pre) form.studentNumber.value = pre.toUpperCase();
  }
  resolveStudent(); updatePreview(); updateCount();
  (form.studentNumber.value ? form.rawMark : form.studentNumber).focus();

  // ---------- Submit ----------
  // Save.
  // Pressing Enter uses the first button, "Save and enter another".
  // After saving:
  // - "Save and view records" goes to the marks list
  // - "Save and enter another" shows a message, clears only the student, mark and adjustments,
  //   keeps module, assessment and attempt, and puts focus back on the student number box
  // If it is a duplicate, the error summary gets an extra link to edit the existing mark.
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = ev.submitter || $('#save-another');
    if (isBusy($('#save-another')) || isBusy($('#save-done'))) return;
    const action = editId ? 'done' : (btn.value || 'another');
    submitted = true;
    const d = data();
    const errs = validate(d);
    if (Object.keys(errs).length) return showErrors(form, errs);
    clearErrors(form);
    busy(btn, true);
    try {
      const res = await api(editId ? `/api/marks/${editId}` : '/api/marks', { method: editId ? 'PUT' : 'POST', body: d });
      store.set('lastModule', d.moduleCode);
      store.set('lastAssessment', d.assessment);
      if (action === 'done') { flash(res.message); location.href = '/marks'; return; }
      busy(btn, false);
      toast(res.message, 'success', { action: { href: `/marks/${res.id}/edit`, label: 'Edit this mark' } });
      // Keep module / assessment / attempt; clear the per-student fields
      form.studentNumber.value = ''; form.rawMark.value = ''; form.notes.value = '';
      form.late.checked = false; form.daysLate.value = ''; toggleSection(lateSection, false);
      form.querySelector('#mitigating-no').checked = true; form.mitigatingReason.value = ''; toggleSection(mitSection, false);
      submitted = false;
      resolveStudent(); updatePreview(); updateCount();
      form.studentNumber.focus();
    } catch (err) {
      busy(btn, false);
      if (err.errors && Object.keys(err.errors).length) {
        showErrors(form, err.errors);
        if (err.data?.duplicateId) {
          const li = document.createElement('li');
          li.innerHTML = `<a href="/marks/${err.data.duplicateId}/edit">Edit the existing mark instead</a>`;
          $('#error-summary ul').append(li);
        }
      } else toast(err.message, 'error');
    }
  });
  void escapeHtml;
});
