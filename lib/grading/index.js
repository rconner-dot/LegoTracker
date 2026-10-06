// Grades a student's .llsp3 file against an assignment's rules.
//
//   gradeFile(buffer, { assignment: '910143' | 'Moving Forward' | null, filename })
//   → { assignment, status: 'complete' | 'needs-work' | 'review', score, checks, feedback, program }
//
// status: complete    every required check passed
//         needs-work  at least one required check failed
//         review      nothing failed, but something needs the teacher's eyes
'use strict';

const { readLlsp3, Llsp3Error } = require('../llsp3');
const { parseProject, outline } = require('./program');
const { RULES } = require('./rules');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function listAssignments() {
  return RULES.map((r) => ({ id: r.id, name: r.name, checks: r.checks.length }));
}

// Find a rule by Canvas id, exact name, or a name/alias appearing in the text.
function findRule(query) {
  if (!query) return null;
  const q = norm(query);
  return RULES.find((r) => r.id === String(query).trim())
    || RULES.find((r) => norm(r.name) === q)
    || RULES.find((r) => norm(r.name).includes(q) && q.length >= 4)
    || null;
}

// Guess the assignment from the file or project name ("Sequential Movements Neil Armstrong").
function guessRule(...texts) {
  const hay = ` ${texts.map(norm).join(' ')} `;
  const strip = (n) => n.replace(/^(lesson|final challenge|mini challenge|challenge) /, '');
  let best = null;
  for (const r of RULES) {
    for (const a of [strip(norm(r.name)), ...r.aliases.map(norm)]) {
      if (a && hay.includes(` ${a} `) && (!best || a.length > best.len)) best = { rule: r, len: a.length };
    }
  }
  return best ? best.rule : null;
}

function summarize(rule, checks) {
  const required = checks.filter((c) => !c.optional);
  const failed = required.filter((c) => c.status === 'fail');
  const reviewing = required.filter((c) => c.status === 'review');
  const decided = required.filter((c) => c.status !== 'review');
  const status = failed.length ? 'needs-work' : reviewing.length ? 'review' : 'complete';
  const score = decided.length ? Math.round((decided.filter((c) => c.status === 'pass').length / decided.length) * 100) : null;
  const tips = failed.map((c) => c.hint).filter(Boolean);
  const feedback = status === 'complete'
    ? `Great job! Your program meets every requirement for “${rule.name}”.`
    : status === 'review'
      ? 'Your program has everything we can check automatically. Your teacher will take a look at the rest.'
      : `Almost there! To finish “${rule.name}”:\n${tips.map((t) => `• ${t}`).join('\n')}`;
  return { status, score, feedback };
}

function gradeProgram(file, rule) {
  if (file.type === 'python' || file.python != null) {
    return { status: 'review', score: null, checks: [{ label: 'Word Blocks program', status: 'review', detail: 'This is a Python project, which can’t be checked automatically yet.' }], feedback: 'Your teacher will check this Python program by hand.' };
  }
  if (!file.project) {
    return { status: 'needs-work', score: 0, checks: [{ label: 'Contains a program', status: 'fail', detail: 'No program found', hint: 'Make sure you saved your program before uploading.' }], feedback: 'We couldn’t find a program in this file. Save your project and upload it again.' };
  }
  const prog = parseProject(file.project);
  const checks = rule.checks.map((fn) => {
    try {
      return fn(prog);
    } catch (err) {
      return { label: 'Check could not run', status: 'review', detail: err.message };
    }
  });
  if (file.type !== 'word-blocks') checks.unshift({ label: 'Word Blocks project', status: 'review', detail: `This is a “${file.type}” project; the lessons use Word Blocks.`, optional: true });
  if (file.hardware.length && !file.hardware.includes('flipper')) checks.unshift({ label: 'SPIKE Prime hub', status: 'review', detail: `Made for ${file.hardware.join(', ')}`, optional: true });
  if (prog.loose.length) checks.push({ label: 'No loose blocks', status: 'review', optional: true, detail: `${prog.loose.length} group(s) of blocks aren’t attached to “when program starts” and won’t run` });
  const program = prog.main ? ['when program starts', ...outline(prog.steps)] : [];
  for (const s of prog.scripts.filter((x) => x !== prog.main)) program.push(`(${s.hat.opcode})`, ...outline(s.steps));
  return { ...summarize(rule, checks), checks, program };
}

function gradeFile(buffer, { assignment, filename } = {}) {
  let file;
  try {
    file = readLlsp3(buffer);
  } catch (err) {
    const message = err instanceof Llsp3Error ? err.message : 'This file couldn’t be opened as a SPIKE project.';
    return { assignment: null, filename, status: 'needs-work', score: 0, checks: [{ label: 'Opens as a SPIKE project', status: 'fail', detail: message, hint: 'Upload the .llsp3 file saved from the SPIKE app.' }], feedback: message, program: [] };
  }
  const rule = (assignment && findRule(assignment)) || guessRule(filename, file.name);
  if (!rule) {
    return { assignment: null, filename, projectName: file.name, status: 'review', score: null, checks: [{ label: 'Which assignment is this?', status: 'review', detail: `Couldn’t tell from “${filename || file.name}”. Pick the assignment and check again.` }], feedback: '', program: file.project ? ['when program starts', ...outline(parseProject(file.project).steps)] : [] };
  }
  return { assignment: { id: rule.id, name: rule.name }, filename, projectName: file.name, ...gradeProgram(file, rule) };
}

module.exports = { gradeFile, listAssignments, findRule, guessRule };
