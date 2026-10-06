// Reads LEGO SPIKE App 3 project files (.llsp3) with no dependencies.
//
// A .llsp3 is a zip containing manifest.json, icon.svg and (for block
// programs) scratch.sb3 — itself a zip whose project.json holds the blocks in
// Scratch 3 format. Python projects keep their code in projectbody.json.
'use strict';

const zlib = require('zlib');

const MAX_ENTRY = 20 * 1024 * 1024; // refuse anything absurd (zip bombs)

class Llsp3Error extends Error {}

function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Llsp3Error('This file is empty or not a SPIKE project.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Llsp3Error('This file isn’t a SPIKE project (.llsp3). Was the right file uploaded?');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Llsp3Error('The project file is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, csize, usize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.usize > MAX_ENTRY) throw new Llsp3Error(`${name} is too large.`);
      if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Llsp3Error('The project file is damaged.');
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new Llsp3Error(`Unsupported compression in ${name}.`);
    },
  };
}

function parseJson(buf, what) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Llsp3Error(`The project’s ${what} couldn’t be read.`);
  }
}

// → { name, type: 'word-blocks' | 'icon-blocks' | 'python' | …, hardware, project (Scratch JSON) | null, python | null }
function readLlsp3(buf) {
  const zip = readZip(buf);
  const manifest = zip.has('manifest.json') ? parseJson(zip.read('manifest.json'), 'manifest') : {};
  const out = {
    name: manifest.name || '',
    type: manifest.type || 'unknown',
    hardware: Object.values(manifest.hardware || {}).map((h) => h.type).filter(Boolean),
    project: null,
    python: null,
  };
  if (zip.has('scratch.sb3')) {
    const inner = readZip(zip.read('scratch.sb3'));
    if (!inner.has('project.json')) throw new Llsp3Error('The project has no program inside.');
    out.project = parseJson(inner.read('project.json'), 'program');
  } else if (zip.has('projectbody.json')) {
    const body = parseJson(zip.read('projectbody.json'), 'program');
    out.python = typeof body.main === 'string' ? body.main : JSON.stringify(body);
  } else if (zip.has('project.json')) {
    out.project = parseJson(zip.read('project.json'), 'program'); // a bare Scratch project
  } else {
    throw new Llsp3Error('This SPIKE file has no program inside.');
  }
  return out;
}

module.exports = { readLlsp3, readZip, Llsp3Error };
