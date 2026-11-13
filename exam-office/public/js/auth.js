// auth.js
// Sign-in and sign-up forms: checking the fields, the Administrator access code field,
// the "Signing in..." state and showing errors.
'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const { afterClick, $, api, busy, isBusy, showErrors, clearErrors, setFieldError, showSummaryMessage, toggleSection, flash } = App;
  // This one file runs both the sign-in and the sign-up page.
  const form = $('#login-form') || $('#signup-form');
  const isSignup = form.id === 'signup-form';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let submitted = false;

  // Safe redirect target (same-site paths only)
  // Where to go after signing in. Only addresses on this site are allowed (starting with one /)
  // so a link cannot send the user to another website.
  const next = new URLSearchParams(location.search).get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  // Dynamic field: administrator access code appears only when "Administrator" is chosen
  // Show the access code field only when Administrator is picked, and clear its error if they change back.
  const codeSection = $('#admin-code-section');
  if (codeSection) {
    form.querySelectorAll('[name="role"]').forEach(r => r.addEventListener('change', () => {
      toggleSection(codeSection, form.role.value === 'admin');
      if (form.role.value !== 'admin') setFieldError(form, 'adminCode', '');
    }));
  }

  // Reads all the form fields into an object, e.g. { email: '...', password: '...' }.
  function values() {
    const v = Object.fromEntries(new FormData(form));
    if (v.email) v.email = v.email.trim();
    return v;
  }

  // Checks the form in the browser first so the user gets quick, clear messages.
  // The server checks again anyway.
  function validate(v) {
    const e = {};
    if (isSignup) {
      if ((v.fullName || '').trim().length < 2) e.fullName = 'Enter your full name.';
      if (!v.email) e.email = 'Enter your work email address.';
      else if (!EMAIL_RE.test(v.email)) e.email = 'Enter an email address in the format name@example.com.';
      if (!v.password) e.password = 'Enter a password.';
      else if (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password))
        e.password = 'Password must be at least 8 characters and include a letter and a number.';
      if (!v.confirmPassword) e.confirmPassword = 'Enter the password again to confirm it.';
      else if (v.confirmPassword !== v.password) e.confirmPassword = 'Passwords do not match. Type the same password in both fields.';
      if (v.role === 'admin' && !(v.adminCode || '').trim()) e.adminCode = 'Enter the administrator access code.';
    } else {
      if (!v.email) e.email = 'Enter your email address.';
      else if (!EMAIL_RE.test(v.email)) e.email = 'Enter an email address in the format name@example.com.';
      if (!v.password) e.password = 'Enter your password.';
    }
    return e;
  }

  // After the first submit, re-check a field when the user leaves it, so errors clear as they are fixed
  // After the first try, check each field again when the user leaves it,
  // so the error goes away as soon as it is fixed.
  form.addEventListener('focusout', ev => {
    if (!submitted || !ev.target.name) return;
    // Don't reflow the form while the user is heading to a submit button (the button would move under the pointer)
    if (ev.relatedTarget?.type === 'submit') return;
    const name = ev.target.name;
    afterClick(() => setFieldError(form, name, validate(values())[name] || ''));
  });

  // Submit: check, show the busy state, send to the server, then go to the next page.
  // If the server finds problems they are shown the same way as browser errors.
  // After a wrong password the password box is cleared so they can type it again.
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    if (isBusy(btn)) return;
    submitted = true;
    const v = values();
    const errs = validate(v);
    if (Object.keys(errs).length) return showErrors(form, errs);
    clearErrors(form);
    busy(btn, true);
    try {
      await api(form.dataset.endpoint, { method: 'POST', body: v });
      flash(isSignup ? `Welcome, ${v.fullName.trim()}. Your account has been created.` : 'You are signed in.');
      location.href = target;
    } catch (err) {
      busy(btn, false);
      if (err.errors && Object.keys(err.errors).length) showErrors(form, err.errors);
      else {
        showSummaryMessage(err.message);
        if (!isSignup && err.status === 401) { form.password.value = ''; }
      }
    }
  });
});
