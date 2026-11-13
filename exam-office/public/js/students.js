// students.js
// Students page: sets up the shared table for students and handles deleting.
'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const { $, api, getMeta, fillSelect, currentUser, escapeHtml, toast } = App;
  const [meta, me] = await Promise.all([getMeta(), currentUser()]);
  fillSelect($('#programme'), meta.programmes);
  const isAdmin = me.role === 'admin';

  const columns = [
    { label: 'Name', rowHeader: true }, { label: 'Student number' }, { label: 'Programme' }, { label: 'Year', cls: 'num' },
    { label: 'Status' }, { label: 'Average mark', cls: 'num' }, { label: 'Actions', cls: 'actions-cell' },
  ];
  // Status label with text and colour.
  const statusTag = s => `<span class="tag ${s === 'Active' ? 'tag-pass' : s === 'Withdrawn' ? 'tag-fail' : 'tag-warn'}">${s}</span>`;

  // Draws each student row with quick links to their marks and to add a mark for them,
  // so the user does not need to remember or copy the student number (recognition over recall).
  const table = DataTable({
    endpoint: '/api/students', columns, noun: ['student', 'students'], defaultSort: 'name',
    renderCells: s => {
      const name = `${s.firstName} ${s.lastName}`;
      return [
        `${escapeHtml(s.lastName)}, ${escapeHtml(s.firstName)}${s.supportPlan ? '<span class="cell-sub">Has support plan</span>' : ''}`,
        escapeHtml(s.studentNumber),
        escapeHtml(s.programme),
        s.yearOfStudy,
        statusTag(s.status),
        s.average == null ? '<span class="cell-sub">No marks</span>' : `${s.average}<span class="cell-sub">${s.markCount} mark${s.markCount === 1 ? '' : 's'}</span>`,
        `<div class="row-actions">
          <a class="btn btn-secondary btn-small" href="/marks?student=${encodeURIComponent(s.studentNumber)}">Marks<span class="visually-hidden"> for ${escapeHtml(name)}</span></a>
          ${s.status !== 'Withdrawn' ? `<a class="btn btn-secondary btn-small" href="/marks/new?student=${encodeURIComponent(s.studentNumber)}">Add mark<span class="visually-hidden"> for ${escapeHtml(name)}</span></a>` : ''}
          <a class="btn btn-quiet btn-small" href="/students/${s.id}/edit">Edit<span class="visually-hidden"> ${escapeHtml(name)}</span></a>
          ${isAdmin ? `<button type="button" class="btn btn-quiet btn-small" data-delete="${s.id}">Delete<span class="visually-hidden"> ${escapeHtml(name)}</span></button>` : ''}
        </div>`,
      ];
    },
  });

  // Delete a student (administrators only). The message says how many marks will also be deleted.
  $('#rows').addEventListener('click', async e => {
    const b = e.target.closest('[data-delete]');
    if (!b) return;
    const s = table.rows().find(r => r.id === +b.dataset.delete);
    const ok = await table.confirmDelete(`This will permanently delete ${s.firstName} ${s.lastName} (${s.studentNumber}) and all ${s.markCount} of their marks. This cannot be undone.`);
    if (!ok) return;
    try {
      await api(`/api/students/${s.id}`, { method: 'DELETE' });
      toast(`${s.firstName} ${s.lastName} deleted.`);
      await table.reload({ focusCount: true });
    } catch (err) { toast(err.message, 'error'); }
  });
});
