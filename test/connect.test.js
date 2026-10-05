'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeCanvas, TOKEN } = require('./fake-canvas');
const { Runtime } = require('../lib/runtime');
const { loadConfig, parseCanvasAddress } = require('../lib/config');
const { AdminAuth } = require('../lib/admin');
const { createServer } = require('../server');

test('parseCanvasAddress accepts the shapes teachers paste', () => {
  assert.deepStrictEqual(parseCanvasAddress('school.instructure.com'), { canvasUrl: 'https://school.instructure.com', courseId: null });
  assert.deepStrictEqual(parseCanvasAddress(' https://school.instructure.com/courses/4521/modules '), { canvasUrl: 'https://school.instructure.com', courseId: '4521' });
  assert.throws(() => parseCanvasAddress('http://school.instructure.com'), /https/);
  assert.throws(() => parseCanvasAddress(''), /Canvas address/);
});

function tempConfig(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-conn-'));
  const env = { QUEST_CONFIG: path.join(dir, 'config.json'), ...extraEnv };
  return { dir, load: () => loadConfig({ argv: [], env }) };
}

test('connect from teacher controls, survive a restart, then disconnect', async () => {
  const canvas = await startFakeCanvas();
  const { dir, load } = tempConfig();
  try {
    const config = load();
    assert.strictEqual(config.demo, true);
    const runtime = new Runtime(config);
    await runtime.start();
    assert.strictEqual(runtime.tracker.mode, 'demo');

    await assert.rejects(runtime.listCourses({ canvasUrl: canvas.url, token: 'wrong' }), /didn’t accept that token/);
    const found = await runtime.listCourses({ canvasUrl: `${canvas.url}/courses/777`, token: TOKEN });
    assert.deepStrictEqual(found.courses.map((c) => c.name), ['Intro to Programming']);
    assert.strictEqual(found.courseId, '777');

    const status = await runtime.connect({ canvasUrl: canvas.url, token: TOKEN, courseId: '777' });
    assert.strictEqual(status.connected, true);
    assert.strictEqual(runtime.tracker.mode, 'live');
    const state = runtime.tracker.getState();
    assert.strictEqual(state.error, null);
    assert.strictEqual(state.course.name, 'Intro to Programming');
    assert.strictEqual(state.students.length, 6);
    assert.ok(state.pace, 'due dates came through');
    assert.ok(canvas.requests.includes('/api/v1/courses/777/students/submissions'));

    // The token is saved privately and never echoed back.
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'connection.json'), 'utf8'));
    assert.strictEqual(saved.token, TOKEN);
    assert.ok(!JSON.stringify(runtime.status()).includes(TOKEN));
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'data', 'connection.json')).mode & 0o077, 0);

    // Switching course on the same site can reuse the saved token...
    assert.strictEqual((await runtime.listCourses({ canvasUrl: canvas.url })).courses.length, 1);
    // ...but it is never sent to a different site.
    await assert.rejects(runtime.listCourses({ canvasUrl: 'https://elsewhere.example' }), /Paste your Canvas access token/);

    const restarted = load();
    assert.strictEqual(restarted.demo, false);
    assert.strictEqual(restarted.courseId, '777');
    assert.strictEqual(restarted.connectionSource, 'teacher controls');

    await runtime.disconnect();
    assert.strictEqual(runtime.tracker.mode, 'demo');
    assert.strictEqual(load().demo, true);
    runtime.tracker.stop();
  } finally {
    canvas.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('environment variables lock the connection', async () => {
  const { dir, load } = tempConfig({ CANVAS_URL: 'https://x.example', CANVAS_TOKEN: 't', CANVAS_COURSE_ID: '1' });
  try {
    const runtime = new Runtime(load(), { persist: false });
    assert.strictEqual(runtime.status().locked, true);
    await assert.rejects(runtime.disconnect(), /environment variables/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('connect endpoints are teacher-only', async () => {
  const { dir, load } = tempConfig();
  const runtime = new Runtime(load(), { persist: false });
  const server = createServer({ runtime, auth: new AdminAuth({ pin: '1357' }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/admin/canvas/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(res.status, 401);
    const status = await fetch(`${base}/api/admin/canvas`);
    assert.strictEqual(status.status, 401);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
