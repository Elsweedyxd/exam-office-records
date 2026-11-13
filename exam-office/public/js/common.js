// common.js
// Helpers used on every page: calling the server, status messages, busy buttons,
// showing form errors, and the sign-out button.
// Everything is inside App so it does not clash with other scripts.
'use strict';

const App = (() => {
  // Short helpers: $ finds one element, $$ finds all matching elements as an array.
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // Every call to the server goes through this function.
  // It sends and receives JSON, and turns problems into errors with a clear message:
  // - no internet -> "Could not reach the server"
  // - 401 (session ended) -> save a message and go to the sign-in page, remembering this page
  // - 422 / 409 -> the error keeps the list of field errors so the form can show them
  async function api(url, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } catch {
      const err = new Error('Could not reach the server. Check your internet connection and try again.');
      err.status = 0; throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      sessionStorage.setItem('flash', JSON.stringify({ message: 'Your session ended. Please sign in again.', type: 'error' }));
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Signed out');
    }
    if (!res.ok) {
      const err = new Error(data.message || 'Something went wrong. Please try again.');
      Object.assign(err, { status: res.status, errors: data.errors || {}, data });
      throw err;
    }
    return data;
  }

  // Shows a small message box in the corner (for example "Mark saved").
  // The box is added inside a live region that is already on the page, so screen readers
  // read it out without moving focus. Success uses the polite region, errors the assertive one.
  // It stays for 10 seconds, stops counting while the mouse is over it or it has focus,
  // and has a Dismiss button, so people who read slowly are not rushed.
  function toast(message, type = 'success', { action } = {}) {
    const region = type === 'error' ? ($('#alert-region') || $('#toast-region')) : $('#toast-region');
    if (!region) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    // No role here: the region itself is a polite live region that already exists in the page,
    // which screen readers announce reliably (dynamically-added role=status often is not).
    const label = type === 'error' ? 'Error:' : 'Success:';
    el.innerHTML = `<p><span class="toast-title">${label}</span> <span class="toast-text"></span></p>`;
    el.querySelector('.toast-text').textContent = message;
    if (action) {
      const a = document.createElement('a'); a.href = action.href; a.textContent = action.label; a.className = 'toast-action';
      el.querySelector('p').append(' ', a);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'link-btn'; close.textContent = 'Dismiss';
    close.setAttribute('aria-label', 'Dismiss message');
    close.addEventListener('click', () => el.remove());
    el.append(close);
    region.append(el);
    let timer = setTimeout(() => el.remove(), 10000);
    // Pause auto-dismiss while hovered or focused
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(() => el.remove(), 6000); });
  }

  // flash saves a message before going to another page, and showFlash shows it
  // on the next page. Used for "You are signed in" and "Student saved".
  function flash(message, type = 'success') { sessionStorage.setItem('flash', JSON.stringify({ message, type })); }
  function showFlash() {
    const f = sessionStorage.getItem('flash');
    if (!f) return;
    sessionStorage.removeItem('flash');
    try { const { message, type } = JSON.parse(f); setTimeout(() => toast(message, type), 300); } catch {}
  }

  // Shows a spinner and text like "Saving..." on a button while waiting for the server.
  // I use aria-disabled instead of disabled because a disabled button loses keyboard focus,
  // which would leave keyboard and screen reader users lost on the page.
  function busy(btn, on) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      // aria-disabled (not disabled) so keyboard focus is not lost while saving
      btn.setAttribute('aria-disabled', 'true');
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${btn.dataset.busyLabel || 'Working…'}`;
    } else if (btn.dataset.label) {
      btn.innerHTML = btn.dataset.label;
      btn.removeAttribute('aria-disabled');
    }
  }

  // ---------- Form errors (GOV.UK-style summary + inline messages) ----------
  // Find a field's wrapper div (data-field="name") and its input.
  function fieldWrap(form, name) { return form.querySelector(`[data-field="${name}"]`); }
  function firstControl(form, name) { return form.querySelector(`[name="${name}"]`); }

  // Shows or clears the error for one field.
  // It adds the red bar and border (has-error), puts the message in the error paragraph
  // ("Error:" is hidden visually but read by screen readers), and sets aria-invalid.
  // The input is already linked to the error paragraph by aria-describedby,
  // so screen readers read the message when the field gets focus.
  function setFieldError(form, name, message) {
    const wrap = fieldWrap(form, name);
    if (!wrap) return;
    const msg = wrap.querySelector('.error-msg');
    const controls = $$(`[name="${name}"]`, form);
    if (message) {
      wrap.classList.add('has-error');
      if (msg) { msg.hidden = false; msg.innerHTML = '<span class="visually-hidden">Error:</span> '; msg.append(message); }
      controls.forEach(c => c.setAttribute('aria-invalid', 'true'));
    } else {
      wrap.classList.remove('has-error');
      if (msg) { msg.hidden = true; msg.textContent = ''; }
      controls.forEach(c => c.removeAttribute('aria-invalid'));
    }
  }

  // Removes all errors from a form and hides the error summary.
  function clearErrors(form) {
    $$('[data-field]', form).forEach(w => setFieldError(form, w.dataset.field, ''));
    const summary = $('#error-summary');
    if (summary) summary.hidden = true;
  }

  // Shows every error at once (this pattern is based on the GOV.UK error summary):
  // - each field gets its inline message
  // - the summary box at the top lists every problem in the same order as the form
  // - each item is a link that moves focus to the field
  // - focus moves to the summary so screen reader users hear about the problems straight away
  function showErrors(form, errors, heading) {
    clearErrors(form);
    const summary = $('#error-summary');
    const list = summary?.querySelector('ul');
    if (list) list.innerHTML = '';
    // keep the order of the fields on the page
    const names = $$('[data-field]', form).map(w => w.dataset.field).filter(n => errors[n]);
    Object.keys(errors).forEach(n => { if (!names.includes(n)) names.push(n); });
    names.forEach(name => {
      setFieldError(form, name, errors[name]);
      if (list) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        const ctl = firstControl(form, name);
        a.href = '#' + (ctl?.id || name);
        a.textContent = errors[name];
        a.addEventListener('click', e => { e.preventDefault(); ctl?.focus(); ctl?.scrollIntoView({ block: 'center' }); });
        li.append(a); list.append(li);
      }
    });
    if (summary && names.length) {
      summary.querySelector('h2').textContent = heading || (names.length === 1 ? 'There is a problem' : `There are ${names.length} problems`);
      summary.hidden = false;
      summary.focus();
      summary.scrollIntoView({ block: 'start' });
    }
  }

  // For errors that are not about one field, for example "wrong email or password".
  function showSummaryMessage(message) {
    const summary = $('#error-summary');
    if (!summary) return toast(message, 'error');
    summary.querySelector('h2').textContent = 'There is a problem';
    const list = summary.querySelector('ul');
    list.innerHTML = '';
    const li = document.createElement('li'); li.textContent = message; list.append(li);
    summary.hidden = false; summary.focus();
  }

  // Shows or hides the extra sections that appear when a box is ticked or a radio is chosen.
  function toggleSection(section, show) {
    section.hidden = !show;
    // Note: aria-expanded is not valid on radio/checkbox roles (found by axe), so we rely on
    // aria-controls plus the section appearing directly after the control in reading order.
  }

  // Turns the database date (UTC) into a readable UK date and time, e.g. 11 Nov 2026, 16:39.
  function formatDate(sqlDate) {
    if (!sqlDate) return '';
    const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // Escapes text before putting it in HTML, so a name like <script> shows as text
  // and cannot run as code.
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Grade label. It always shows the grade text, the colour is only extra (colour is not the only clue).
  function gradeTag(grade) {
    const cls = grade === 'Fail' ? 'tag-fail' : 'tag-pass';
    return `<span class="tag ${cls}">${escapeHtml(grade)}</span>`;
  }

  // Waits until a mouse click / tap has finished before running fn.
  // Removing an error message makes the form shorter. If that happens while the mouse button is
  // down, the thing being clicked moves away and the click is lost. So changes made when a field
  // loses focus are held until the click is complete. (Found while testing: radio buttons sometimes missed clicks.)
  let pointerIsDown = false;
  const waiting = [];
  document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
  document.addEventListener('pointerup', () => {
    setTimeout(() => { pointerIsDown = false; waiting.splice(0).forEach(fn => fn()); }, 0);
  }, true);
  function afterClick(fn) { if (pointerIsDown) waiting.push(fn); else fn(); }

  // ---------- Page setup ----------
  // Show / Hide password button. aria-pressed tells screen readers if it is on or off.
  function initPasswordToggles() {
    $$('.toggle-password').forEach(btn => btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.firstChild.textContent = show ? 'Hide' : 'Show';
    }));
  }

  // When any page loads: show any flash message, set up password buttons and the sign-out button.
  document.addEventListener('DOMContentLoaded', () => {
    showFlash();
    initPasswordToggles();
    // Menu button on small screens: opens and closes the menu, and Esc closes it again.
    const toggle = $('#menu-toggle');
    if (toggle) {
      const panel = $('#sidebar-panel');
      const setOpen = open => { toggle.setAttribute('aria-expanded', String(open)); panel.classList.toggle('is-open', open); };
      toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
      panel.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); toggle.focus(); } });
    }
    const out = $('#sign-out');
    if (out) out.addEventListener('click', async () => {
      out.dataset.busyLabel = 'Signing out…'; busy(out, true);
      try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
      flash('You have signed out.');
      location.href = '/login';
    });
  });

  // currentUser and getMeta remember their answer, so each page only asks the server once.
  let me = null;
  async function currentUser() { if (!me) me = await api('/api/me'); return me; }
  let meta = null;
  async function getMeta() { if (!meta) meta = await api('/api/meta'); return meta; }

  // Adds <option>s to a drop-down from a list.
  function fillSelect(select, items, valueKey, labelFn) {
    items.forEach(it => {
      const o = document.createElement('option');
      o.value = valueKey ? it[valueKey] : it;
      o.textContent = labelFn ? labelFn(it) : it;
      select.append(o);
    });
  }

  // True while a button is showing its busy state, used to stop double submits.
  const isBusy = btn => btn?.getAttribute('aria-disabled') === 'true';

  return { $, $$, api, isBusy, afterClick, toast, flash, busy, showErrors, clearErrors, setFieldError, showSummaryMessage, toggleSection,
    formatDate, escapeHtml, gradeTag, currentUser, getMeta, fillSelect };
})();
