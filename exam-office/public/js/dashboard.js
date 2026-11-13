// dashboard.js
// Fills in the dashboard: greeting, summary numbers and recent marks.
'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const { $, api, currentUser, escapeHtml, formatDate, gradeTag, toast } = App;
  // Get the user and the numbers at the same time, then fill in the page.
  // The loading message is shown until the numbers arrive.
  try {
    const [me, s] = await Promise.all([currentUser(), api('/api/stats')]);
    // Today's date above the heading, and a greeting that changes with the time of day.
    $('#today').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting').textContent = `${part}, ${me.fullName.split(' ')[0]}. Choose a task below, or use the main menu.`;
    $('#stat-students').textContent = s.students;
    $('#stat-marks').textContent = s.marks;
    $('#stat-fails').textContent = s.fails;
    $('#stat-mitigating').textContent = s.mitigating;
    $('#stat-late').textContent = s.late;
    $('#stats-loading').hidden = true;
    $('#stats').hidden = false;
    // Recently updated marks. If there are none, show a helpful message with a link (empty state).
    $('#recent').innerHTML = s.recent.length
      ? s.recent.map(m => `<li>
          <span class="recent-mark" aria-hidden="true">${m.final_mark}</span>
          <span class="recent-main"><a href="/marks/${m.id}/edit">${escapeHtml(m.student_name)}<span class="visually-hidden">, edit mark</span></a>
            <span class="recent-meta">${escapeHtml(m.module_code)} · ${escapeHtml(m.assessment)} · ${formatDate(m.updated_at)}</span></span>
          <span class="recent-grade"><span class="visually-hidden">Final mark ${m.final_mark}, </span>${gradeTag(m.grade)}</span></li>`).join('')
      : '<li>No marks have been recorded yet. <a href="/marks/new">Enter the first mark</a>.</li>';
  } catch (err) {
    // If loading fails, say so on the page and show an error message.
    $('#stats-loading').textContent = 'The summary could not be loaded. Refresh the page to try again.';
    toast(err.message, 'error');
  }
});
