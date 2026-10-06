'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { B, program, llsp3, zip, pattern } = require('./llsp3-builder');
const { gradeFile, guessRule, listAssignments } = require('../lib/grading');
const { readLlsp3 } = require('../lib/llsp3');
const { RULES } = require('../lib/grading/rules');

const grade = (assignment, ...steps) => gradeFile(llsp3(program(...steps)), { assignment });
const statusOf = (r, label) => (r.checks.find((c) => c.label.startsWith(label)) || {}).status;

test('reads a real SPIKE App 3 file', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'example.llsp3'));
  const file = readLlsp3(buf);
  assert.deepStrictEqual([file.name, file.type, file.hardware], ['example', 'word-blocks', ['flipper']]);
  const r = gradeFile(buf, { assignment: 'Moving Forward' });
  assert.deepStrictEqual(r.program, ['when program starts', '  set movement motors to A+B', '  move forward for 10 rotations', '  stop moving']);
  assert.strictEqual(r.status, 'needs-work');
  assert.deepStrictEqual(r.checks.map((c) => c.status), ['pass', 'fail', 'fail', 'fail']);
  assert.match(r.feedback, /D\+B/);
  assert.match(r.feedback, /cm, not rotations/);
});

test('Moving Forward: correct, and the D+B order matters', () => {
  const ok = grade('910143', B.motors('DB'), B.move('forward', 10, 'cm'), B.stop());
  assert.deepStrictEqual([ok.status, ok.score], ['complete', 100]);
  assert.match(ok.feedback, /Great job/);
  const swapped = grade('910143', B.motors('BD'), B.move('forward', 10, 'cm'), B.stop());
  assert.strictEqual(statusOf(swapped, 'Movement motors'), 'fail');
  assert.match(swapped.checks.find((c) => c.label.startsWith('Movement motors')).hint, /left motor \(D\) comes first/);
  const noExit = grade('910143', B.motors('DB'), B.move('forward', 10, 'cm'), B.stop(false));
  assert.strictEqual(statusOf(noExit, 'Ends with'), 'fail');
});

const FRAMES = [
  ['11000', '00000', '00000', '00000', '00000'], ['00011', '00000', '00000', '00000', '00000'],
  ['00000', '11000', '00000', '00000', '00000'], ['00000', '00011', '00000', '00000', '00000'],
  ['00000', '00000', '11000', '00000', '00000'], ['00000', '00000', '00011', '00000', '00000'],
  ['00000', '00000', '00000', '11000', '00000'], ['00000', '00000', '00000', '00011', '00000'],
].map((rows) => pattern(...rows));
const SMILEY = pattern('01010', '01010', '00000', '10001', '01110');

test('Programming a Sequence: 8 frames, smiley, DB, exit', () => {
  const frames = FRAMES.map((p) => B.light(p, 1));
  const ok = grade('910145', ...frames, B.light(SMILEY, 2), B.text('DB'), B.stop());
  assert.strictEqual(ok.status, 'complete', JSON.stringify(ok.checks));
  assert.ok(ok.program.some((l) => l.includes('■')), 'patterns are drawn in the outline');

  const noSmile = grade('910145', ...frames, B.light(FRAMES[0], 2), B.text('DB'), B.stop());
  assert.strictEqual(statusOf(noSmile, 'Smiley'), 'fail');
  const sevenSame = grade('910145', ...FRAMES.slice(0, 7).map((p) => B.light(p, 1)), B.light(SMILEY, 2), B.text('hi'), B.stop());
  assert.strictEqual(statusOf(sevenSame, '8 light frames'), 'fail');
  assert.strictEqual(statusOf(sevenSame, 'Writes'), 'fail');
});

test('Sequence Reverse: initials instead of DB, direction left for the teacher', () => {
  const frames = [...FRAMES].reverse().map((p) => B.light(p, 1));
  const r = grade('910146', ...frames, B.light(SMILEY, 2), B.text('RC'), B.stop());
  assert.strictEqual(r.status, 'review');
  assert.strictEqual(statusOf(r, 'Writes your initials'), 'pass');
  assert.match(r.checks.find((c) => c.label.startsWith('Bars move')).detail, /moves/);
  assert.strictEqual(statusOf(grade('910146', ...frames, B.light(SMILEY, 2), B.text('DB'), B.stop()), 'Writes your initials'), 'fail');
});

