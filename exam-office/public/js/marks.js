// marks.js
// Marks records page: sets up the shared table for marks and handles deleting.
'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const { $, api, getMeta, fillSelect, currentUser, escapeHtml, gradeTag, formatDate, toast } = App;
  const [meta, me] = await Promise.all([getMeta(), currentUser()]);
  fillSelect($('#module'), meta.modules, 'code', m => `${m.code} – ${m.title}`);
  const isAdmin = me.role === 'admin';

  // Column labels, used for the card labels on mobile. The student name is the row header.
  const columns = [
    { label: 'Student', rowHeader: true }, { label: 'Module' }, { label: 'Assessment' }, { label: 'Final mark', cls: 'num' },
    { label: 'Grade' }, { label: 'Flags' }, { label: 'Updated' }, { label: 'Actions', cls: 'actions-cell' },
  ];

  // Draws each mark row. Flags (late, mitigating, resit) are text labels, not just colours.
  // If a late penalty changed the mark, the raw mark is shown underneath.
  // The Edit and Delete buttons have hidden extra text (e.g. "Edit mark for Amira Hassan, 5FTC2091 exam")
  // so screen reader users know which row each button is for.
  // Only administrators get a Delete button.
  const table = DataTable({
    endpoint: '/api/marks', columns, defaultSort: 'updated', defaultDir: 'desc', noun: ['mark', 'marks'],
    renderCells: m => {
      const flags = [];
      if (m.late) flags.push(`<span class="tag tag-warn">Late ${m.daysLate} day${m.daysLate === 1 ? '' : 's'}</span>`);
      if (m.mitigating) flags.push(`<span class="tag tag-neutral">Mitigating<span class="visually-hidden">:</span></span><span class="cell-sub">${escapeHtml(m.mitigatingReason)}</span>`);
      if (m.attempt === 'Resit') flags.push('<span class="tag tag-neutral">Resit</span>');
      const label = `${m.studentName}, ${m.moduleCode} ${m.assessment.toLowerCase()}`;
      return [
        `${escapeHtml(m.studentName)}<span class="cell-sub">${escapeHtml(m.studentNumber)}</span>`,
        escapeHtml(m.moduleCode),
        escapeHtml(m.assessment),
        `<strong>${m.finalMark}</strong>${m.finalMark !== m.rawMark ? `<span class="cell-sub">raw ${m.rawMark}</span>` : ''}`,
        gradeTag(m.grade),
        flags.join('') || '<span class="cell-sub">None</span>',
        `<span class="cell-date">${formatDate(m.updatedAt).replace(', ', '</span><span class="cell-sub">')}</span>`,
        `<div class="row-actions">
          <a class="btn btn-secondary btn-small" href="/marks/${m.id}/edit">Edit<span class="visually-hidden"> mark for ${escapeHtml(label)}</span></a>
          ${isAdmin ? `<button type="button" class="btn btn-quiet btn-small" data-delete="${m.id}">Delete<span class="visually-hidden"> mark for ${escapeHtml(label)}</span></button>` : ''}
        </div>`,
      ];
    },
  });

  // Delete: one listener on the table body handles every Delete button (event delegation).
  // The confirmation names exactly what will be deleted.
  $('#rows').addEventListener('click', async e => {
    const b = e.target.closest('[data-delete]');
    if (!b) return;
    const m = table.rows().find(r => r.id === +b.dataset.delete);
    const ok = await table.confirmDelete(`This will permanently delete the ${m.assessment.toLowerCase()} mark of ${m.finalMark} for ${m.studentName} (${m.studentNumber}) in ${m.moduleCode}. This cannot be undone.`);
    if (!ok) return;
    try {
      await api(`/api/marks/${m.id}`, { method: 'DELETE' });
      toast(`Mark for ${m.studentName} in ${m.moduleCode} deleted.`);
      await table.reload({ focusCount: true });
    } catch (err) { toast(err.message, 'error'); }
  });
});
