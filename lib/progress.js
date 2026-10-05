// Turns Canvas module data into game state: levels, per-student position,
// rankings, character assignments, and "X cleared Y" events between refreshes.
'use strict';

const crypto = require('crypto');
const { CHARACTER_COUNT, parseCharacterSpec } = require('../public/sprites.js');

function requirementItems(module) {
  return (module.items || []).filter((i) => i.completion_requirement && i.published !== false);
}

// Levels are the course's published modules that have at least one completion
// requirement (an info-only module would otherwise be a free level).
function buildLevels(courseModules, { moduleIds, themes } = {}) {
  let mods = courseModules.filter((m) => m.published !== false);
  if (moduleIds && moduleIds.length) {
    const order = new Map(moduleIds.map((id, i) => [String(id), i]));
    mods = mods.filter((m) => order.has(String(m.id))).sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  } else {
    mods = mods.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  return mods
    .map((m) => ({
      id: m.id,
      name: m.name,
      theme: (themes && themes[m.id]) || null,
      items: requirementItems(m).map((i) => ({ id: i.id, title: i.title, type: i.type })),
    }))
    .filter((l) => l.items.length > 0);
}

function studentProgress(levels, studentModules) {
  const byId = new Map((studentModules || []).map((m) => [String(m.id), m]));
  const perLevel = levels.map((level) => {
    const m = byId.get(String(level.id));
    if (!m) return { done: 0, total: level.items.length, completed: false, fraction: 0, doneItemIds: [] };
    const req = requirementItems(m);
    const doneItems = req.filter((i) => i.completion_requirement.completed);
    const completed = m.state === 'completed' || (req.length > 0 && doneItems.length === req.length);
    const fraction = completed ? 1 : req.length ? doneItems.length / req.length : 0;
    return { done: completed ? req.length : doneItems.length, total: req.length, completed, fraction, doneItemIds: doneItems.map((i) => i.id) };
  });
  let level = perLevel.findIndex((p) => !p.completed);
  const finished = level === -1;
  if (finished) level = levels.length;
  const levelProgress = finished ? 0 : perLevel[level].fraction;
  return {
    perLevel,
    level,
    levelProgress,
    finished,
    position: level + levelProgress,
    score: perLevel.reduce((s, p) => s + p.fraction, 0),
    done: perLevel.reduce((s, p) => s + p.done, 0),
    total: perLevel.reduce((s, p) => s + p.total, 0),
  };
}

// Competition ranking (1, 2, 2, 4) by track position, then total work done.
function rankStudents(students) {
  const sorted = students.slice().sort((a, b) => b.position - a.position || b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.position !== s.position || prev.score !== s.score) rank = i + 1;
    s.rank = rank;
  });
  return sorted;
}

function formatName(user, format = 'first-last-initial') {
  const full = (user.name || user.short_name || 'Student').trim();
  let first, last;
  if (user.sortable_name && user.sortable_name.includes(',')) {
    const [l, f] = user.sortable_name.split(',').map((s) => s.trim());
    first = f || full;
    last = l;
  } else {
    const parts = full.split(/\s+/);
    first = parts[0];
    last = parts.length > 1 ? parts[parts.length - 1] : '';
  }
  const given = first.split(/\s+/)[0];
  switch (format) {
    case 'full': return full;
    case 'display': return (user.short_name || full).trim();
    case 'first': return given;
    case 'initials': return [given, last].filter(Boolean).map((s) => s[0].toUpperCase() + '.').join('');
    default: return last ? `${given} ${last[0].toUpperCase()}.` : given;
  }
}

function hashInt(str) {
  return crypto.createHash('sha256').update(str).digest().readUInt32BE(0);
}

// Stable, mostly-unique character per student: config overrides first, then
// each student (oldest Canvas id first) takes the next free slot from a hash.
function assignCharacters(studentIds, overrides = {}) {
  const out = new Map();
  const used = new Set();
  for (const id of studentIds) {
    const forced = parseCharacterSpec(overrides[id]);
    if (forced != null) { out.set(String(id), forced); used.add(forced); }
  }
  const rest = studentIds.filter((id) => !out.has(String(id))).sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
  for (const id of rest) {
    let slot = hashInt(`character:${id}`) % CHARACTER_COUNT;
    for (let tries = 0; used.has(slot) && tries < CHARACTER_COUNT; tries++) slot = (slot + 1) % CHARACTER_COUNT;
    used.add(slot);
    out.set(String(id), slot);
  }
  return out;
}

// Opaque id sent to browsers instead of the Canvas user id.
function publicId(courseId, userId) {
  return 's' + crypto.createHash('sha256').update(`${courseId}:${userId}`).digest('hex').slice(0, 12);
}

function buildSnapshot({ courseId, course, levels, users, modulesByUser, config = {} }) {
  const characters = assignCharacters(users.map((u) => u.id), config.characters || {});
  const students = users.map((u) => {
    const p = studentProgress(levels, modulesByUser.get(String(u.id)));
    return {
      id: publicId(courseId, u.id),
      name: formatName(u, config.nameFormat),
      character: characters.get(String(u.id)),
      level: p.level,
      levelProgress: p.levelProgress,
      position: p.position,
      score: p.score,
      done: p.done,
      total: p.total,
      finished: p.finished,
      levels: p.perLevel.map((x) => ({ done: x.done, total: x.total, completed: x.completed, doneItemIds: x.doneItemIds })),
    };
  });
  return {
    course: { name: config.title || (course && course.name) || 'Class Quest' },
    levels: levels.map((l, i) => ({ id: l.id, number: i + 1, name: l.name, theme: l.theme, items: l.items })),
    students: rankStudents(students),
  };
}

// Compare two snapshots and describe what changed for each student.
function diffSnapshots(prev, next, nextId, now = Date.now()) {
  if (!prev) return [];
  const before = new Map(prev.students.map((s) => [s.id, s]));
  const itemTitle = new Map();
  for (const l of next.levels) for (const i of l.items) itemTitle.set(String(i.id), i.title);
  const events = [];
  const push = (e) => events.push({ id: nextId(), ts: now, ...e });
  for (const s of next.students) {
    const old = before.get(s.id);
    if (!old) continue;
    const oldDone = new Set(old.levels.flatMap((l) => l.doneItemIds.map(String)));
    for (const l of s.levels) {
      for (const itemId of l.doneItemIds) {
        if (!oldDone.has(String(itemId))) {
          push({ type: 'item', studentId: s.id, name: s.name, text: `${s.name} cleared “${itemTitle.get(String(itemId)) || 'a challenge'}”` });
        }
      }
    }
    if (s.finished && !old.finished) {
      push({ type: 'finish', studentId: s.id, name: s.name, text: `${s.name} finished the whole quest!` });
    } else if (s.level > old.level) {
      const lvl = next.levels[s.level];
      push({ type: 'level', studentId: s.id, name: s.name, level: s.level + 1, text: `${s.name} reached Level ${s.level + 1}${lvl ? `: ${lvl.name}` : ''}` });
    }
    if (s.rank === 1 && old.rank !== 1 && next.students.filter((x) => x.rank === 1).length === 1) {
      push({ type: 'lead', studentId: s.id, name: s.name, text: `${s.name} takes the lead!` });
    }
  }
  return events;
}

module.exports = { buildLevels, studentProgress, rankStudents, formatName, assignCharacters, publicId, buildSnapshot, diffSnapshots };
