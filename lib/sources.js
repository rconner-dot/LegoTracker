// Where progress data comes from: a live Canvas course, or a built-in demo
// class that keeps making progress so you can see the animations.
'use strict';

const { CanvasClient, mapLimit } = require('./canvas');
const { buildLevels } = require('./progress');

class CanvasSource {
  constructor(config, client) {
    this.config = config;
    this.client = client || new CanvasClient({ baseUrl: config.canvasUrl, token: config.token });
  }

  async load() {
    const { courseId } = this.config;
    const [course, courseModules, users] = await Promise.all([
      this.client.getCourse(courseId),
      this.client.listModules(courseId),
      this.client.listStudents(courseId),
    ]);
    const levels = buildLevels(courseModules, this.config);
    const modulesByUser = new Map();
    await mapLimit(users, this.config.concurrency || 4, async (u) => {
      modulesByUser.set(String(u.id), await this.client.listModules(courseId, u.id));
    });
    return { courseId, course, levels, users, modulesByUser };
  }
}

const FIRST = ['Ava', 'Ben', 'Chloe', 'Diego', 'Emma', 'Finn', 'Grace', 'Hiro', 'Isla', 'Jamal', 'Kira', 'Leo', 'Maya', 'Noah',
  'Olive', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Vince', 'Wren', 'Xavi', 'Yara', 'Zane'];
const LAST = ['Adams', 'Brooks', 'Chen', 'Diaz', 'Evans', 'Foster', 'Garcia', 'Hughes', 'Ito', 'Jones', 'Khan', 'Lopez', 'Moore',
  'Nguyen', 'Ortiz', 'Patel', 'Quint', 'Reyes', 'Silva', 'Tran', 'Ueda', 'Vega', 'Walsh', 'Xu', 'Young', 'Zhou'];
const MODULES = [
  ['Getting Started', ['Syllabus Quiz', 'Intro Survey', 'Hello World']],
  ['Variables & Types', ['Reading: Variables', 'Practice Set 1', 'Quiz: Types', 'Lab: Calculator']],
  ['Conditionals', ['Video: If/Else', 'Practice Set 2', 'Lab: Grade Checker']],
  ['Loops', ['Reading: Loops', 'Practice Set 3', 'Quiz: Loops', 'Lab: Number Guess', 'Discussion']],
  ['Functions', ['Video: Functions', 'Practice Set 4', 'Lab: Toolkit']],
  ['Lists & Data', ['Reading: Lists', 'Practice Set 5', 'Quiz: Lists', 'Lab: Gradebook']],
  ['Debugging', ['Bug Hunt 1', 'Bug Hunt 2', 'Reflection']],
  ['Final Project', ['Proposal', 'Checkpoint', 'Showcase', 'Peer Review']],
];

class DemoSource {
  constructor({ students = 22, seed = 42 } = {}) {
    let t = seed;
    this.random = () => ((t = (t * 1103515245 + 12345) % 2147483648) / 2147483648);
    let itemId = 1000;
    this.modules = MODULES.map(([name, items], i) => ({
      id: 100 + i, name, position: i + 1, published: true,
      items: items.map((title) => ({ id: itemId++, title, type: 'Assignment', published: true, completion_requirement: { type: 'must_submit' } })),
    }));
    this.totalItems = this.modules.reduce((n, m) => n + m.items.length, 0);
    this.users = Array.from({ length: students }, (_, i) => ({
      id: 5000 + i,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      sortable_name: `${LAST[(i * 7) % LAST.length]}, ${FIRST[i % FIRST.length]}`,
    }));
    this.progress = new Map(this.users.map((u) => [u.id, Math.floor(this.totalItems * (0.05 + 0.6 * this.random() ** 1.2))]));
    this.loads = 0;
  }

  advance() {
    const moves = 1 + Math.floor(this.random() * 2);
    for (let i = 0; i < moves; i++) {
      const u = this.users[Math.floor(this.random() * this.users.length)];
      this.progress.set(u.id, Math.min(this.totalItems, this.progress.get(u.id) + 1));
    }
  }

  modulesFor(done) {
    let seen = 0;
    return this.modules.map((m) => {
      const items = m.items.map((it) => ({ ...it, completion_requirement: { ...it.completion_requirement, completed: seen++ < done } }));
      const state = items.every((i) => i.completion_requirement.completed) ? 'completed' : 'started';
      return { ...m, state, items };
    });
  }

  async load() {
    if (this.loads++ > 0) this.advance();
    const modulesByUser = new Map(this.users.map((u) => [String(u.id), this.modulesFor(this.progress.get(u.id))]));
    return { courseId: 'demo', course: { name: 'Intro to Programming (Demo)' }, levels: buildLevels(this.modules), users: this.users, modulesByUser };
  }
}

module.exports = { CanvasSource, DemoSource };
