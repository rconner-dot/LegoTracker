#!/usr/bin/env node
// Checks SPIKE Prime programs (.llsp3) against the assignment requirements.
// On Windows, drag one or more .llsp3 files (or a folder) onto
// "Check LEGO programs". The assignment is guessed from the file name; to
// choose it yourself:
//
//   node scripts/check-llsp3.js --assignment "Moving Forward" file1.llsp3 file2.llsp3
//   node scripts/check-llsp3.js --list
'use strict';

const fs = require('fs');
const path = require('path');
const { gradeFile, listAssignments, findRule } = require('../lib/grading');

// The Windows console font lacks ✔/✘, so use plain text there.
const WIN = process.platform === 'win32';
const ICON = WIN ? { pass: '[OK]', fail: '[X] ', review: '[?] ' } : { pass: '✔', fail: '✘', review: '?' };
const STATUS = { complete: `${ICON.pass} COMPLETE`, 'needs-work': `${ICON.fail} NEEDS WORK`, review: `${ICON.review} CHECK BY HAND` };
const LINE = (WIN ? '=' : '═').repeat(64);

function files(args) {
  const out = [];
  for (const a of args) {
    if (!fs.existsSync(a)) { console.log(`  Can't find ${a}`); continue; }
    if (fs.statSync(a).isDirectory()) out.push(...fs.readdirSync(a).filter((f) => /\.llsp3?$/i.test(f)).map((f) => path.join(a, f)));
    else out.push(a);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const a of listAssignments()) console.log(`  ${a.id}  ${a.name}`);
    return;
  }
  let assignment = null;
  const i = args.indexOf('--assignment');
  if (i >= 0) {
    assignment = args[i + 1];
    args.splice(i, 2);
    if (!findRule(assignment)) {
      console.log(`\n  Unknown assignment “${assignment}”. Use --list to see them.\n`);
      process.exitCode = 1;
      return;
    }
  }
  const list = files(args);
  if (!list.length) {
    console.log('\n  Drag .llsp3 files (or a folder of them) onto “Check LEGO programs”.');
    console.log('  Or: node scripts/check-llsp3.js [--assignment "Moving Forward"] file.llsp3 …\n');
    return;
  }
  const tally = { complete: 0, 'needs-work': 0, review: 0 };
  for (const file of list) {
    const r = gradeFile(fs.readFileSync(file), { assignment, filename: path.basename(file) });
    tally[r.status]++;
    console.log(`\n${LINE}\n  ${path.basename(file)}`);
    console.log(`  ${r.assignment ? r.assignment.name : 'Assignment not recognised (use --assignment)'}`);
    console.log(`  ${STATUS[r.status]}${r.score != null ? `  (${r.score}% of checks)` : ''}\n`);
    for (const c of r.checks) console.log(`   ${ICON[c.status]} ${c.label}${c.optional ? ' (optional)' : ''}\n       ${c.detail || ''}`);
    if (r.program.length) console.log(`\n  Program:\n${r.program.map((l) => `    ${l}`).join('\n')}`);
    if (r.feedback) console.log(`\n  Feedback for the student:\n${r.feedback.split('\n').map((l) => `    ${l}`).join('\n')}`);
  }
  if (list.length > 1) console.log(`\n${LINE}\n  ${list.length} files: ${tally.complete} complete, ${tally['needs-work']} need work, ${tally.review} to check by hand\n`);
}

main();
