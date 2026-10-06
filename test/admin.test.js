'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitize, SettingsStore, isMember } = require('../lib/settings');
const { Tracker } = require('../lib/tracker');
const { DemoSource } = require('../lib/sources');
const { AdminAuth, progressCsv } = require('../lib/admin');
const { createServer } = require('../server');

test('sanitize keeps valid settings and drops junk', () => {
  const s = sanitize({
    title: '  Period 3  ',
    nameFormat: 'nope',
    showRanks: false,
    spotlightSeconds: 7,
    nicknames: { 12: '  Ace ', 13: '' },
    characters: { 12: 'robot-3', 13: 'dragon-1' },
    levels: { exclude: [5, 5, '6'], themes: { 5: 'lava', 6: 'moon' } },
    views: [
      { id: 'P 3!', name: 'Period 3', base: 'sections', sections: [3], goal: { target: 40, reward: 'Pizza' } },
      { id: 'p-3-', name: 'Dup' },
      { id: 'x', name: 'Bad goal', base: 'weird', goal: { target: -1 } },
    ],
    defaultView: 'x',
  });
  assert.strictEqual(s.title, 'Period 3');
  assert.strictEqual(s.nameFormat, 'first-last-initial');
  assert.strictEqual(s.showRanks, false);
  assert.strictEqual(s.spotlightSeconds, 0);
  assert.deepStrictEqual(s.nicknames, { 12: 'Ace' });
  assert.deepStrictEqual(s.characters, { 12: 'robot-3' });
  assert.deepStrictEqual(s.levels, { moduleIds: null, exclude: ['5', '6'], themes: { 5: 'lava' } });
  assert.deepStrictEqual(s.views.map((v) => v.id), ['p-3-', 'x']);
  assert.deepStrictEqual(s.views[0].goal, { target: 40, reward: 'Pizza' });
  assert.strictEqual(s.views[1].base, 'all');
  assert.strictEqual(s.views[1].goal, null);
  assert.strictEqual(s.defaultView, 'x');
});

test('track layout settings', () => {
  const d = sanitize({});
  assert.deepStrictEqual([d.layout, d.laneColumns, d.scenery, d.levelsBefore, d.levelsAfter], ['lanes', 0, 'calm', 1, 1]);
  const s = sanitize({ layout: 'cards', laneColumns: 2, scenery: 'detailed', levelsBefore: null, levelsAfter: '2' });
  assert.deepStrictEqual([s.layout, s.laneColumns, s.scenery, s.levelsBefore, s.levelsAfter], ['cards', 2, 'detailed', null, 2]);
  const bad = sanitize({ layout: 'grid', laneColumns: 9, scenery: 'loud', levelsBefore: -1, levelsAfter: 999 });
  assert.deepStrictEqual([bad.layout, bad.laneColumns, bad.scenery, bad.levelsBefore, bad.levelsAfter], ['lanes', 0, 'calm', 1, 50]);
  // Settings saved before the layout option existed keep showing cards.
  assert.strictEqual(sanitize({ levelsBefore: 1, levelsAfter: 1 }).layout, 'cards');
});

test('badges can be switched off', () => {
  assert.deepStrictEqual(sanitize({ disabledBadges: ['onfire', 'nope', 'onfire'] }).disabledBadges, ['onfire']);
});

test('screen membership: base, sections, include and exclude', () => {
  const st = (userId, sections) => ({ userId, sections });
  const view = { base: 'sections', sections: ['3'], include: ['9'], exclude: ['2'] };
  assert.strictEqual(isMember(view, st('1', ['3'])), true);
  assert.strictEqual(isMember(view, st('2', ['3'])), false);
  assert.strictEqual(isMember(view, st('9', ['5'])), true);
  assert.strictEqual(isMember(view, st('4', ['5'])), false);
  assert.strictEqual(isMember({ base: 'none', sections: [], include: ['1'], exclude: [] }, st('1', [])), true);
  assert.strictEqual(isMember({ base: 'none', sections: [], include: [], exclude: [] }, st('1', [])), false);
});

test('SettingsStore persists to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-'));
  const a = new SettingsStore({ dir, config: { title: 'From config' } });
  assert.strictEqual(a.get().title, 'From config');
  a.replace({ ...a.get(), title: 'Saved' });
  const b = new SettingsStore({ dir, config: { title: 'From config' } });
  assert.strictEqual(b.get().title, 'Saved');
  fs.rmSync(dir, { recursive: true, force: true });
});

async function demoTracker(students = 9) {
  const settings = new SettingsStore({ config: {} });
  const tracker = new Tracker({ source: new DemoSource({ students }), settings, mode: 'demo' });
  await tracker.refresh();
  return { tracker, settings };
}

