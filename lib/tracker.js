// Refresh loop: pulls from a source, builds the game snapshot, keeps a rolling
// log of events, and produces the per-screen state that displays poll.
// If a refresh fails, the last good state is kept.
'use strict';

const { buildSnapshot, diffSnapshots, rankStudents } = require('./progress');
const { findView, isMember } = require('./settings');

const MAX_EVENTS = 200;

class Tracker {
  constructor({ source, settings, mode, now = Date.now }) {
    this.source = source;
    this.settings = settings;
    this.mode = mode;
    this.now = now;
    this.raw = null;
    this.snapshot = null;
    this.events = [];
    this.eventSeq = 0;
    this.error = null;
    this.updatedAt = null;
    this.timer = null;
    this.running = null;
    this.bootId = now().toString(36);
    this.generation = 0;
    this.intervalMs = 60000;
  }

  // Switch data source (e.g. demo → a real Canvas course) without restarting.
  reconfigure({ source, settings, mode, intervalMs }) {
    this.stop();
    this.generation++;
    Object.assign(this, { source, settings, mode });
    this.raw = null;
    this.snapshot = null;
    this.events = [];
    this.error = null;
    this.updatedAt = null;
    this.running = null;
    this.bootId = `${this.now().toString(36)}-${this.generation}`;
    return this.start(intervalMs);
  }

  refresh() {
    if (!this.running) {
      const run = this.load().finally(() => { if (this.running === run) this.running = null; });
      this.running = run;
    }
    return this.running;
  }

  async load() {
    const generation = this.generation;
    try {
      const raw = await this.source.load();
      if (generation !== this.generation) return; // source changed while loading
      const next = buildSnapshot(raw, this.settings.get(), this.now());
      const fresh = diffSnapshots(this.snapshot, next, () => ++this.eventSeq, this.now());
      this.events.push(...fresh);
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
      this.raw = raw;
      this.snapshot = next;
      this.error = null;
      this.updatedAt = this.now();
    } catch (err) {
      if (generation !== this.generation) return;
      this.error = err.message || String(err);
      console.error(`[tracker] refresh failed: ${this.error}`);
    }
  }

  // Settings changed: rebuild from the data we already have, without
  // generating "cleared" events for things that only look new.
  rebuild() {
    if (this.raw) this.snapshot = buildSnapshot(this.raw, this.settings.get(), this.now());
  }

  start(intervalMs) {
    this.intervalMs = intervalMs;
    const generation = this.generation;
    const tick = async () => {
      await this.refresh();
      if (generation !== this.generation) return;
      this.timer = setTimeout(tick, intervalMs);
      if (this.timer.unref) this.timer.unref();
    };
    return tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  // What a display is allowed to see: only the screen's students, re-ranked
  // among themselves, with no Canvas ids, real names, or teacher stats.
  getState(viewId) {
    const settings = this.settings.get();
    const view = findView(settings, viewId);
    const snap = this.snapshot || { course: { name: 'Loading…' }, levels: [], students: [], pace: null };
    const members = snap.students.filter((s) => isMember(view, s));
    const visible = new Set(members.map((s) => s.id));
    const students = members.map((s) => ({
      id: s.id,
      name: s.name,
      character: s.character,
      level: s.level,
      levelProgress: s.levelProgress,
      position: s.position,
      score: s.score,
      done: s.done,
      total: s.total,
      finished: s.finished,
      badges: s.badges,
      ahead: snap.pace && !s.finished ? s.done - snap.pace.itemsDue : null,
      levels: s.levels.map((l) => ({ done: l.done, total: l.total, completed: l.completed, doneItemIds: l.doneItemIds })),
    }));
    let ordered;
    if (settings.showRanks) {
      ordered = rankStudents(students);
    } else {
      ordered = students.sort((a, b) => a.name.localeCompare(b.name));
      ordered.forEach((s) => { s.rank = null; });
    }
    for (const s of ordered) if (s.ahead != null && s.ahead <= 0) s.ahead = null;
    const done = students.reduce((n, s) => n + s.done, 0);
    return {
      mode: this.mode,
      bootId: this.bootId,
      updatedAt: this.updatedAt,
      error: this.error,
      pollSeconds: this.mode === 'demo' ? 3 : 15,
      course: snap.course,
      levels: snap.levels,
      pace: settings.showPace ? snap.pace : null,
      view: { id: view.id, name: view.name },
      views: settings.views.map((v) => ({ id: v.id, name: v.name })),
      display: {
        showRanks: settings.showRanks,
        showBoard: settings.showBoard,
        sound: settings.sound,
        spotlightSeconds: settings.spotlightSeconds,
        levelsBefore: settings.levelsBefore,
        levelsAfter: settings.levelsAfter,
      },
      goal: view.goal ? { ...view.goal, done: Math.min(done, view.goal.target) } : null,
      classDone: done,
      students: ordered,
      events: this.events.filter((e) => visible.has(e.studentId)).slice(-30),
    };
  }

  // Everything the teacher page needs, including private roster details.
  getAdminData() {
    const snap = this.snapshot;
    const raw = this.raw;
    const levelIds = new Set((snap ? snap.levels : []).map((l) => String(l.id)));
    return {
      mode: this.mode,
      updatedAt: this.updatedAt,
      error: this.error,
      settings: this.settings.get(),
      course: snap ? snap.course : null,
      pace: snap ? snap.pace : null,
      sections: snap ? snap.sections : [],
      levels: snap ? snap.levels.map((l) => ({ id: l.id, name: l.name, items: l.items.length })) : [],
      modules: raw
        ? raw.courseModules
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((m) => ({
            id: String(m.id),
            name: m.name,
            published: m.published !== false,
            requirements: (m.items || []).filter((i) => i.completion_requirement && i.published !== false).length,
            included: levelIds.has(String(m.id)),
          }))
        : [],
      students: snap
        ? snap.students
          .map((s) => ({
            userId: s.userId,
            id: s.id,
            realName: s.realName,
            sortableName: s.sortableName,
            name: s.name,
            autoName: s.autoName,
            sections: s.sections,
            character: s.character,
            level: s.level,
            finished: s.finished,
            done: s.done,
            total: s.total,
            position: s.position,
            vsPace: snap.pace ? s.done - snap.pace.itemsDue : null,
            stats: s.stats,
            badges: s.badges.map((b) => b.key),
          }))
          .sort((a, b) => a.sortableName.localeCompare(b.sortableName))
        : [],
    };
  }
}

module.exports = { Tracker };
