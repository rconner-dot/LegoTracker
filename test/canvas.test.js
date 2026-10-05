'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { CanvasClient, parseNextLink, mapLimit } = require('../lib/canvas');
const { CanvasSource, DemoSource } = require('../lib/sources');
const { Tracker } = require('../lib/tracker');
const { SettingsStore } = require('../lib/settings');
const memSettings = () => new SettingsStore({ config: {} });

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

test('parseNextLink finds rel="next"', () => {
  const h = '<https://x.test/api/v1/a?page=1>; rel="current", <https://x.test/api/v1/a?page=2>; rel="next", <https://x.test/api/v1/a?page=9>; rel="last"';
  assert.strictEqual(parseNextLink(h), 'https://x.test/api/v1/a?page=2');
  assert.strictEqual(parseNextLink(null), null);
});

test('getAll follows pagination and sends the bearer token', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.Authorization });
    if (url.searchParams.get('page') === '2') return response(200, [{ id: 3 }]);
    return response(200, [{ id: 1 }, { id: 2 }], { link: '<https://canvas.test/api/v1/courses/5/users?page=2&per_page=100>; rel="next"' });
  };
  const c = new CanvasClient({ baseUrl: 'https://canvas.test', token: 'secret', fetchImpl });
  const users = await c.listStudents(5);
  assert.deepStrictEqual(users.map((u) => u.id), [1, 2, 3]);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls.every((x) => x.auth === 'Bearer secret'));
  assert.match(calls[0].url, /enrollment_type%5B%5D=student/);
});

test('never sends the token to another host', async () => {
  const fetchImpl = async () => response(200, [{ id: 1 }], { link: '<https://evil.test/steal>; rel="next"' });
  const c = new CanvasClient({ baseUrl: 'https://canvas.test', token: 'secret', fetchImpl });
  await assert.rejects(c.getAll('/api/v1/courses/1/users'), /Refusing to send/);
});

test('retries when Canvas throttles, then succeeds', async () => {
  let n = 0;
  const fetchImpl = async () => (++n < 3 ? response(403, '403 Forbidden (Rate Limit Exceeded)') : response(200, { id: 1, name: 'Course' }));
  const c = new CanvasClient({ baseUrl: 'https://canvas.test', token: 't', fetchImpl, sleep: async () => {} });
  assert.deepStrictEqual(await c.getCourse(1), { id: 1, name: 'Course' });
  assert.strictEqual(n, 3);
});

test('explains a bad token', async () => {
  const c = new CanvasClient({ baseUrl: 'https://canvas.test', token: 't', fetchImpl: async () => response(401, {}) });
  await assert.rejects(c.getCourse(1), /access token/);
});

test('listModules fetches items Canvas left out', async () => {
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith('/modules')) return response(200, [{ id: 9, name: 'Big' }]);
    if (url.pathname.endsWith('/modules/9/items')) {
      assert.strictEqual(url.searchParams.get('student_id'), '42');
      return response(200, [{ id: 1, completion_requirement: { completed: true } }]);
    }
    return response(404, {});
  };
  const c = new CanvasClient({ baseUrl: 'https://canvas.test', token: 't', fetchImpl });
  const mods = await c.listModules(1, 42);
  assert.strictEqual(mods[0].items.length, 1);
});

test('mapLimit preserves order and limits concurrency', async () => {
  let active = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return x * 2;
  });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10]);
  assert.strictEqual(peak, 2);
});

test('CanvasSource + Tracker produce a ranked game state', async () => {
  const fake = {
    getCourse: async () => ({ name: 'Bio 101' }),
    listStudents: async () => [{ id: 1, name: 'Ava Smith' }, { id: 2, name: 'Ben Jones' }],
    listSections: async () => { throw new Error('403'); },
    listSubmissions: async () => [],
    listModules: async (_c, studentId) => [{
      id: 10, name: 'Cells', position: 1, state: studentId === 2 ? 'completed' : 'started',
      items: [{ id: 100, title: 'Cell quiz', completion_requirement: { type: 'must_submit', completed: studentId === 2 } }],
    }],
  };
  const tracker = new Tracker({ source: new CanvasSource({ courseId: 1 }, fake), settings: memSettings(), mode: 'live' });
  await tracker.refresh();
  const s = tracker.getState();
  assert.strictEqual(s.error, null);
  assert.strictEqual(s.course.name, 'Bio 101');
  assert.deepStrictEqual(s.students.map((x) => [x.name, x.rank, x.finished]), [['Ben J.', 1, true], ['Ava S.', 2, false]]);
});

test('Tracker keeps the last good state when Canvas fails', async () => {
  let fail = false;
  const demo = new DemoSource({ students: 3 });
  const source = { load: () => (fail ? Promise.reject(new Error('boom')) : demo.load()) };
  const tracker = new Tracker({ source, settings: memSettings(), mode: 'demo' });
  await tracker.refresh();
  fail = true;
  await tracker.refresh();
  const s = tracker.getState();
  assert.strictEqual(s.error, 'boom');
  assert.strictEqual(s.students.length, 3);
});

test('DemoSource advances over time and produces events', async () => {
  const tracker = new Tracker({ source: new DemoSource({ students: 5 }), settings: memSettings(), mode: 'demo' });
  for (let i = 0; i < 6; i++) await tracker.refresh();
  assert.ok(tracker.getState().events.length > 0);
});
