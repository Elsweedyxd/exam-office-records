// public/js/rules.js
// Browser copy of the rules in /rules.js, used for the live "Result preview" on the marks form.
// The server always does the real calculation when saving, this is only a preview.
'use strict';
const Rules = {
  // Same grade boundaries as the server.
  grade(m) {
    if (m >= 70) return 'First';
    if (m >= 60) return 'Upper second (2:1)';
    if (m >= 50) return 'Lower second (2:2)';
    if (m >= 40) return 'Third';
    return 'Fail';
  },
  // Works out the final mark after any late penalty. It also explains the penalty in words
  // so the user can see why the mark changed (visibility of system status).
  calculate(raw, late, daysLate, mitigating) {
    let finalMark = Number(raw);
    let penalty = 'None';
    if (late && !mitigating && daysLate > 0) {
      if (daysLate > 5) { finalMark = 0; penalty = 'More than 5 days late: mark set to 0'; }
      else if (finalMark > 40) { finalMark = 40; penalty = 'Up to 5 days late: capped at 40'; }
      else penalty = 'Up to 5 days late: capped at 40 (no change)';
    } else if (late && mitigating) penalty = 'Removed: mitigating circumstances accepted';
    return { finalMark, grade: Rules.grade(finalMark), penalty };
  },
};