test('each screen shows only its students, ranked among themselves', async () => {
  const { tracker, settings } = await demoTracker(9);
  const all = tracker.getState();
  assert.strictEqual(all.students.length, 9);
  const admin = tracker.getAdminData();
  const picked = admin.students.slice(0, 2).map((s) => s.userId);
  settings.replace({
    ...settings.get(),
    views: [...settings.get().views,
      { id: 'p3', name: 'Period 3', base: 'sections', sections: ['3'] },
      { id: 'pair', name: 'Pair', base: 'none', include: picked, goal: { target: 5, reward: 'Stickers' } }],
  });
  tracker.rebuild();

  const p3 = tracker.getState('p3');
  assert.strictEqual(p3.view.name, 'Period 3');
  assert.strictEqual(p3.students.length, 3);
  assert.strictEqual(p3.students[0].rank, 1);

  const pair = tracker.getState('pair');
  assert.strictEqual(pair.students.length, 2);
  assert.deepStrictEqual(pair.goal, { target: 5, reward: 'Stickers', done: Math.min(5, pair.classDone) });
  const ids = new Set(pair.students.map((s) => s.id));
  assert.ok(pair.events.every((e) => ids.has(e.studentId)));

  assert.strictEqual(tracker.getState('missing').view.id, 'all');
});

test('displays never receive Canvas ids, real names, or teacher stats', async () => {
  const { tracker } = await demoTracker(5);
  const json = JSON.stringify(tracker.getState());
  for (const u of tracker.raw.users) {
    assert.ok(!json.includes(`"${u.id}"`) && !json.includes(`:${u.id},`), 'canvas id leaked');
    assert.ok(!json.includes(u.name), 'real name leaked');
  }
  assert.ok(!/missing|lastSubmittedAt|"late"/.test(json));
});

test('switched-off badges vanish from displays and the catalog', async () => {
  const { tracker, settings } = await demoTracker(10);
  assert.ok(tracker.getState().badges.some((b) => b.key === 'firststeps'));
  settings.replace({ ...settings.get(), disabledBadges: ['firststeps'] });
  tracker.rebuild();
  const s = tracker.getState();
  assert.ok(!s.badges.some((b) => b.key === 'firststeps'));
  assert.ok(s.students.every((st) => !st.badges.some((b) => b.key === 'firststeps')));
  const admin = tracker.getAdminData().badges.find((b) => b.key === 'firststeps');
  assert.deepStrictEqual([admin.enabled, admin.earned], [false, 0]);
});

test('cooperative mode removes places', async () => {
  const { tracker, settings } = await demoTracker(4);
  settings.replace({ ...settings.get(), showRanks: false });
  const s = tracker.getState();
  assert.ok(s.students.every((x) => x.rank === null));
  const names = s.students.map((x) => x.name);
  assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('progressCsv neutralises spreadsheet formulas', () => {
  const csv = progressCsv({
    sections: [], levels: [{ name: 'L1' }],
    students: [{ realName: '=HYPERLINK("x")', name: 'A', sections: [], level: 0, finished: false, done: 1, total: 2, vsPace: -1, stats: null, badges: [] }],
  });
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});

// ---------- HTTP ----------

async function withServer(fn, { pin = '' } = {}) {
  const { tracker } = await demoTracker(4);
  const server = createServer({ tracker, auth: new AdminAuth({ pin }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, tracker);
  } finally {
    server.close();
  }
}

test('admin API works from this computer without a PIN', () => withServer(async (base) => {
  const data = await (await fetch(`${base}/api/admin/data`)).json();
  assert.strictEqual(data.students.length, 4);
  const res = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data.settings, title: 'New title' }),
  });
  assert.strictEqual(res.status, 200);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.strictEqual(state.course.name, 'New title');
  const csv = await fetch(`${base}/api/admin/export.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
}));

test('admin API refuses cross-site and non-JSON writes', () => withServer(async (base) => {
  const evil = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
  });
  assert.strictEqual(evil.status, 403);
  const form = await fetch(`${base}/api/admin/settings`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.strictEqual(form.status, 415);
}));

test('a PIN protects the admin API', () => withServer(async (base) => {
  assert.strictEqual((await fetch(`${base}/api/admin/data`)).status, 401);
  const bad = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"pin":"0000"}' });
  assert.strictEqual(bad.status, 401);
  const good = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"pin":"4321"}' });
  assert.strictEqual(good.status, 200);
  const cookie = good.headers.get('set-cookie').split(';')[0];
  assert.match(good.headers.get('set-cookie'), /HttpOnly/);
  assert.strictEqual((await fetch(`${base}/api/admin/data`, { headers: { cookie } })).status, 200);
  // The public display stays open.
  assert.strictEqual((await fetch(`${base}/api/state`)).status, 200);
}, { pin: '4321' }));

test('without a PIN, other devices are blocked from the admin API', () => {
  const auth = new AdminAuth({ pin: '' });
  assert.strictEqual(auth.status({ socket: { remoteAddress: '192.168.1.20' }, headers: {} }), 'blocked');
  assert.strictEqual(auth.status({ socket: { remoteAddress: '::1' }, headers: {} }), 'ok');
});

test('static files cannot escape the public folder', () => withServer(async (base) => {
  const res = await fetch(`${base}/..%2fserver.js`);
  assert.ok(res.status === 403 || res.status === 404);
  assert.strictEqual((await fetch(`${base}/admin`)).status, 200);
}));