test('Mars Rover Advertising: variety and 10 seconds', () => {
  const r = grade('910151', B.light(FRAMES[0], 3), B.light(FRAMES[1], 3), B.text('MARS'), B.light(SMILEY, 3));
  assert.strictEqual(r.status, 'complete', JSON.stringify(r.checks));
  const short = grade('910151', B.light(FRAMES[0], 1), B.light(FRAMES[1], 1), B.light(SMILEY, 1));
  assert.strictEqual(statusOf(short, 'Lasts at least 10'), 'fail');
});

test('Sequential Movements: works with a repeat loop too', () => {
  const unrolled = grade('910155', B.motors('DB'), ...[1, 2, 3, 4].flatMap(() => [B.move('forward', 20, 'cm'), B.wait(1)]));
  assert.strictEqual(unrolled.status, 'complete', JSON.stringify(unrolled.checks));
  const looped = grade('910155', B.motors('DB'), B.repeat(4, B.move('forward', 20, 'cm'), B.wait(1)));
  assert.strictEqual(looped.status, 'complete');
  const noWaits = grade('910155', B.motors('DB'), B.repeat(4, B.move('forward', 20, 'cm')));
  assert.strictEqual(statusOf(noWaits, 'Stops at least 1 second'), 'fail');
});

test('Sequential Movements Speed and Sound', () => {
  const speeds = grade('910157', B.motors('DB'), ...[80, 60, 40, 20].flatMap((v) => [B.speed(v), B.move('forward', 20, 'cm')]));
  assert.strictEqual(speeds.status, 'complete', JSON.stringify(speeds.checks));
  const same = grade('910157', B.motors('DB'), B.speed(50), ...[1, 2, 3, 4].map(() => B.move('forward', 20, 'cm')));
  assert.strictEqual(statusOf(same, 'Each forward move has a different speed'), 'fail');
  const sound = grade('910156', B.motors('DB'), B.repeat(4, B.move('forward', 20, 'cm'), B.sound()));
  assert.strictEqual(sound.status, 'complete');
  const missing = grade('910156', B.motors('DB'), ...[1, 2, 3].flatMap(() => [B.move('forward', 20, 'cm'), B.sound()]), B.move('forward', 20, 'cm'));
  assert.match(missing.checks.find((c) => c.label.startsWith('Plays a sound')).detail, /1 of 4/);
});

test('Turning and moving lessons', () => {
  assert.strictEqual(grade('910148', B.motors('DB'), B.steer(100, 0.64, 'rotations'), B.stop()).status, 'complete');
  assert.strictEqual(statusOf(grade('910148', B.motors('DB'), B.steer(30, 10, 'rotations'), B.stop()), 'Turns right'), 'fail');
  const mt = grade('910142', B.motors('DB'), B.move('forward', 10, 'cm'), B.stopMove(), B.steer(100, 0.64, 'rotations'), B.stop());
  assert.strictEqual(mt.status, 'complete', JSON.stringify(mt.checks));
  const noStop = grade('910142', B.motors('DB'), B.move('forward', 10, 'cm'), B.steer(100, 0.64, 'rotations'), B.stop());
  assert.strictEqual(statusOf(noStop, 'In order'), 'fail');
});

test('Pick up and Move', () => {
  const ok = grade('910144', B.motors('DB'), B.motor('C', 'clockwise', 0.2, 'rotations'), B.move('forward', 20, 'cm'),
    B.motor('C', 'counterclockwise', 0.2, 'rotations'), B.move('back', 20, 'cm'), B.stop());
  assert.strictEqual(ok.status, 'complete', JSON.stringify(ok.checks));
  const sameWay = grade('910144', B.motors('DB'), B.motor('C', 'clockwise', 0.2, 'rotations'), B.move('forward', 20, 'cm'),
    B.motor('C', 'clockwise', 0.2, 'rotations'), B.move('back', 20, 'cm'), B.stop());
  assert.strictEqual(statusOf(sameWay, 'Arm closes and opens'), 'fail');
});

test('Sensor lessons', () => {
  const near = grade('910141', B.motors('DB'), B.startMove(), B.waitUntil(B.distance('F', '<', 20, 'cm')), B.stopMove(), B.stop());
  assert.strictEqual(near.status, 'complete', JSON.stringify(near.checks));
  assert.ok(near.program.includes('  wait until F is closer than 20 cm'));
  const percent = grade('910141', B.motors('DB'), B.startMove(), B.waitUntil(B.distance('F', '<', 20, '%')), B.stopMove(), B.stop());
  assert.strictEqual(statusOf(percent, 'Waits until F'), 'fail');
  const wrongPort = grade('910141', B.motors('DB'), B.startMove(), B.waitUntil(B.distance('E', '<', 20, 'cm')), B.stopMove(), B.stop());
  assert.strictEqual(statusOf(wrongPort, 'Waits until F'), 'fail');

  const green = grade('910149', B.waitUntil(B.color('A', 6)), B.light(SMILEY), B.stop(false));
  assert.strictEqual(green.status, 'complete', JSON.stringify(green.checks));
  assert.strictEqual(statusOf(grade('910149', B.waitUntil(B.color('A', 9)), B.light(SMILEY), B.stop(false)), 'Waits until A sees green'), 'fail');
});

