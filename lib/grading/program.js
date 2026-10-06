// Turns a SPIKE Prime Word Blocks program (Scratch 3 project.json) into a list
// of meaningful steps: "set movement motors to D+B", "move forward 10 cm",
// "wait until F is closer than 20 cm", "repeat 3 { … }" and so on.
//
// Block names are matched loosely (by pattern, not exact opcode) so that small
// differences between SPIKE app versions don't break grading. Anything not
// recognised becomes an "other" step that is still shown to the teacher.
'use strict';

const COLORS = { '-1': 'no color', 0: 'black', 1: 'magenta', 2: 'violet', 3: 'blue', 4: 'azure', 5: 'turquoise', 6: 'green', 7: 'yellow', 8: 'orange', 9: 'red', 10: 'white' };
const COLOR_NAMES = new Set(Object.values(COLORS));
const UNITS = { cm: 'cm', in: 'in', inches: 'in', inch: 'in', rotations: 'rotations', rotation: 'rotations', degrees: 'degrees', degree: 'degrees', seconds: 'seconds', second: 'seconds', sec: 'seconds', '%': '%', percent: '%' };
const DIRECTIONS = { forward: 'forward', back: 'back', backward: 'back', backwards: 'back', clockwise: 'clockwise', counterclockwise: 'counterclockwise', anticlockwise: 'counterclockwise', right: 'right', left: 'left' };

