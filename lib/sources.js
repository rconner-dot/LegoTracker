// Where progress data comes from: a live Canvas course, or a built-in demo
// class that keeps making progress so you can see the animations.
'use strict';

const { CanvasClient, mapLimit } = require('./canvas');

class CanvasSource {
  constructor(config, client) {
    this.config = config;
    this.client = client || new CanvasClient({ baseUrl: config.canvasUrl, token: config.token });
    this.warned = false;
  }

  async load() {
    const { courseId } = this.config;
    const [course, courseModules, users, sections, submissions] = await Promise.all([
      this.client.getCourse(courseId),
      this.client.listModules(courseId),
      this.client.listStudents(courseId),
      this.optional('sections', () => this.client.listSections(courseId)),
      this.optional('submissions', () => this.client.listSubmissions(courseId)),
    ]);
    const modulesByUser = new Map();
    await mapLimit(users, this.config.concurrency || 4, async (u) => {
      modulesByUser.set(String(u.id), await this.client.listModules(courseId, u.id));
    });
    return { courseId, course, courseModules, users, sections, submissions, modulesByUser };
  }

  // Sections and submissions make things nicer but aren't essential.
  async optional(what, fn) {
    try {
      return await fn();
    } catch (err) {
      if (!this.warned) console.warn(`[canvas] could not load ${what} (${err.message}); continuing without them`);
      this.warned = true;
      return what === 'sections' ? [] : null;
    }
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
const SECTIONS = [{ id: 1, name: 'Period 1' }, { id: 3, name: 'Period 3' }, { id: 5, name: 'Period 5' }];
const DAY = 24 * 60 * 60 * 1000;

class DemoSource {
  constructor({ students = 22, seed = 42, now = Date.now } = {}) {
    let t = seed;
    this.random = () => ((t = (t * 1103515245 + 12345) % 2147483648) / 2147483648);
    this.now = now;
    const start = now();
    let itemId = 1000;
    const total = MODULES.reduce((n, [, items]) => n + items.length, 0);
    let index = 0;
    // Spread due dates so roughly 40% of the work is already due.
    this.modules = MODULES.map(([name, items], i) => ({
      id: 100 + i, name, position: i + 2, published: true,
      items: items.map((title) => ({
        id: itemId, content_id: itemId++, title, type: 'Assignment', published: true,
        completion_requirement: { type: 'must_submit' },
        content_details: { points_possible: 10, due_at: new Date(start + (index++ - total * 0.4) * 1.5 * DAY).toISOString() },
      })),
    }));
    this.modules.unshift({ id: 99, name: 'Course Info', position: 1, published: true, items: [{ id: 999, title: 'Welcome', type: 'Page', page_url: 'welcome', published: true }] });
    this.items = this.modules.flatMap((m) => m.items.filter((i) => i.completion_requirement));
    this.users = Array.from({ length: students }, (_, i) => ({
      id: 5000 + i,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      sortable_name: `${LAST[(i * 7) % LAST.length]}, ${FIRST[i % FIRST.length]}`,
      enrollments: [{ course_section_id: SECTIONS[i % SECTIONS.length].id }],
    }));
    // submittedAt[userId][itemIndex] = ms timestamp
    this.submittedAt = new Map(this.users.map((u) => {
      const n = Math.floor(this.items.length * (0.05 + 0.6 * this.random() ** 1.2));
      const times = this.items.slice(0, n).map((it) => {
        const due = Date.parse(it.content_details.due_at);
        return Math.min(start - 60 * 60 * 1000, due - (this.random() * 3 - 0.6) * DAY);
      });
      return [u.id, times];
    }));
    this.loads = 0;
  }

  advance() {
    const moves = 1 + Math.floor(this.random() * 2);
    for (let i = 0; i < moves; i++) {
      const u = this.users[Math.floor(this.random() * this.users.length)];
      const times = this.submittedAt.get(u.id);
      if (times.length < this.items.length) times.push(this.now());
    }
  }

  modulesFor(times) {
    let seen = 0;
    return this.modules.map((m) => {
      let lastAt = 0;
      const items = m.items.map((it) => {
        if (!it.completion_requirement) return it;
        const at = times[seen++];
        if (at) lastAt = Math.max(lastAt, at);
        return { ...it, completion_requirement: { ...it.completion_requirement, completed: at != null } };
      });
      const req = items.filter((i) => i.completion_requirement);
      const done = req.length > 0 && req.every((i) => i.completion_requirement.completed);
      return { ...m, state: done ? 'completed' : 'started', completed_at: done ? new Date(lastAt).toISOString() : null, items };
    });
  }

  submissionsFor(user) {
    const times = this.submittedAt.get(user.id);
    const now = this.now();
    return this.items.map((it, i) => {
      const due = it.content_details.due_at;
      const at = times[i];
      return {
        user_id: user.id,
        assignment_id: it.id,
        cached_due_date: due,
        submitted_at: at ? new Date(at).toISOString() : null,
        workflow_state: at ? 'graded' : 'unsubmitted',
        score: at ? 7 + ((user.id * 7 + i * 3) % 4) : null,
        late: at ? at > Date.parse(due) : false,
        missing: !at && Date.parse(due) < now,
      };
    });
  }

  async load() {
    if (this.loads++ > 0) this.advance();
    return {
      courseId: 'demo',
      course: { name: 'Intro to Programming (Demo)' },
      courseModules: this.modules,
      users: this.users,
      sections: SECTIONS,
      submissions: this.users.flatMap((u) => this.submissionsFor(u)),
      modulesByUser: new Map(this.users.map((u) => [String(u.id), this.modulesFor(this.submittedAt.get(u.id))])),
    };
  }
}

module.exports = { CanvasSource, DemoSource };