test('Loops: Repeat Loops and Around Alien', () => {
  const loops = grade('910147', B.motors('DB'), B.repeat(3, B.move('forward', 10, 'cm'), B.move('back', 10, 'cm')));
  assert.strictEqual(loops.status, 'complete', JSON.stringify(loops.checks));
  assert.strictEqual(statusOf(grade('910147', B.motors('DB'), B.repeat(10, B.move('forward', 10, 'cm'), B.move('back', 10, 'cm'))), 'Repeat loop set to 3'), 'fail');
  const alien = grade('910152', B.motors('DB'), B.repeat(4, B.move('forward', 30, 'cm'), B.steer(100, 0.64, 'rotations'), B.wait(1), B.sound()));
  assert.strictEqual(alien.status, 'complete', JSON.stringify(alien.checks));
  const noSound = grade('910152', B.motors('DB'), B.repeat(4, B.move('forward', 30, 'cm'), B.steer(100, 0.64, 'rotations'), B.wait(1)));
  assert.match(noSound.checks.find((c) => c.label.startsWith('Inside the loop')).detail, /sound/);
});

test('open-ended challenges pass what can be checked and leave the route to the teacher', () => {
  const r = grade('910158', B.motors('DB'), B.move('forward', 30, 'cm'), B.steer(100, 0.64, 'rotations'), B.move('forward', 20, 'cm'), B.steer(-100, 0.64, 'rotations'), B.move('forward', 30, 'cm'));
  assert.strictEqual(r.status, 'review');
  assert.ok(r.checks.filter((c) => c.status !== 'review').every((c) => c.status === 'pass'));
  const sensor = grade('910159', B.motors('DB'), B.move('forward', 30, 'cm'), B.steer(100, 0.64, 'rotations'), B.move('forward', 20, 'cm'), B.steer(-100, 0.64, 'rotations'));
  assert.strictEqual(statusOf(sensor, 'Uses the distance sensor'), 'fail');
});

test('bad uploads get friendly messages', () => {
  const notZip = gradeFile(Buffer.from('hello'), { assignment: '910143' });
  assert.strictEqual(notZip.status, 'needs-work');
  assert.match(notZip.feedback, /isn’t a SPIKE project|empty/);
  const python = gradeFile(zip({ 'manifest.json': JSON.stringify({ type: 'python', name: 'p' }), 'projectbody.json': JSON.stringify({ main: 'print(1)' }) }), { assignment: '910143' });
  assert.strictEqual(python.status, 'review');
  const unknown = gradeFile(llsp3(program(B.stop())), { filename: 'my robot.llsp3' });
  assert.strictEqual(unknown.assignment, null);
});

test('guesses the assignment from file or project names', () => {
  assert.strictEqual(guessRule('Sequential Movements Speed Neil Armstrong.llsp3').id, '910157');
  assert.strictEqual(guessRule('MovingForward.llsp3').id, '910143');
  assert.strictEqual(guessRule('x.llsp3', 'Looped Movements').id, '910147');
  assert.strictEqual(guessRule('Light Sequence Reverse').id, '910146');
  assert.strictEqual(guessRule('robot'), null);
  const r = gradeFile(llsp3(program(B.motors('DB'), B.move('forward', 10, 'cm'), B.stop()), { name: 'MovingForward' }), { filename: 'upload.llsp3' });
  assert.deepStrictEqual([r.assignment.id, r.status], ['910143', 'complete']);
});

test('every assignment rule copes with an empty or odd program', () => {
  assert.strictEqual(listAssignments().length, RULES.length);
  for (const rule of RULES) {
    for (const prog of [program(), program(B.repeat(null, B.stop()), B.waitUntil(B.distance('F', '<', 5, 'cm')))]) {
      const r = gradeFile(llsp3(prog), { assignment: rule.id });
      assert.ok(!r.checks.some((c) => c.label === 'Check could not run'), `${rule.name}: ${JSON.stringify(r.checks)}`);
      assert.notStrictEqual(r.status, 'complete', rule.name);
    }
  }
});
