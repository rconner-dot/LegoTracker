'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildLevels, studentProgress, rankStudents, formatName, assignCharacters, buildSnapshot, diffSnapshots } = require('../lib/progress');
const { CHARACTER_COUNT } = require('../public/sprites.js');

const req = (id, title, completed) => ({ id, title, type: 'Assignment', completion_requirement: { type: 'must_submit', ...(completed == null ? {} : { completed }) } });

const courseModules = [
  { id: 2, name: 'Loops', position: 2, items: [req(21, 'Loop Lab'), req(22, 'Loop Quiz')] },
  { id: 1, name: 'Basics', position: 1, items: [req(11, 'Hello'), { id: 12, title: 'Read me', type: 'Page' }] },
  { id: 3, name: 'Course Info', position: 0, items: [{ id: 31, title: 'Syllabus', type: 'Page' }] },
  { id: 4, name: 'Drafts', position: 3, published: false, items: [req(41, 'Hidden')] },
];

test('buildLevels keeps published modules with requirements, in Canvas order', () => {
  const levels = buildLevels(courseModules);
  assert.deepStrictEqual(levels.map((l) => l.name), ['Basics', 'Loops']);
  assert.deepStrictEqual(levels[0].items.map((i) => i.id), [11]);
});

test('buildLevels honours an explicit moduleIds order', () => {
  const levels = buildLevels(courseModules, { moduleIds: [2, '1'] });
  assert.deepStrictEqual(levels.map((l) => l.id), [2, 1]);
});

test('studentProgress puts the student on their first unfinished level', () => {
  const levels = buildLevels(courseModules);
  const p = studentProgress(levels, [
    { id: 1, state: 'completed', items: [req(11, 'Hello', true)] },
    { id: 2, state: 'started', items: [req(21, 'Loop Lab', true), req(22, 'Loop Quiz', false)] },
  ]);
  assert.strictEqual(p.level, 1);
  assert.strictEqual(p.levelProgress, 0.5);
  assert.strictEqual(p.position, 1.5);
  assert.strictEqual(p.done, 2);
  assert.strictEqual(p.total, 3);
  assert.strictEqual(p.finished, false);
});

test('studentProgress handles finished and missing data', () => {
  const levels = buildLevels(courseModules);
  const done = studentProgress(levels, [
    { id: 1, state: 'completed', items: [req(11, 'Hello', true)] },
    { id: 2, state: 'completed', items: [req(21, 'a', true), req(22, 'b', true)] },
  ]);
  assert.strictEqual(done.finished, true);
  assert.strictEqual(done.position, 2);
  const none = studentProgress(levels, undefined);
  assert.strictEqual(none.position, 0);
  assert.strictEqual(none.total, 3);
});

test('rankStudents uses competition ranking for ties', () => {
  const ranked = rankStudents([
    { name: 'C', position: 1, score: 1 },
    { name: 'A', position: 2, score: 2 },
    { name: 'B', position: 1, score: 1 },
    { name: 'D', position: 0, score: 0 },
  ]);
  assert.deepStrictEqual(ranked.map((s) => [s.name, s.rank]), [['A', 1], ['B', 2], ['C', 2], ['D', 4]]);
});

test('formatName supports privacy-friendly formats', () => {
  const u = { name: 'Ava Marie Smith', sortable_name: 'Smith, Ava Marie', short_name: 'Ava' };
  assert.strictEqual(formatName(u), 'Ava S.');
  assert.strictEqual(formatName(u, 'first'), 'Ava');
  assert.strictEqual(formatName(u, 'full'), 'Ava Marie Smith');
  assert.strictEqual(formatName(u, 'initials'), 'A.S.');
  assert.strictEqual(formatName({ name: 'Cher' }), 'Cher');
});

test('assignCharacters is stable, unique, and respects overrides', () => {
  const ids = Array.from({ length: 30 }, (_, i) => 100 + i);
  const a = assignCharacters(ids, { 105: 'brick-2' });
  const b = assignCharacters(ids.slice().reverse(), { 105: 'brick-2' });
  assert.deepStrictEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.strictEqual(new Set(a.values()).size, 30);
  assert.strictEqual(a.get('105'), 1 * 3 + 2);
  for (const v of a.values()) assert.ok(v >= 0 && v < CHARACTER_COUNT);
});

test('diffSnapshots reports cleared items, level ups, and finishes', () => {
  const levels = buildLevels(courseModules);
  const users = [{ id: 7, name: 'Ava Smith', sortable_name: 'Smith, Ava' }];
  const snap = (mods) => buildSnapshot({ courseId: 1, course: { name: 'X' }, levels, users, modulesByUser: new Map([['7', mods]]) });
  const s1 = snap([{ id: 1, state: 'started', items: [req(11, 'Hello', false)] }]);
  const s2 = snap([{ id: 1, state: 'completed', items: [req(11, 'Hello', true)] }]);
  let n = 0;
  assert.deepStrictEqual(diffSnapshots(null, s1, () => ++n), []);
  const events = diffSnapshots(s1, s2, () => ++n, 1000);
  assert.deepStrictEqual(events.map((e) => e.type), ['item', 'level']);
  assert.match(events[0].text, /Ava S\. cleared “Hello”/);
  assert.match(events[1].text, /Level 2: Loops/);

  const s3 = snap([
    { id: 1, state: 'completed', items: [req(11, 'Hello', true)] },
    { id: 2, state: 'completed', items: [req(21, 'a', true), req(22, 'b', true)] },
  ]);
  assert.deepStrictEqual(diffSnapshots(s2, s3, () => ++n).map((e) => e.type), ['item', 'item', 'finish']);
});

test('snapshots never expose Canvas user ids', () => {
  const levels = buildLevels(courseModules);
  const s = buildSnapshot({ courseId: 1, levels, users: [{ id: 987654, name: 'Ava Smith' }], modulesByUser: new Map() });
  assert.ok(!JSON.stringify(s).includes('987654'));
});
