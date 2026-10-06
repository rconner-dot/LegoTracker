// A tiny stand-in for the Canvas REST API, backed by the demo class. Used by
// tests to exercise the real HTTP client, pagination and the connect flow.
'use strict';

const http = require('http');
const { DemoSource } = require('../lib/sources');

const TOKEN = 'good-token';
const COURSE = { id: 777, name: 'Intro to Programming', course_code: 'CS1', term: { name: 'Fall 2026' } };

function startFakeCanvas({ students = 6 } = {}) {
  const demo = new DemoSource({ students });
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname);
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { errors: [{ message: 'Invalid access token.' }] });

    // Paginate any list with per_page/page and a Link header, like Canvas.
    const list = (items) => {
      const per = Number(url.searchParams.get('per_page') || 10);
      const page = Number(url.searchParams.get('page') || 1);
      const slice = items.slice((page - 1) * per, page * per);
      const headers = {};
      if (page * per < items.length) {
        const next = new URL(url);
        next.searchParams.set('page', String(page + 1));
        headers.Link = `<http://${req.headers.host}${next.pathname}${next.search}>; rel="next"`;
      }
      return json(200, slice, headers);
    };

    const p = url.pathname;
    if (p === '/api/v1/courses') {
      return list([
        { ...COURSE, enrollments: [{ type: 'teacher' }] },
        { id: 778, name: 'Study Hall', enrollments: [{ type: 'student' }] },
      ]);
    }
    if (p === '/api/v1/courses/777') {
      const withSyllabus = url.searchParams.getAll('include[]').includes('syllabus_body');
      return json(200, withSyllabus ? { ...COURSE, syllabus_body: '<p>Be kind &amp; build cool robots.</p>' } : COURSE);
    }
    if (p === '/api/v1/courses/777/assignments') {
      return list(demo.items.map((it, i) => ({
        id: it.content_id, name: it.title, points_possible: 10, due_at: it.content_details.due_at,
        html_url: `http://${req.headers.host}/courses/777/assignments/${it.content_id}`,
        submission_types: ['online_upload'], allowed_extensions: ['llsp3'], published: true,
        description: i === 0
          ? '<h2>Drive forward</h2><p>Make the robot drive <strong>10 rotations</strong> forward using motors A+B.</p><ul><li>Start with <em>when program starts</em></li><li>Stop at the end</li></ul><p>Starter: <a href="/courses/777/files/55/download">starter.llsp3</a></p>'
          : `<p>Instructions for ${it.title}</p>`,
        rubric: i === 0 ? [{ description: 'Uses motors A+B', long_description: 'Movement pair set to A+B', points: 5, ratings: [{ description: 'Yes', points: 5 }, { description: 'No', points: 0 }] }] : undefined,
      })));
    }
    if (p === '/api/v1/courses/777/quizzes') return json(404, { errors: [{ message: 'not found' }] });
    if (p === '/api/v1/courses/777/pages/welcome') return json(200, { title: 'Welcome', body: '<p>Welcome to robotics!</p>', html_url: 'x' });
    if (p === '/api/v1/courses/777/users') return list(demo.users);
    if (p === '/api/v1/courses/777/sections') return list([{ id: 1, name: 'Period 1' }, { id: 3, name: 'Period 3' }, { id: 5, name: 'Period 5' }]);
    if (p === '/api/v1/courses/777/students/submissions') return list(demo.users.flatMap((u) => demo.submissionsFor(u)));
    if (p === '/api/v1/courses/777/modules') {
      const sid = url.searchParams.get('student_id');
      if (!sid) return list(demo.modules);
      return list(demo.modulesFor(demo.submittedAt.get(Number(sid))));
    }
    return json(404, { errors: [{ message: 'not found' }] });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://localhost:${server.address().port}`, server, demo, requests, close: () => server.close() });
  }));
}

module.exports = { startFakeCanvas, TOKEN };
