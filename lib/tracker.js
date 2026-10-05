// Refresh loop: pulls from a source, builds the game snapshot, and keeps a
// rolling log of events. If a refresh fails, the last good state is kept.
'use strict';

const { buildSnapshot, diffSnapshots } = require('./progress');

const MAX_EVENTS = 100;

class Tracker {
  constructor({ source, config, mode, now = Date.now }) {
    this.source = source;
    this.config = config;
    this.mode = mode;
    this.now = now;
    this.snapshot = null;
    this.events = [];
    this.eventSeq = 0;
    this.error = null;
    this.updatedAt = null;
    this.timer = null;
    this.running = null;
    this.bootId = now().toString(36);
  }

  refresh() {
    if (!this.running) {
      this.running = this.load().finally(() => { this.running = null; });
    }
    return this.running;
  }

  async load() {
    try {
      const raw = await this.source.load();
      const next = buildSnapshot({ ...raw, config: this.config });
      const fresh = diffSnapshots(this.snapshot, next, () => ++this.eventSeq, this.now());
      this.events.push(...fresh);
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
      this.snapshot = next;
      this.error = null;
      this.updatedAt = this.now();
    } catch (err) {
      this.error = err.message || String(err);
      console.error(`[tracker] refresh failed: ${this.error}`);
    }
  }

  start(intervalMs) {
    const tick = async () => {
      await this.refresh();
      this.timer = setTimeout(tick, intervalMs);
      if (this.timer.unref) this.timer.unref();
    };
    return tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  getState() {
    return {
      mode: this.mode,
      bootId: this.bootId,
      updatedAt: this.updatedAt,
      error: this.error,
      pollSeconds: this.mode === 'demo' ? 3 : 15,
      ...(this.snapshot || { course: { name: 'Loading…' }, levels: [], students: [] }),
      events: this.events.slice(-30),
    };
  }
}

module.exports = { Tracker };