function num(v) {
  if (v == null || typeof v === 'object') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function makeReader(blocks) {
  const get = (id) => (typeof id === 'string' && blocks[id] && typeof blocks[id] === 'object' ? blocks[id] : null);

  // Scratch primitive: [type, value, (id)]. Variables/lists can't be graded as values.
  const literal = (v) => (Array.isArray(v) ? (v[0] === 12 || v[0] === 13 ? { variable: v[1] } : v[1]) : undefined);

  // First field value of a shadow block (dropdowns, number boxes…).
  const shadowValue = (b) => {
    const f = Object.values(b.fields || {})[0];
    if (f) return Array.isArray(f) ? f[0] : f;
    for (const name of Object.keys(b.inputs || {})) {
      const v = inputValue(b, name);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  function inputValue(block, name) {
    const inp = block.inputs && block.inputs[name];
    if (!Array.isArray(inp)) return undefined;
    const [, a, b] = inp;
    if (typeof a === 'string') {
      const blk = get(a);
      if (blk && blk.shadow) return shadowValue(blk);
      if (blk) return { reporter: blk.opcode };
    }
    if (Array.isArray(a)) return literal(a);
    if (Array.isArray(b)) return literal(b);
    return undefined;
  }

  function inputBlock(block, name) {
    const inp = block.inputs && block.inputs[name];
    if (!Array.isArray(inp)) return null;
    return get(inp[1]);
  }

  // Every plain value on a block: its own fields plus its shadow inputs.
  function values(block) {
    const out = [];
    for (const f of Object.values(block.fields || {})) out.push(Array.isArray(f) ? f[0] : f);
    for (const name of Object.keys(block.inputs || {})) {
      if (/SUBSTACK|CONDITION/.test(name)) continue;
      const v = inputValue(block, name);
      if (v != null && typeof v !== 'object') out.push(v);
    }
    return out.filter((v) => v != null).map(String);
  }

  return { get, inputValue, inputBlock, values };
}

const ports = (vals) => {
  for (const v of vals) {
    const letters = String(v).toUpperCase().replace(/[^A-F]/g, '');
    if (letters && /^[A-F+\s]+$/i.test(String(v).trim())) return letters;
  }
  return null;
};
const direction = (vals) => vals.map((v) => DIRECTIONS[String(v).toLowerCase()]).find(Boolean) || null;
const unitOf = (block, vals) => {
  const f = block.fields && block.fields.UNIT;
  const raw = f ? (Array.isArray(f) ? f[0] : f) : vals.find((v) => UNITS[String(v).toLowerCase()]);
  return raw ? UNITS[String(raw).toLowerCase()] || String(raw) : null;
};
const patternOf = (vals) => {
  const p = vals.find((v) => /^[0-9]{25}$/.test(v));
  return p ? p.split('').map(Number) : null;
};
const colorOf = (v) => {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).toLowerCase();
  if (COLOR_NAMES.has(s)) return s;
  return COLORS[s] || null;
};

function parseProject(project) {
  const sprites = (project.targets || []).filter((t) => !t.isStage);
  const blocks = Object.assign({}, ...(sprites.length ? sprites : project.targets || []).map((t) => t.blocks || {}));
  const r = makeReader(blocks);

  function condition(block) {
    if (!block) return null;
    const lc = block.opcode.toLowerCase();
    const vals = r.values(block);
    if (/operator_(and|or)/.test(lc)) return { sensor: lc.endsWith('and') ? 'and' : 'or', parts: [condition(r.inputBlock(block, 'OPERAND1')), condition(r.inputBlock(block, 'OPERAND2'))].filter(Boolean) };
    if (/operator_not/.test(lc)) return { sensor: 'not', parts: [condition(r.inputBlock(block, 'OPERAND'))].filter(Boolean) };
    const base = { opcode: block.opcode, port: ports(vals) };
    if (/distance/.test(lc)) {
      const cmp = vals.map((v) => String(v).toLowerCase()).find((v) => ['<', '>', '=', 'closer', 'farther', 'exactly'].some((k) => v.includes(k)));
      return { ...base, sensor: 'distance', comparator: !cmp ? null : /<|closer/.test(cmp) ? 'closer' : />|farther/.test(cmp) ? 'farther' : 'exactly', value: num(r.inputValue(block, 'VALUE')), unit: unitOf(block, vals) };
    }
    if (/color|colour/.test(lc)) return { ...base, sensor: 'color', color: colorOf(r.inputValue(block, 'VALUE')) || vals.map(colorOf).find(Boolean) || null };
    if (/force|pressed|button/.test(lc)) return { ...base, sensor: 'force' };
    if (/tilt|orientation|gyro|yaw|pitch|roll|gesture/.test(lc)) return { ...base, sensor: 'tilt' };
    if (/reflect|light/.test(lc)) return { ...base, sensor: 'reflection' };
    return { ...base, sensor: 'other' };
  }

  function step(block) {
    const op = block.opcode || '';
    const lc = op.toLowerCase();
    const cat = lc.split('_')[0];
    const vals = r.values(block);
    const v = (name) => r.inputValue(block, name);
    const id = r.blockId(block);

    if (/whenprogramstarts/.test(lc)) return { kind: 'start', opcode: op, id };
    if (/_when/.test(lc)) return { kind: 'event', opcode: op, id };

    if (cat.includes('move')) {
      if (/setmovementpair|movementpair/.test(lc)) return { kind: 'motors', ports: ports(vals), opcode: op, id };
      if (/movementspeed$|setspeed$|speed$/.test(lc) && !/move.+at|steer/.test(lc)) return { kind: 'speed', value: num(v('SPEED')), opcode: op, id };
      if (/stop/.test(lc)) return { kind: 'stopMove', opcode: op, id };
      if (/start.*steer|steer.*start/.test(lc)) return { kind: 'startMove', steering: num(v('STEERING')), direction: null, opcode: op, id };
      if (/start/.test(lc)) return { kind: 'startMove', direction: direction(vals) || 'forward', steering: null, opcode: op, id };
      if (/steer/.test(lc)) return { kind: 'steer', steering: num(v('STEERING')), amount: num(v('VALUE')), unit: unitOf(block, vals), speed: num(v('SPEED')), opcode: op, id };
      if (/turn/.test(lc)) return { kind: 'move', direction: direction(vals) || 'clockwise', amount: num(v('VALUE')) ?? num(v('DEGREES')), unit: unitOf(block, vals) || 'degrees', speed: num(v('SPEED')), opcode: op, id };
      if (/move/.test(lc)) return { kind: 'move', direction: direction(vals) || 'forward', amount: num(v('VALUE')), unit: unitOf(block, vals), speed: num(v('SPEED')), opcode: op, id };
    }
    if (cat.includes('motor')) {
      if (/stop/.test(lc)) return { kind: 'motorStop', port: ports(vals), opcode: op, id };
      if (/speed/.test(lc) && !/for|direction|position/.test(lc)) return { kind: 'motorSpeed', port: ports(vals), value: num(v('SPEED')), opcode: op, id };
      return { kind: 'motor', port: ports(vals), direction: direction(vals), amount: num(v('VALUE')), unit: unitOf(block, vals), opcode: op, id };
    }
    if (cat.includes('light') || cat.includes('display')) {
      if (/text|write/.test(lc)) return { kind: 'text', text: String(v('TEXT') ?? vals[0] ?? ''), opcode: op, id };
      if (/off|clear/.test(lc)) return { kind: 'lightOff', opcode: op, id };
      if (/image|matrix|display|pattern/.test(lc)) {
        return { kind: 'light', pattern: patternOf(vals), image: patternOf(vals) ? null : vals.find((x) => /^[A-Z_]{3,}$/.test(x)) || null, seconds: /time|for/.test(lc) ? num(v('VALUE')) : null, opcode: op, id };
      }
      return { kind: 'lightOther', opcode: op, id };
    }
    if (cat.includes('sound') || cat.includes('music')) {
      if (/play|beep|note|start|sound|drum/.test(lc) && !/volume|stop|effect|tempo/.test(lc)) return { kind: 'sound', opcode: op, id };
      return { kind: 'soundOther', opcode: op, id };
    }
    if (cat.includes('control')) {
      if (/wait_?until|waituntil/.test(lc)) return { kind: 'waitUntil', condition: condition(r.inputBlock(block, 'CONDITION')), opcode: op, id };
      if (/wait/.test(lc)) return { kind: 'wait', seconds: num(v('DURATION')) ?? num(v('VALUE')), opcode: op, id };
      if (/repeat_?until|repeatuntil/.test(lc)) return { kind: 'repeatUntil', condition: condition(r.inputBlock(block, 'CONDITION')), body: stack(r.inputBlock(block, 'SUBSTACK')), opcode: op, id };
      if (/repeat/.test(lc)) return { kind: 'repeat', times: num(v('TIMES')), body: stack(r.inputBlock(block, 'SUBSTACK')), opcode: op, id };
      if (/forever/.test(lc)) return { kind: 'forever', body: stack(r.inputBlock(block, 'SUBSTACK')), opcode: op, id };
      if (/if/.test(lc)) {
        return { kind: 'if', condition: condition(r.inputBlock(block, 'CONDITION')), body: stack(r.inputBlock(block, 'SUBSTACK')), elseBody: stack(r.inputBlock(block, 'SUBSTACK2')), opcode: op, id };
      }
      if (/stop/.test(lc)) return { kind: 'stop', exit: vals.some((x) => /exit/i.test(x)), option: vals.join(' '), opcode: op, id };
    }
    return { kind: 'other', opcode: op, id };
  }

  function stack(first) {
    const out = [];
    const seen = new Set();
    let b = first;
    while (b && !seen.has(b)) {
      seen.add(b);
      out.push(step(b));
      b = r.get(b.next);
    }
    return out;
  }

  // ids are only used for diagnostics
  const idOf = new Map(Object.entries(blocks).map(([k, b]) => [b, k]));
  r.blockId = (b) => idOf.get(b) || null;

  const tops = Object.values(blocks).filter((b) => b && typeof b === 'object' && b.topLevel && !b.shadow && b.opcode);
  const scripts = [];
  const loose = [];
  for (const top of tops) {
    const hat = step(top);
    if (hat.kind === 'start' || hat.kind === 'event') scripts.push({ hat, steps: stack(r.get(top.next)) });
    else loose.push(stack(top));
  }
  const main = scripts.find((s) => s.hat.kind === 'start') || null;
  return { scripts, main, loose, steps: main ? main.steps : [], flat: main ? flatten(main.steps) : [], all: scripts.flatMap((s) => deep(s.steps)) };
}

// Every step at any depth (for "does the program use X anywhere?").
function deep(steps) {
  const out = [];
  for (const s of steps) {
    out.push(s);
    if (s.body) out.push(...deep(s.body));
    if (s.elseBody) out.push(...deep(s.elseBody));
  }
  return out;
}

// The order steps actually run in: repeat loops unrolled (up to 50 times),
// forever loops and if-branches included once. Loop markers are kept so
// checks can tell what was inside a loop.
function flatten(steps, inLoop = 0) {
  const out = [];
  for (const s of steps) {
    if (s.kind === 'repeat') {
      const times = s.times != null && s.times >= 0 ? Math.min(50, Math.floor(s.times)) : 1;
      for (let i = 0; i < times; i++) out.push(...flatten(s.body, inLoop + 1));
    } else if (s.kind === 'forever' || s.kind === 'repeatUntil') {
      out.push(...flatten(s.body, inLoop + 1));
    } else if (s.kind === 'if') {
      out.push({ ...s, body: undefined, elseBody: undefined }, ...flatten(s.body, inLoop), ...flatten(s.elseBody || [], inLoop));
    } else {
      out.push(inLoop ? { ...s, inLoop } : s);
    }
  }
  return out;
}

// ---------- plain-English descriptions (for teachers and feedback) ----------

const fmt = (n) => (n == null ? '?' : Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
const portName = (p) => (p ? p.split('').join('+') : '?');

function describeCondition(c) {
  if (!c) return 'something';
  if (c.parts) return c.parts.map(describeCondition).join(` ${c.sensor} `);
  if (c.sensor === 'distance') return `${c.port || '?'} is ${c.comparator === 'farther' ? 'farther than' : c.comparator === 'exactly' ? 'exactly' : 'closer than'} ${fmt(c.value)} ${c.unit || ''}`.trim();
  if (c.sensor === 'color') return `${c.port || '?'} sees ${c.color || 'a color'}`;
  if (c.sensor === 'force') return `force sensor ${c.port || ''} is pressed`.replace(/\s+/g, ' ');
  if (c.sensor === 'tilt') return 'the hub is tilted';
  return c.opcode || 'a sensor';
}

function describe(s) {
  switch (s.kind) {
    case 'start': return 'when program starts';
    case 'event': return `event: ${s.opcode}`;
    case 'motors': return `set movement motors to ${portName(s.ports)}`;
    case 'speed': return `set movement speed to ${fmt(s.value)}%`;
    case 'move': return `move ${s.direction} for ${fmt(s.amount)} ${s.unit || ''}${s.speed != null ? ` at ${fmt(s.speed)}%` : ''}`.trim();
    case 'steer': return `move (steering ${fmt(s.steering)}) for ${fmt(s.amount)} ${s.unit || ''}`.trim();
    case 'startMove': return s.steering != null ? `start moving (steering ${fmt(s.steering)})` : `start moving ${s.direction}`;
    case 'stopMove': return 'stop moving';
    case 'motor': return `run motor ${portName(s.port)} ${s.direction || ''} for ${fmt(s.amount)} ${s.unit || ''}`.replace(/\s+/g, ' ').trim();
    case 'motorSpeed': return `set motor ${portName(s.port)} speed to ${fmt(s.value)}%`;
    case 'motorStop': return `stop motor ${portName(s.port)}`;
    case 'light': return `light matrix ${s.pattern ? 'pattern' : s.image || 'image'}${s.seconds != null ? ` for ${fmt(s.seconds)} seconds` : ''}`;
    case 'text': return `write “${s.text}”`;
    case 'lightOff': return 'turn off light matrix';
    case 'sound': return 'play a sound';
    case 'wait': return `wait ${fmt(s.seconds)} seconds`;
    case 'waitUntil': return `wait until ${describeCondition(s.condition)}`;
    case 'repeat': return `repeat ${fmt(s.times)} times`;
    case 'repeatUntil': return `repeat until ${describeCondition(s.condition)}`;
    case 'forever': return 'forever';
    case 'if': return `if ${describeCondition(s.condition)}`;
    case 'stop': return s.exit ? 'stop and exit program' : `stop ${s.option || 'all'}`.trim();
    default: return `${s.opcode} block`;
  }
}

// A readable outline of the program, e.g. for the teacher's review screen.
function outline(steps, indent = '  ') {
  const lines = [];
  for (const s of steps) {
    lines.push(`${indent}${describe(s)}`);
    if (s.kind === 'light' && s.pattern) for (let row = 0; row < 5; row++) lines.push(`${indent}    ${s.pattern.slice(row * 5, row * 5 + 5).map((b) => (b ? '■' : '·')).join(' ')}`);
    if (s.body) lines.push(...outline(s.body, `${indent}  `));
    if (s.elseBody && s.elseBody.length) lines.push(`${indent}else`, ...outline(s.elseBody, `${indent}  `));
  }
  return lines;
}

module.exports = { parseProject, flatten, deep, describe, describeCondition, outline, COLORS };
