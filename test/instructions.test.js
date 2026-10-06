'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startFakeCanvas, TOKEN } = require('./fake-canvas');
const { CanvasClient } = require('../lib/canvas');
const { collectInstructions, toMarkdown, htmlToText, fileLinks } = require('../lib/instructions');

test('htmlToText keeps structure, links and entities', () => {
  const text = htmlToText('<h2>Goal</h2><p>Drive &amp; turn&nbsp;90&deg;</p><ul><li>One</li><li>Two</li></ul><p><a href="https://x.test/a">guide</a> <img alt="robot photo" src="r.png"></p>');
  assert.strictEqual(text, '#### Goal\n\nDrive & turn 90°\n\n- One\n- Two\n\nguide (https://x.test/a) [image: robot photo]');
  assert.strictEqual(htmlToText(null), '');
  assert.deepStrictEqual(fileLinks('<a href="/courses/1/files/42/download">kit.llsp3</a>'), [{ id: '42', name: 'kit.llsp3', url: '/courses/1/files/42/download' }]);
});

test('collects every assignment with rubric, file rules, pages and syllabus', async () => {
  const canvas = await startFakeCanvas({ students: 2 });
  try {
    const client = new CanvasClient({ baseUrl: canvas.url, token: TOKEN });
    const data = await collectInstructions(client, '777');
    assert.strictEqual(data.course.syllabus, 'Be kind & build cool robots.');
    const first = data.modules.flatMap((m) => m.items).find((i) => i.assignment);
    assert.strictEqual(first.assignment.name, 'Syllabus Quiz');
    assert.deepStrictEqual(first.assignment.allowedExtensions, ['llsp3']);
    assert.match(first.assignment.instructions, /drive 10 rotations forward/);
    assert.strictEqual(first.assignment.rubric[0].criterion, 'Uses motors A+B');
    assert.strictEqual(first.assignment.files[0].name, 'starter.llsp3');
    const page = data.modules.flatMap((m) => m.items).find((i) => i.page);
    assert.strictEqual(page.page.content, 'Welcome to robotics!');
    assert.strictEqual(data.otherAssignments.length, 0);
    // Course content only: nothing about students is requested.
    assert.ok(!canvas.requests.some((p) => /users|submissions|student/.test(p)));

    const md = toMarkdown(data);
    assert.match(md, /# Intro to Programming — assignment instructions/);
    assert.match(md, /accept LEGO \(\.llsp3\) files/);
    assert.match(md, /\| Uses motors A\+B — Movement pair set to A\+B \| 5 \| Yes \(5\); No \(0\) \|/);
  } finally {
    canvas.close();
  }
});
