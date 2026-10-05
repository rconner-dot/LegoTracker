// Owns the live tracker and lets teacher controls connect (or disconnect) a
// Canvas course without editing files or restarting.
'use strict';

const { CanvasClient } = require('./canvas');
const { CanvasSource, DemoSource } = require('./sources');
const { Tracker } = require('./tracker');
const { SettingsStore } = require('./settings');
const { parseCanvasAddress, saveConnection, clearConnection } = require('./config');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

class Runtime {
  constructor(config, { makeClient, persist = true } = {}) {
    this.config = config;
    this.makeClient = makeClient || ((opts) => new CanvasClient(opts));
    this.persist = persist;
    const demo = config.demo;
    this.tracker = new Tracker({
      source: demo ? new DemoSource() : new CanvasSource(config),
      settings: this.settingsFor(demo),
      mode: demo ? 'demo' : 'live',
    });
  }

  settingsFor(demo) {
    return new SettingsStore({ dir: this.persist ? this.config.dataDir : null, file: demo ? 'settings.demo.json' : 'settings.json', config: this.config });
  }

  intervalMs() {
    return this.config.demo ? 3000 : this.config.refreshSeconds * 1000;
  }

  start() {
    return this.tracker.start(this.intervalMs());
  }

  status() {
    const c = this.config;
    const snap = this.tracker.snapshot;
    return {
      connected: !c.demo,
      canvasUrl: c.canvasUrl || null,
      courseId: c.demo ? null : c.courseId,
      courseName: !c.demo && snap ? snap.course.name : null,
      source: c.demo ? null : c.connectionSource,
      locked: c.connectionSource === 'environment',
    };
  }

  // Only reuse the saved token for the same Canvas site it belongs to.
  tokenFor(canvasUrl, token) {
    if (token && String(token).trim()) return String(token).trim();
    if (this.config.token && this.config.canvasUrl === canvasUrl) return this.config.token;
    throw fail('Paste your Canvas access token.');
  }

  async canvasCall(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 401) throw fail('Canvas didn’t accept that token. Check you copied all of it, or make a new one.');
      if (err.status === 404) throw fail('Canvas couldn’t find that. Check the address and course.');
      throw fail(err.message || 'Could not reach Canvas.', 502);
    }
  }

  async listCourses({ canvasUrl, token }) {
    const parsed = parseCanvasAddress(canvasUrl);
    const client = this.makeClient({ baseUrl: parsed.canvasUrl, token: this.tokenFor(parsed.canvasUrl, token) });
    const courses = await this.canvasCall(() => client.listMyCourses());
    return { canvasUrl: parsed.canvasUrl, courseId: parsed.courseId, courses };
  }

  async connect({ canvasUrl, token, courseId }) {
    if (this.status().locked) throw fail('The Canvas connection is set by environment variables on this computer. Change it there.', 409);
    const parsed = parseCanvasAddress(canvasUrl);
    const id = String(courseId || parsed.courseId || '').trim();
    if (!/^\d+$/.test(id)) throw fail('Choose a course.');
    const tok = this.tokenFor(parsed.canvasUrl, token);
    const client = this.makeClient({ baseUrl: parsed.canvasUrl, token: tok });
    const course = await this.canvasCall(() => client.getCourse(id));

    if (this.persist) saveConnection(this.config.dataDir, { canvasUrl: parsed.canvasUrl, token: tok, courseId: id, courseName: course.name });
    Object.assign(this.config, { canvasUrl: parsed.canvasUrl, token: tok, courseId: id, demo: false, demoReason: null, connectionSource: 'teacher controls' });
    console.log(`Connected to “${course.name}” (course ${id}) on ${parsed.canvasUrl}`);
    await this.tracker.reconfigure({ source: new CanvasSource(this.config, client), settings: this.settingsFor(false), mode: 'live', intervalMs: this.intervalMs() });
    return this.status();
  }

  async disconnect() {
    if (this.status().locked) throw fail('The Canvas connection is set by environment variables on this computer. Change it there.', 409);
    if (this.persist) clearConnection(this.config.dataDir);
    Object.assign(this.config, { token: '', courseId: '', demo: true, demoReason: 'not connected to Canvas yet', connectionSource: null });
    console.log('Disconnected from Canvas; showing the demo class.');
    await this.tracker.reconfigure({ source: new DemoSource(), settings: this.settingsFor(true), mode: 'demo', intervalMs: this.intervalMs() });
    return this.status();
  }
}

module.exports = { Runtime };
