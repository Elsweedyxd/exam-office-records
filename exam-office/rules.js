// rules.js
// The business rules: lists of modules and programmes, the late penalty and the grade boundaries.
// The server uses this file when saving. public/js/rules.js is a copy of the same rules
// for the live preview on the marks form.
const MODULES = [
  { code: '5FTC2091', title: 'Algorithms and Data Structures' },
  { code: '5FTC2092', title: 'Accessibility and Usability' },
  { code: '5FTC2093', title: 'Databases' },
  { code: '5FTC2094', title: 'Web Development' },
  { code: '5FTC2095', title: 'Software Engineering' },
  { code: '5FTC2096', title: 'Machine Learning Fundamentals' },
];

const PROGRAMMES = [
  'BSc Computer Science',
  'BSc Software Engineering',
  'BSc Data Science',
  'BSc Cyber Security',
];

const MITIGATING_REASONS = ['Illness', 'Bereavement', 'Personal circumstances', 'Disability-related', 'Other'];

/**
 * Late-submission policy (a typical UK university rule):
 *  - up to 5 days late: mark capped at 40 (pass mark)
 *  - more than 5 days late: mark becomes 0
 *  - accepted mitigating circumstances remove the late penalty
 */
function calculate(rawMark, late, daysLate, mitigating) {
  let finalMark = Number(rawMark);
  let penalty = 'None';
  if (late && !mitigating) {
    if (daysLate > 5) { finalMark = 0; penalty = 'More than 5 days late: mark set to 0'; }
    else if (finalMark > 40) { finalMark = 40; penalty = 'Up to 5 days late: capped at 40'; }
    else penalty = 'Up to 5 days late: capped at 40 (no change)';
  }
  return { finalMark, grade: grade(finalMark), penalty };
}

// UK degree grade boundaries.
function grade(m) {
  if (m >= 70) return 'First';
  if (m >= 60) return 'Upper second (2:1)';
  if (m >= 50) return 'Lower second (2:2)';
  if (m >= 40) return 'Third';
  return 'Fail';
}

// Shared with server.js and db.js.
module.exports = { MODULES, PROGRAMMES, MITIGATING_REASONS, calculate, grade };
