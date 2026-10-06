// Builds .llsp3 files for tests, shaped like the SPIKE App 3 output (a zip
// with manifest.json and scratch.sb3, which is a zip with project.json).
// Movement blocks mirror a real file; other block names follow the same style.
'use strict';

const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files, deflate = true) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const method = deflate ? 8 : 0;
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- block builders ----------
// Each builder returns emit(ctx, parentId) → block id.

function program(...steps) {
  const blocks = {};
  let n = 0;
  const newId = () => `b${++n}`;
  const shadow = (opcode, field, value, parent) => {
    const id = newId();
    blocks[id] = { opcode, next: null, parent, inputs: {}, fields: { [field]: [value, null] }, shadow: true, topLevel: false };
    return id;
  };
  const ctx = { blocks, newId, shadow };
  const startId = newId();
  blocks[startId] = { opcode: 'flipperevents_whenProgramStarts', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0 };
  chain(ctx, steps, startId, (first) => { blocks[startId].next = first; });
  return { targets: [{ isStage: true, name: 'Stage', blocks: {} }, { isStage: false, name: 'sprite', blocks }], meta: { semver: '3.0.0' } };
}

function chain(ctx, steps, parent, attach) {
  let prev = null;
  for (const s of steps) {
    const id = s(ctx, prev || parent);
    if (prev) ctx.blocks[prev].next = id;
    else attach(id);
    prev = id;
  }
}

const block = (opcode, build) => (ctx, parent) => {
  const id = ctx.newId();
  const b = { opcode, next: null, parent, inputs: {}, fields: {}, shadow: false, topLevel: false };
  ctx.blocks[id] = b;
  if (build) build(b, id, ctx);
  return id;
};
const numberInput = (v, type = 4) => [1, [type, String(v)]];

const B = {
  motors: (ports) => block('flippermove_setMovementPair', (b, id, ctx) => { b.inputs.PAIR = [1, ctx.shadow('flippermove_movement-port-selector', 'field_flippermove_movement-port-selector', ports, id)]; }),
  move: (direction, value, unit) => block('flippermove_move', (b, id, ctx) => {
    b.inputs.DIRECTION = [1, ctx.shadow('flippermove_custom-icon-direction', 'field_flippermove_custom-icon-direction', direction, id)];
    b.inputs.VALUE = numberInput(value);
    b.fields.UNIT = [unit, null];
  }),
  steer: (steering, value, unit) => block('flippermove_steer', (b) => {
    b.inputs.STEERING = numberInput(steering);
    b.inputs.VALUE = numberInput(value);
    b.fields.UNIT = [unit, null];
  }),
  startMove: (direction = 'forward') => block('flippermove_startMove', (b, id, ctx) => {
    b.inputs.DIRECTION = [1, ctx.shadow('flippermove_custom-icon-direction', 'field_flippermove_custom-icon-direction', direction, id)];
  }),
  stopMove: () => block('flippermove_stopMove'),
  speed: (v) => block('flippermove_movementSpeed', (b) => { b.inputs.SPEED = numberInput(v); }),
  motor: (port, direction, value, unit) => block('flippermotor_motorTurnForDirection', (b, id, ctx) => {
    b.inputs.PORT = [1, ctx.shadow('flippermotor_multiple-port-selector', 'field_flippermotor_multiple-port-selector', port, id)];
    b.inputs.DIRECTION = [1, ctx.shadow('flippermotor_custom-icon-direction', 'field_flippermotor_custom-icon-direction', direction, id)];
    b.inputs.VALUE = numberInput(value);
    b.fields.UNIT = [unit, null];
  }),
  light: (pattern, seconds) => block(seconds == null ? 'flipperlight_lightDisplayImageOn' : 'flipperlight_lightDisplayImageOnForTime', (b, id, ctx) => {
    b.inputs.MATRIX = [1, ctx.shadow('flipperlight_matrix5x5', 'field_flipperlight_matrix5x5', pattern, id)];
    if (seconds != null) b.inputs.VALUE = numberInput(seconds);
  }),
  text: (t) => block('flipperlight_lightDisplayText', (b) => { b.inputs.TEXT = [1, [10, t]]; }),
  sound: () => block('flippersound_playSoundUntilDone', (b, id, ctx) => { b.inputs.SOUND = [1, ctx.shadow('flippersound_custom-icon-sound', 'field_flippersound_custom-icon-sound', 'Cat Meow 1', id)]; }),
  wait: (s) => block('control_wait', (b) => { b.inputs.DURATION = numberInput(s, 5); }),
  waitUntil: (cond) => block('control_wait_until', (b, id, ctx) => { b.inputs.CONDITION = [2, cond(ctx, id)]; }),
  repeat: (times, ...steps) => block('control_repeat', (b, id, ctx) => {
    b.inputs.TIMES = numberInput(times, 6);
    chain(ctx, steps, id, (first) => { b.inputs.SUBSTACK = [2, first]; });
  }),
  stop: (exit = true) => block('flippercontrol_stop', (b) => { b.fields.STOP_OPTION = [exit ? 'exit' : 'all', null]; }),
  distance: (port, comparator, value, unit) => block('flippersensors_isDistance', (b, id, ctx) => {
    b.inputs.PORT = [1, ctx.shadow('flippersensors_distance-sensor-selector', 'field_flippersensors_distance-sensor-selector', port, id)];
    b.inputs.VALUE = numberInput(value);
    b.fields.COMPARATOR = [comparator, null];
    b.fields.UNIT = [unit, null];
  }),
  color: (port, code) => block('flippersensors_isColor', (b, id, ctx) => {
    b.inputs.PORT = [1, ctx.shadow('flippersensors_color-sensor-selector', 'field_flippersensors_color-sensor-selector', port, id)];
    b.inputs.VALUE = [1, ctx.shadow('flippersensors_color-selector', 'field_flippersensors_color-selector', String(code), id)];
  }),
};

function llsp3(project, { name = 'test', type = 'word-blocks' } = {}) {
  const manifest = { type, name, hardware: { x: { type: 'flipper' } }, extensions: [] };
  return zip({ 'manifest.json': JSON.stringify(manifest), 'scratch.sb3': zip({ 'project.json': JSON.stringify(project) }), 'icon.svg': '<svg/>' }, false);
}

// 5x5 patterns as rows of 0/1 (converted to SPIKE's 0–9 brightness string).
const pattern = (...rows) => rows.join('').replace(/1/g, '9');

module.exports = { B, program, llsp3, zip, pattern };
