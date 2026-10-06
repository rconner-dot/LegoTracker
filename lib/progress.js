// Turns Canvas data into game state: levels, per-student position, pace,
// badges, rankings, character assignments, and "X cleared Y" events.
'use strict';

const crypto = require('crypto');
const { CHARACTER_COUNT, parseCharacterSpec } = require('../public/sprites.js');

const DAY = 24 * 60 * 60 * 1000;

// Badges only ever celebrate; nothing here marks a student as late or behind.
// Order here is the order they're shown. Teachers can switch any of them off.
const BADGES = {
  firststeps: { label: 'First Steps', desc: 'Cleared your first challenge', group: 'Progress' },
  explorer: { label: 'Explorer', desc: 'Cleared 3 levels', group: 'Progress' },
  halfway: { label: 'Halfway Hero', desc: 'Completed half of all the challenges', group: 'Progress' },
  champion: { label: 'Champion', desc: 'Finished the whole quest', group: 'Progress' },
  trailblazer: { label: 'Trailblazer', desc: 'First in the class to clear a level', group: 'Progress' },
  pacesetter: { label: 'Pace Setter', desc: 'At least 3 challenges ahead of the due dates', group: 'Progress' },
  onfire: { label: 'On Fire', desc: 'Turned in work on 3 different days this week', group: 'Habits' },
  marathon: { label: 'Marathon', desc: 'Turned in work on 10 different days', group: 'Habits' },
  speedrunner: { label: 'Speedrunner', desc: 'Turned in 3 assignments in one day', group: 'Habits' },
  comeback: { label: 'Comeback', desc: 'Got back into the quest after a week away', group: 'Habits' },
  early: { label: 'Early Bird', desc: 'Turned in 3 assignments at least a day early', group: 'Quality' },
  clockwork: { label: 'Clockwork', desc: 'Turned in 5 assignments, all on time', group: 'Quality' },
  perfect: { label: 'Perfectionist', desc: 'Earned full points on 3 assignments', group: 'Quality' },
};
const BADGE_KEYS = Object.keys(BADGES);

function badgeCatalog(disabled = []) {
  const off = new Set(disabled);
  return BADGE_KEYS.filter((k) => !off.has(k)).map((key) => ({ key, ...BADGES[key] }));
}

function requirementItems(module) {
  return (module.items || []).filter((i) => i.completion_requirement && i.published !== false);
}

// Levels are the course's published modules that have at least one completion
// requirement (an info-only module would otherwise be a free level).
function buildLevels(courseModules, { moduleIds, exclude, themes } = {}) {
  let mods = courseModules.filter((m) => m.published !== false);
  if (moduleIds && moduleIds.length) {
    const order = new Map(moduleIds.map((id, i) => [String(id), i]));
    mods = mods.filter((m) => order.has(String(m.id))).sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  } else {
    mods = mods.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  const skip = new Set((exclude || []).map(String));
  return mods
    .filter((m) => !skip.has(String(m.id)))
    .map((m) => ({
      id: m.id,
      name: m.name,
      theme: (themes && themes[m.id]) || null,
      items: requirementItems(m).map((i) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        dueAt: (i.content_details && i.content_details.due_at) || null,
      })),
    }))
    .filter((l) => l.items.length > 0);
}

