// What "correct" means for each programming assignment, taken from the
// course's Canvas instructions (Computer Science-Love, course 53968).
//
// Each check returns { label, status: 'pass'|'fail'|'review', detail, hint }.
//  - pass/fail: decided from the program itself.
//  - review: can't be decided from the file (e.g. "reaches the finish area"),
//    so the teacher looks at it. Review never counts against the student.
// Checks marked optional are shown but don't affect the result.
'use strict';

const { describe, describeCondition } = require('./program');

// ---------- small helpers ----------

const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
const fmt = (n) => (n == null ? '?' : Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
const check = (label, ok, detail, hint, extra = {}) => ({ label, status: ok ? 'pass' : 'fail', detail, hint: ok ? null : hint, ...extra });
const review = (label, detail, extra = {}) => ({ label, status: 'review', detail, hint: null, ...extra });
const optional = (c) => ({ ...c, optional: true });

const isForward = (s) => (s.kind === 'move' && s.direction === 'forward') || (s.kind === 'steer' && near(s.steering, 0, 10) && (s.amount || 0) > 0);
const isBack = (s) => s.kind === 'move' && s.direction === 'back';
const turnSide = (s) => {
  if (s.kind === 'steer' && Math.abs(s.steering || 0) >= 60) return s.steering > 0 ? 'right' : 'left';
  if (s.kind === 'move' && (s.direction === 'clockwise' || s.direction === 'right')) return 'right';
  if (s.kind === 'move' && (s.direction === 'counterclockwise' || s.direction === 'left')) return 'left';
  return null;
};
const isTurn = (s) => turnSide(s) != null;
const cm = (s, value, tol = 0.5) => s.unit === 'cm' && near(s.amount, value, tol);
const usesSensor = (prog, kind) => prog.all.some((s) => [s.condition, ...(s.condition && s.condition.parts ? s.condition.parts : [])].some((c) => c && c.sensor === kind));
const lights = (steps) => steps.filter((s) => s.kind === 'light');
const patternKey = (s) => (s.pattern ? s.pattern.map((b) => (b ? 1 : 0)).join('') : s.image || null);
const lastTop = (prog) => prog.steps[prog.steps.length - 1];

// Where a step sits in the running order (first match after `from`).
const indexOf = (flat, pred, from = 0) => {
  for (let i = from; i < flat.length; i++) if (pred(flat[i])) return i;
  return -1;
};

// ---------- reusable checks ----------

const hasStart = () => (prog) => check('Starts with “when program starts”', !!prog.main && prog.steps.length > 0,
  prog.main ? `${prog.steps.length} blocks attached` : 'No “when program starts” block with blocks under it',
  'Attach your blocks under the yellow “when program starts” block.');

const motorsDB = () => (prog) => {
  const firstMove = indexOf(prog.flat, (s) => ['move', 'steer', 'startMove'].includes(s.kind));
  const set = prog.flat.find((s, i) => s.kind === 'motors' && (firstMove < 0 || i < firstMove));
  const ports = set ? set.ports : null;
  return check('Movement motors set to D+B', ports === 'DB',
    set ? `Set to ${ports ? ports.split('').join('+') : '?'}` : 'No “set movement motors to” block before moving',
    ports === 'BD' ? 'Swap the order to D+B: the left motor (D) comes first.' : 'Add “set movement motors to D+B” right under “when program starts”.');
};

const endsWithExit = (anyStop = false) => (prog) => {
  const last = lastTop(prog);
  const ok = last && last.kind === 'stop' && (anyStop || last.exit);
  return check(anyStop ? 'Ends with a “stop” block' : 'Ends with “stop and exit program”', !!ok,
    last ? `Last block: ${describe(last)}` : 'No blocks',
    anyStop ? 'Finish with a “stop [all]” block from the Control palette.' : 'Finish with “stop [and exit program]” from the Control palette.');
};

const forwardCm = (value, count = 1, label) => (prog) => {
  const moves = prog.flat.filter(isForward);
  const good = moves.filter((s) => cm(s, value));
  return check(label || `Moves forward ${value} cm${count > 1 ? ` ${count} times` : ''}`, good.length >= count,
    moves.length ? `Forward moves: ${moves.map((s) => `${fmt(s.amount)} ${s.unit || ''}`.trim()).join(', ')}` : 'No forward moves',
    `Use “move forward for ${value} cm”${count > 1 ? ` ${count} times` : ''}. Check the unit is cm, not rotations.`);
};

const rightTurn = () => (prog) => {
  const turns = prog.flat.filter((s) => s.kind === 'steer' && (s.steering || 0) >= 90);
  const good = turns.find((s) => s.unit === 'rotations' && near(s.amount, 0.64, 0.08) && near(s.steering, 100, 5));
  return check('Turns right: steering 100 for 0.64 rotations', !!good,
    turns.length ? turns.map(describe).join('; ') : 'No sharp right turn found',
    'Use a “move (right: 100) for 0.64 rotations” block. Turn the steering wheel all the way right.');
};

const turnsCount = (min) => (prog) => {
  const turns = prog.flat.filter(isTurn);
  return check(`Makes at least ${min} turns`, turns.length >= min,
    turns.length ? `${turns.length} turns: ${turns.map((s) => `${turnSide(s)} (${describe(s)})`).join('; ')}` : 'No turns found',
    'Use turning blocks, e.g. “move (right: 100) for 0.64 rotations”, to turn 90 degrees.');
};

const forwardCount = (min) => (prog) => {
  const n = prog.flat.filter(isForward).length + prog.flat.filter((s) => s.kind === 'startMove').length;
  return check(`Drives forward (at least ${min} moves)`, n >= min, `${n} forward movements`, 'Use movement blocks to drive between the turns.');
};

const sensorUsed = (kind, name) => (prog) => {
  const found = prog.all.filter((s) => s.condition).map((s) => describeCondition(s.condition));
  return check(`Uses the ${name}`, usesSensor(prog, kind),
    found.length ? `Sensor checks: ${found.join('; ')}` : 'No sensor checks found',
    `Use a “wait until” (or “if”) block with a ${name} block inside it.`);
};

const pathReview = (what) => () => review(what, 'Can’t be checked from the file. Watch the robot run, or look at the distances and turns above.');

// ---------- light-matrix lessons ----------

function frames(prog) {
  return lights(prog.flat).filter((s) => near(s.seconds, 1, 0.05));
}

const eightFrames = () => (prog) => {
  const f = frames(prog);
  return check('8 light frames, 1 second each', f.length >= 8, `${f.length} light blocks set to 1 second`,
    'Use eight “turn on [pattern] for 1 seconds” blocks, one for each step of the animation.');
};

const framesDifferent = () => (prog) => {
  const f = frames(prog);
  if (f.length && f.some((s) => !s.pattern)) return review('Each frame shows a different pattern', 'Patterns couldn’t be read from the file');
  const distinct = new Set(f.map(patternKey)).size;
  return check('Each frame shows a different pattern', f.length >= 8 && distinct >= 8, `${distinct} different patterns`,
    'Change the lights in each copied block so every frame is different.');
};

function looksLikeSmiley(p) {
  if (!p) return null;
  const on = (r, c) => p[r * 5 + c] > 0;
  const eyes = [1, 3].every((c) => on(0, c) || on(1, c));
  const mouthPixels = [3, 4].reduce((n, r) => n + [0, 1, 2, 3, 4].filter((c) => on(r, c)).length, 0);
  const symmetric = [0, 1, 2, 3, 4].every((r) => on(r, 0) === on(r, 4) && on(r, 1) === on(r, 3));
  return eyes && mouthPixels >= 3 && symmetric;
}

const smileyAfterFrames = () => (prog) => {
  const f = frames(prog);
  const lastFrame = f.length ? prog.flat.indexOf(f[f.length - 1]) : -1;
  const smile = prog.flat.find((s, i) => i > lastFrame && s.kind === 'light' && near(s.seconds, 2, 0.05));
  if (!smile) return check('Smiley face for 2 seconds after the animation', false, 'No 2-second light block after the frames', 'Add a “turn on [smiley] for 2 seconds” block after the animation.');
  const shape = looksLikeSmiley(smile.pattern);
  if (shape === null) return review('Smiley face for 2 seconds after the animation', 'A 2-second picture is there; check that it’s a smiley');
  return check('Smiley face for 2 seconds after the animation', shape, shape ? 'Smiley found' : 'The 2-second picture doesn’t look like a smiley', 'Draw a smiley face (two eyes and a smile) in the 2-second light block.');
};

const writes = (test, label, hint) => (prog) => {
  const texts = prog.flat.filter((s) => s.kind === 'text');
  return check(label, texts.some((s) => test(s.text.trim())), texts.length ? `Writes: ${texts.map((s) => `“${s.text}”`).join(', ')}` : 'No “write” block', hint);
};

const orderLights = () => (prog) => {
  const kinds = prog.flat.map((s) => (s.kind === 'light' ? (near(s.seconds, 1, 0.05) ? 'frame' : 'picture') : s.kind));
  const lastFrame = kinds.lastIndexOf('frame');
  const text = kinds.indexOf('text', Math.max(0, lastFrame));
  return check('In order: animation → smiley → write → exit', lastFrame >= 0 && text > lastFrame && kinds.slice(lastFrame, text).includes('picture'),
    prog.flat.map(describe).join(' → '),
    'Put the blocks in order: the 8 frames, then the smiley, then the write block, then stop and exit.');
};

const reversedReview = () => (prog) => {
  const f = frames(prog).filter((s) => s.pattern);
  if (f.length < 2) return review('Bars move left-to-right (reversed)', 'Patterns couldn’t be read; watch it run');
  const cx = f.map((s) => {
    const lit = s.pattern.map((b, i) => (b ? i % 5 : null)).filter((x) => x != null);
    return lit.length ? lit.reduce((a, b) => a + b, 0) / lit.length : 2;
  });
  const trend = cx[cx.length - 1] - cx[0];
  return review('Bars move left-to-right (reversed)', `The lit area moves ${trend > 0.5 ? 'left → right' : trend < -0.5 ? 'right → left' : 'around without a clear left/right direction'} across the frames. Compare with the original lesson.`);
};

// ---------- sequential movement challenges ----------

function forwardMoves(prog) {
  return prog.flat.map((s, i) => ({ s, i })).filter(({ s }) => isForward(s));
}

const afterEachMove = (label, pred, hint) => (prog) => {
  const moves = forwardMoves(prog);
  if (!moves.length) return check(label, false, 'No forward moves', hint);
  const missing = moves.filter(({ i }, k) => {
    const end = k + 1 < moves.length ? moves[k + 1].i : prog.flat.length;
    return !prog.flat.slice(i + 1, end).some(pred);
  });
  return check(label, missing.length === 0, missing.length ? `Missing after ${missing.length} of ${moves.length} moves` : `After all ${moves.length} moves`, hint);
};

const differentSpeeds = () => (prog) => {
  let speed = null;
  const speeds = [];
  for (const s of prog.flat) {
    if (s.kind === 'speed') speed = s.value;
    if (isForward(s)) speeds.push(s.speed ?? speed);
  }
  const known = speeds.map((v) => (v == null ? 'default' : `${fmt(v)}%`));
  return check('Each forward move has a different speed', speeds.length >= 4 && new Set(known).size === speeds.length,
    `Speeds: ${known.join(', ') || 'none'}`, 'Add a “set movement speed to [ ]%” block before each move, with a different value each time.');
};

const slowingDown = () => (prog) => {
  let speed = null;
  const speeds = [];
  for (const s of prog.flat) {
    if (s.kind === 'speed') speed = s.value;
    if (isForward(s)) speeds.push(s.speed ?? speed);
  }
  const ok = speeds.length >= 2 && speeds.every((v, i) => i === 0 || (v != null && speeds[i - 1] != null && v < speeds[i - 1]));
  return optional(check('Gets slower after each rock formation', ok, `Speeds: ${speeds.map((v) => (v == null ? 'default' : `${fmt(v)}%`)).join(' → ')}`, 'The story says the rover slows down each time. Try decreasing the speed.'));
};

// ---------- the assignments ----------

const RULES = [
  {
    id: '910145', name: 'Lesson: Programming a Sequence', aliases: ['light sequence', 'light sequences', 'programming a sequence'],
    checks: [hasStart(), eightFrames(), framesDifferent(), smileyAfterFrames(),
      writes((t) => t.toUpperCase() === 'DB', 'Writes “DB”', 'Add a write block and change “Hello” to DB.'), orderLights(), endsWithExit()],
  },
  {
    id: '910146', name: 'Lesson: Programming a Sequence Reverse', aliases: ['reverse', 'sequence reverse'],
    checks: [hasStart(), eightFrames(), framesDifferent(), smileyAfterFrames(),
      writes((t) => { const l = t.replace(/[^a-z]/gi, ''); return l.length >= 2 && l.length <= 3 && l.toUpperCase() !== 'DB'; }, 'Writes your initials (not DB)', 'Change the write block from DB to your first and last initials.'),
      reversedReview(), endsWithExit()],
  },
  {
    id: '910137', name: 'Challenge: Advertising!', aliases: ['advertising'],
    checks: [hasStart(),
      (p) => check('Uses the light matrix', p.all.some((s) => s.kind === 'light' || s.kind === 'text'), `${p.all.filter((s) => s.kind === 'light' || s.kind === 'text').length} light/write blocks`, 'Use light matrix blocks to make your display.'),
      (p) => optional(check('Animated (more than one picture)', new Set(lights(p.all).map(patternKey)).size >= 2, `${new Set(lights(p.all).map(patternKey)).size} different pictures`, 'Show several pictures in a row to animate it.')),
      () => review('Matches the billboard picture in the assignment', 'Compare the hub display with the picture in Canvas.')],
  },
  {
    id: '910151', name: 'Mars Rover Advertising Challenge!', aliases: ['mars rover advertising', 'rover advertising'],
    checks: [hasStart(),
      (p) => {
        const pics = new Set(lights(p.all).map(patternKey).filter(Boolean));
        const texts = new Set(p.all.filter((s) => s.kind === 'text').map((s) => s.text));
        return check('A variety of images (at least 3)', pics.size + texts.size >= 3, `${pics.size} different pictures, ${texts.size} different messages`, 'Show at least three different images or messages.');
      },
      (p) => {
        if (p.all.some((s) => s.kind === 'forever')) return check('Lasts at least 10 seconds', true, 'Runs forever', null);
        let secs = 0;
        for (const s of p.flat) {
          if (s.kind === 'light' && s.seconds) secs += s.seconds;
          if (s.kind === 'wait' && s.seconds) secs += s.seconds;
          if (s.kind === 'text') secs += 0.5 * s.text.length; // the hub scrolls text roughly this fast
        }
        return check('Lasts at least 10 seconds', secs >= 10, `About ${fmt(secs)} seconds of display time`, 'Make the advertisement last longer: add more pictures, longer times, or waits.');
      }],
  },
  {
    id: '910143', name: 'Lesson: Moving Forward', aliases: ['movingforward', 'moving forward'],
    checks: [hasStart(), motorsDB(), forwardCm(10), endsWithExit()],
  },
  {
    id: '910155', name: 'Mini Challenge: Sequential Movements', aliases: ['sequential movements', 'sequential movement'],
    checks: [hasStart(), motorsDB(), forwardCm(20, 4),
      afterEachMove('Stops at least 1 second after each move', (s) => s.kind === 'wait' && (s.seconds || 0) >= 1, 'Add “wait 1 seconds” after each move.')],
  },
  {
    id: '910157', name: 'Mini Challenge: Sequential Movements Speed', aliases: ['sequential movements speed'],
    checks: [hasStart(), motorsDB(), forwardCm(20, 4), differentSpeeds(), slowingDown()],
  },
  {
    id: '910156', name: 'Mini Challenge: Sequential Movements Sound', aliases: ['sequential movements sound'],
    checks: [hasStart(), motorsDB(), forwardCm(20, 4),
      afterEachMove('Plays a sound after each move', (s) => s.kind === 'sound', 'Add a sound block after each move.')],
  },
  {
    id: '910148', name: 'Lesson: Turning In Place', aliases: ['turning in place'],
    checks: [hasStart(), motorsDB(), rightTurn(), endsWithExit()],
  },
  {
    id: '910158', name: 'Mini Challenge: Turn Around Craters', aliases: ['turn around craters', 'around craters'],
    checks: [hasStart(), motorsDB(), forwardCount(2), turnsCount(2), pathReview('Reaches the finish area without hitting a crater')],
  },
  {
    id: '910160', name: 'Mini Challenge: Turn Around Mars Craters', aliases: ['turn around mars craters', 'mars craters'],
    checks: [hasStart(), motorsDB(), forwardCount(2), turnsCount(2), pathReview('Reaches the finish area without hitting a crater')],
  },
  {
    id: '910144', name: 'Lesson: Pick up and Move', aliases: ['pick up and move', 'pickup and move'],
    checks: [hasStart(), motorsDB(),
      (p) => {
        const arm = p.flat.filter((s) => s.kind === 'motor');
        const small = arm.filter((s) => s.unit === 'rotations' && near(s.amount, 0.2, 0.05));
        const dirs = new Set(small.map((s) => s.direction));
        return check('Arm closes and opens (0.2 rotations each way)', small.length >= 2 && dirs.size >= 2,
          arm.length ? arm.map(describe).join('; ') : 'No motor blocks', 'Use two “run [direction] for 0.2 rotations” motor blocks, the second in the opposite direction.');
      },
      forwardCm(20, 1, 'Moves forward 20 cm'),
      (p) => check('Moves back 20 cm', p.flat.some((s) => isBack(s) && cm(s, 20)), p.flat.filter(isBack).map(describe).join('; ') || 'No backward moves', 'Add “move back for 20 cm” after releasing the object.'),
      (p) => {
        const grab = indexOf(p.flat, (s) => s.kind === 'motor');
        const fwd = indexOf(p.flat, isForward, grab + 1);
        const release = indexOf(p.flat, (s) => s.kind === 'motor', fwd + 1);
        const back = indexOf(p.flat, isBack, release + 1);
        return check('In order: grab → forward → release → back', grab >= 0 && fwd > grab && release > fwd && back > release, p.flat.map(describe).join(' → '), 'Order the blocks: close the arm, move forward, open the arm, move back.');
      },
      endsWithExit()],
  },
  {
    id: '910142', name: 'Lesson: Move and Turn', aliases: ['move and turn'],
    checks: [hasStart(), motorsDB(), forwardCm(10), rightTurn(),
      (p) => {
        const fwd = indexOf(p.flat, (s) => isForward(s) && cm(s, 10));
        const stop = indexOf(p.flat, (s) => s.kind === 'stopMove', fwd + 1);
        const turn = indexOf(p.flat, (s) => s.kind === 'steer' && (s.steering || 0) >= 90, stop + 1);
        return check('In order: forward → stop moving → turn', fwd >= 0 && stop > fwd && turn > stop, p.flat.map(describe).join(' → '), 'Add a “stop moving” block between moving forward and turning.');
      },
      endsWithExit()],
  },
  {
    id: '910141', name: 'Lesson: Move Until Near', aliases: ['move until near'],
    checks: [hasStart(), motorsDB(),
      (p) => check('Starts moving forward', p.flat.some((s) => s.kind === 'startMove'), p.flat.filter((s) => s.kind === 'startMove').map(describe).join('; ') || 'No “start moving” block', 'Use “start moving forward” (not “move for…”).'),
      (p) => {
        const w = p.flat.find((s) => s.kind === 'waitUntil' && s.condition && s.condition.sensor === 'distance');
        const c = w && w.condition;
        const ok = c && c.port === 'F' && c.comparator !== 'farther' && c.unit === 'cm' && c.value != null && c.value >= 15 && c.value <= 20;
        return check('Waits until F is closer than 20 cm', !!ok, w ? describe(w) : 'No “wait until” with a distance sensor',
          'Use “wait until [F] is closer than 20 cm”. Check the port is F and the unit is cm, not %.');
      },
      (p) => {
        const wait = indexOf(p.flat, (s) => s.kind === 'waitUntil');
        const start = indexOf(p.flat, (s) => s.kind === 'startMove');
        const stop = indexOf(p.flat, (s) => s.kind === 'stopMove', wait + 1);
        return check('In order: start moving → wait until near → stop moving', start >= 0 && wait > start && stop > wait, p.flat.map(describe).join(' → '), 'Start moving, then wait until near, then stop moving.');
      },
      endsWithExit()],
  },
  {
    id: '910159', name: 'Mini Challenge: Turn Around Craters Sensor', aliases: ['craters sensor'],
    checks: [hasStart(), motorsDB(), sensorUsed('distance', 'distance sensor'), forwardCount(2), turnsCount(2), pathReview('Reaches the finish area without hitting a crater')],
  },
  {
    id: '910149', name: 'Lesson: Wait for Green', aliases: ['wait until green', 'wait for green'],
    checks: [hasStart(),
      (p) => {
        const w = p.flat.find((s) => s.kind === 'waitUntil' && s.condition && s.condition.sensor === 'color');
        const ok = w && w.condition.port === 'A' && w.condition.color === 'green';
        return check('Waits until A sees green', !!ok, w ? describe(w) : 'No “wait until” with a color sensor', 'Use “wait until [A] is color [green]”.');
      },
      (p) => {
        const wait = indexOf(p.flat, (s) => s.kind === 'waitUntil');
        return check('Shows a light pattern after seeing green', wait >= 0 && indexOf(p.flat, (s) => s.kind === 'light' || s.kind === 'text', wait + 1) > wait, 'Light block after the wait', 'Add a “turn on” light block after the wait until block.');
      },
      endsWithExit(true)],
  },
  {
    id: '910154', name: 'Mini Challenge: Find the emeralds', aliases: ['find the emeralds', 'emeralds'],
    checks: [hasStart(), motorsDB(), sensorUsed('color', 'color sensor'), forwardCount(2), turnsCount(1), pathReview('Stops at each crater and reaches the finish')],
  },
  {
    id: '910153', name: 'Mini Challenge: Find the Mars emeralds', aliases: ['find the mars emeralds', 'mars emeralds'],
    checks: [hasStart(), motorsDB(), sensorUsed('color', 'color sensor'), forwardCount(2), turnsCount(1), pathReview('Stops at each crater and reaches the finish')],
  },
  {
    id: '910152', name: 'Mini Challenge: Around Alien', aliases: ['around alien', 'travel around alien'],
    checks: [hasStart(),
      (p) => {
        const loops = p.all.filter((s) => s.kind === 'repeat');
        return check('Uses a “repeat” loop', loops.length > 0, loops.length ? loops.map(describe).join('; ') : 'No repeat loop', 'Put the moves for one side inside a “repeat” block.');
      },
      (p) => {
        const loop = p.all.find((s) => s.kind === 'repeat');
        const body = loop ? loop.body : [];
        const has = { forward: body.some(isForward), turn: body.some(isTurn), wait: body.some((s) => s.kind === 'wait' && (s.seconds || 0) >= 1), sound: body.some((s) => s.kind === 'sound') };
        const missing = Object.entries(has).filter(([, v]) => !v).map(([k]) => k);
        return check('Inside the loop: forward, turn, wait 1 second, sound', !!loop && missing.length === 0, loop ? (missing.length ? `Missing inside the loop: ${missing.join(', ')}` : 'All four are inside the loop') : 'No loop',
          'Inside the repeat: move forward, turn, wait 1 second and play a sound.');
      },
      (p) => {
        const corners = p.flat.filter(isTurn).length;
        return check('Goes all the way around (4 corners)', corners >= 4, `${corners} turns when the loop runs`, 'Repeat 4 times so the rover visits all four corners.');
      }],
  },
  {
    id: '910147', name: 'Lesson: Repeat Loops', aliases: ['looped movements', 'repeat loops'],
    checks: [hasStart(), motorsDB(),
      (p) => {
        const loop = p.all.find((s) => s.kind === 'repeat');
        return check('Repeat loop set to 3', !!loop && loop.times === 3, loop ? describe(loop) : 'No repeat loop', 'Wrap the moves in a “repeat” block and change 10 to 3.');
      },
      (p) => {
        const loop = p.all.find((s) => s.kind === 'repeat');
        const body = loop ? loop.body : [];
        const f = indexOf(body, (s) => isForward(s) && cm(s, 10));
        const b = indexOf(body, (s) => isBack(s) && cm(s, 10), f + 1);
        return check('Inside the loop: forward 10 cm then back 10 cm', f >= 0 && b > f, body.length ? body.map(describe).join(' → ') : 'Nothing inside a loop', 'Inside the repeat: “move forward for 10 cm” then “move back for 10 cm”.');
      }],
  },
  {
    id: '910139', name: 'Final Challenge: Alien Collection', aliases: ['alien collection', 'final challenge'],
    checks: [hasStart(), motorsDB(),
      (p) => check('Uses sensors', usesSensor(p, 'distance') || usesSensor(p, 'color') || usesSensor(p, 'force'), p.all.filter((s) => s.condition).map((s) => describeCondition(s.condition)).join('; ') || 'No sensor checks', 'You must use sensors: e.g. “wait until [F] is closer than … cm”.'),
      (p) => check('Uses the arm to grab', p.all.filter((s) => s.kind === 'motor').length >= 2, `${p.all.filter((s) => s.kind === 'motor').length} arm (motor) blocks`, 'Use motor blocks to close and open the arm.'),
      (p) => {
        const loop = p.all.find((s) => s.kind === 'repeat' && s.times >= 3);
        const grabs = p.flat.filter((s) => s.kind === 'motor').length;
        if (loop || grabs >= 6) return check('Collects in all 3 lanes', true, loop ? describe(loop) : `${grabs} arm moves`, null);
        return review('Collects in all 3 lanes', 'No repeat 3 found; check the program covers three lanes');
      },
      pathReview('Picks up the aliens and brings them back')],
  },
];

module.exports = { RULES, looksLikeSmiley, isForward, isTurn };