function studentProgress(levels, studentModules) {
  const byId = new Map((studentModules || []).map((m) => [String(m.id), m]));
  const perLevel = levels.map((level) => {
    const m = byId.get(String(level.id));
    if (!m) return { done: 0, total: level.items.length, completed: false, fraction: 0, doneItemIds: [], completedAt: null };
    const req = requirementItems(m);
    const doneItems = req.filter((i) => i.completion_requirement.completed);
    const completed = m.state === 'completed' || (req.length > 0 && doneItems.length === req.length);
    const fraction = completed ? 1 : req.length ? doneItems.length / req.length : 0;
    return {
      done: completed ? req.length : doneItems.length,
      total: req.length,
      completed,
      fraction,
      doneItemIds: doneItems.map((i) => i.id),
      completedAt: completed && m.completed_at ? m.completed_at : null,
    };
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

// Where the class "should" be: just past the last item (in course order) whose
// due date has passed. Returns null when nothing has a due date.
function computePace(levels, now = Date.now()) {
  const flat = [];
  levels.forEach((l, li) => l.items.forEach((it, j) => flat.push({ li, j, k: l.items.length, item: it, due: it.dueAt ? Date.parse(it.dueAt) : NaN })));
  if (!flat.some((f) => !Number.isNaN(f.due))) return null;
  let last = -1;
  flat.forEach((f, i) => { if (!Number.isNaN(f.due) && f.due <= now) last = i; });
  const next = flat.slice(last + 1).find((f) => !Number.isNaN(f.due));
  const f = flat[last];
  return {
    position: f ? f.li + (f.j + 1) / f.k : 0,
    itemsDue: last + 1,
    nextDue: next ? { title: next.item.title, dueAt: next.item.dueAt, level: next.li + 1 } : null,
  };
}

// `points` maps assignment id → points possible (for the Perfectionist badge).
function submissionStats(subs, now = Date.now(), points = new Map()) {
  const submitted = subs.filter((s) => s.submitted_at && s.workflow_state !== 'unsubmitted');
  const recentDays = new Set();
  const perDay = new Map();
  const times = [];
  let early = 0, late = 0, perfect = 0;
  for (const s of submitted) {
    const t = Date.parse(s.submitted_at);
    const day = new Date(t).toDateString();
    times.push(t);
    perDay.set(day, (perDay.get(day) || 0) + 1);
    if (now - t <= 7 * DAY) recentDays.add(day);
    if (s.cached_due_date && Date.parse(s.cached_due_date) - t >= DAY) early++;
    if (s.late) late++;
    const possible = points.get(String(s.assignment_id));
    if (possible > 0 && s.score != null && Number(s.score) >= possible) perfect++;
  }
  times.sort((a, b) => a - b);
  let comeback = false;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] >= 7 * DAY) comeback = true;
  return {
    submitted: submitted.length,
    activeDays7: recentDays.size,
    activeDays: perDay.size,
    bestDay: Math.max(0, ...perDay.values()),
    comeback,
    early,
    late,
    perfect,
    missing: subs.filter((s) => s.missing).length,
    lastSubmittedAt: times.length ? new Date(times[times.length - 1]).toISOString() : null,
  };
}

function badgesFor({ finished, trailblazes = 0, stats, done = 0, total = 0, levelsCleared = 0, aheadOfPace = null }, disabled = []) {
  const out = [];
  const add = (key, count) => out.push(count > 1 ? { key, count } : { key });
  if (done >= 1) add('firststeps');
  if (levelsCleared >= 3) add('explorer', levelsCleared);
  if (total > 0 && done / total >= 0.5) add('halfway');
  if (finished) add('champion');
  if (trailblazes > 0) add('trailblazer', trailblazes);
  if (aheadOfPace != null && aheadOfPace >= 3) add('pacesetter');
  if (stats) {
    if (stats.activeDays7 >= 3) add('onfire');
    if (stats.activeDays >= 10) add('marathon');
    if (stats.bestDay >= 3) add('speedrunner');
    if (stats.comeback) add('comeback');
    if (stats.early >= 3) add('early', stats.early);
    if (stats.submitted >= 5 && stats.late === 0) add('clockwork');
    if (stats.perfect >= 3) add('perfect', stats.perfect);
  }
  const off = new Set(disabled);
  return out.filter((b) => !off.has(b.key)).map((b) => ({ ...b, ...BADGES[b.key] }));
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

// Stable, mostly-unique character per student: picks first, then each
// student (oldest Canvas id first) takes the next free slot from a hash.
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

function sectionIdsOf(user) {
  return [...new Set((user.enrollments || []).map((e) => e.course_section_id).filter((x) => x != null).map(String))];
}

// Full snapshot of every student. Contains Canvas ids and teacher-only stats;
// use publicView() before sending anything to a display.
function buildSnapshot({ courseId, course, courseModules, users, modulesByUser, submissions, sections }, settings = {}, now = Date.now()) {
  const levels = buildLevels(courseModules || [], settings.levels || {});
  const pace = computePace(levels, now);
  const points = new Map();
  for (const m of courseModules || []) {
    for (const i of m.items || []) {
      const pp = i.content_details && i.content_details.points_possible;
      if (i.type === 'Assignment' && i.content_id != null && pp > 0) points.set(String(i.content_id), Number(pp));
    }
  }
  const characters = assignCharacters(users.map((u) => u.id), settings.characters || {});
  const nicknames = settings.nicknames || {};
  const subsByUser = new Map();
  for (const s of submissions || []) {
    const k = String(s.user_id);
    if (!subsByUser.has(k)) subsByUser.set(k, []);
    subsByUser.get(k).push(s);
  }

  const students = users.map((u) => {
    const p = studentProgress(levels, modulesByUser.get(String(u.id)));
    return {
      userId: String(u.id),
      sections: sectionIdsOf(u),
      realName: u.name || '',
      sortableName: u.sortable_name || u.name || '',
      id: publicId(courseId, u.id),
      autoName: formatName(u, settings.nameFormat),
      name: (nicknames[u.id] && String(nicknames[u.id]).trim()) || formatName(u, settings.nameFormat),
      character: characters.get(String(u.id)),
      level: p.level,
      levelProgress: p.levelProgress,
      position: p.position,
      score: p.score,
      done: p.done,
      total: p.total,
      finished: p.finished,
      stats: submissions ? submissionStats(subsByUser.get(String(u.id)) || [], now, points) : null,
      levelsCleared: p.perLevel.filter((x) => x.completed).length,
      levels: p.perLevel.map((x) => ({ done: x.done, total: x.total, completed: x.completed, doneItemIds: x.doneItemIds, completedAt: x.completedAt })),
    };
  });

  // Trailblazer: earliest completion of each level across the whole course.
  const trail = new Map();
  levels.forEach((_, i) => {
    let best = null;
    for (const s of students) {
      const at = s.levels[i].completedAt && Date.parse(s.levels[i].completedAt);
      if (at && (!best || at < best.at)) best = { at, id: s.id };
    }
    if (best) trail.set(best.id, (trail.get(best.id) || 0) + 1);
  });
  const disabled = settings.disabledBadges || [];
  for (const s of students) {
    s.badges = badgesFor({
      finished: s.finished, trailblazes: trail.get(s.id) || 0, stats: s.stats, done: s.done, total: s.total,
      levelsCleared: s.levelsCleared, aheadOfPace: pace ? s.done - pace.itemsDue : null,
    }, disabled);
  }

  return {
    course: { name: settings.title || (course && course.name) || 'Class Quest' },
    levels: levels.map((l, i) => ({ id: l.id, number: i + 1, name: l.name, theme: l.theme, items: l.items })),
    pace,
    badges: badgeCatalog(disabled),
    sections: (sections || []).map((s) => ({ id: String(s.id), name: s.name })),
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
    const had = new Set((old.badges || []).map((b) => b.key));
    for (const b of s.badges || []) {
      if (!had.has(b.key) && b.key !== 'champion') push({ type: 'badge', studentId: s.id, name: s.name, badge: b.key, text: `${s.name} earned the ${b.label} badge!` });
    }
  }
  return events;
}

module.exports = {
  BADGES, BADGE_KEYS, badgeCatalog, buildLevels, studentProgress, computePace, submissionStats, badgesFor, rankStudents, formatName,
  assignCharacters, publicId, buildSnapshot, diffSnapshots, requirementItems,
};
