#!/usr/bin/env node
// Class Quest: a local web server that reads module progress from Canvas and
// serves an 8-bit race view of the class. The Canvas token never leaves this
// process; displays only see names, characters and progress.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { loadConfig } = require('./lib/config');
const { Runtime } = require('./lib/runtime');
const { AdminAuth, sameOrigin, progressCsv } = require('./lib/admin');
const { toMarkdown } = require('./lib/instructions');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 512 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type, headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}
const sendJson = (res, status, obj, headers) => send(res, status, JSON.stringify(obj), 'application/json', headers);

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('Expected JSON'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Bad JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, rel) {
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

// `runtime` is used by the real app (it can switch courses); tests may pass a
// bare `tracker` instead.
function createServer({ runtime, tracker: fixedTracker, auth }) {
  const current = () => (runtime ? runtime.tracker : fixedTracker);

  async function handleCanvas(req, res, url) {
    if (!runtime) return sendJson(res, 501, { error: 'Not available' });
    if (url.pathname === '/api/admin/canvas' && req.method === 'GET') return sendJson(res, 200, runtime.status());
    if (url.pathname === '/api/admin/canvas/instructions' && req.method === 'GET') {
      const data = await runtime.instructions();
      const json = url.searchParams.get('format') === 'json';
      const stamp = new Date().toISOString().slice(0, 10);
      return send(res, 200, json ? JSON.stringify(data, null, 2) : toMarkdown(data), json ? 'application/json' : 'text/markdown; charset=utf-8', {
        'Content-Disposition': `attachment; filename="instructions-${stamp}.${json ? 'json' : 'md'}"`,
      });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const body = await readJson(req);
    if (url.pathname === '/api/admin/canvas/courses') return sendJson(res, 200, await runtime.listCourses(body));
    if (url.pathname === '/api/admin/canvas/connect') return sendJson(res, 200, await runtime.connect(body));
    if (url.pathname === '/api/admin/canvas/disconnect') return sendJson(res, 200, await runtime.disconnect());
    return sendJson(res, 404, { error: 'Not found' });
  }

  async function handleAdmin(req, res, url) {
    const tracker = current();
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await readJson(req);
      const cookie = auth.login(String(body.pin || ''), req.socket.encrypted);
      if (!cookie) return sendJson(res, 401, { error: 'That PIN didn’t work.' });
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.logout(req) });
    }

    const status = auth.status(req);
    if (status === 'blocked') {
      return sendJson(res, 403, { error: 'Teacher controls are only available on the computer running Class Quest. Set ADMIN_PIN to use them from another device.', auth: 'blocked' });
    }
    if (status !== 'ok') return sendJson(res, 401, { error: 'PIN required', auth: 'login' });

    if (url.pathname === '/api/admin/canvas' || url.pathname.startsWith('/api/admin/canvas/')) return handleCanvas(req, res, url);

    if (url.pathname === '/api/admin/data' && req.method === 'GET') return sendJson(res, 200, tracker.getAdminData());
    if (url.pathname === '/api/admin/settings' && req.method === 'PUT') {
      const body = await readJson(req);
      const saved = tracker.settings.replace(body);
      tracker.rebuild();
      return sendJson(res, 200, { settings: saved });
    }
    if (url.pathname === '/api/admin/refresh' && req.method === 'POST') {
      await tracker.refresh();
      return sendJson(res, 200, { ok: !tracker.error, error: tracker.error });
    }
    if (url.pathname === '/api/admin/export.csv' && req.method === 'GET') {
      const stamp = new Date().toISOString().slice(0, 10);
      return send(res, 200, progressCsv(tracker.getAdminData()), 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="class-quest-${stamp}.csv"`,
      });
    }
    return sendJson(res, 404, { error: 'Not found' });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating && !sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request refused' });

      if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, url);
      if (mutating) return send(res, 405, 'Method not allowed', 'text/plain');

      if (url.pathname === '/api/state') return sendJson(res, 200, current().getState(url.searchParams.get('view')));
      if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
      if (url.pathname === '/admin' || url.pathname === '/admin/') return serveStatic(res, 'admin.html');
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      return serveStatic(res, rel);
    } catch (err) {
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
      if (!err.status) console.error(err);
    }
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available; the address is printed anyway.
  }
}

async function main() {
  const config = loadConfig();
  const runtime = new Runtime(config);

  let pin = config.adminPin;
  if (!pin && config.host !== '127.0.0.1' && config.host !== 'localhost') {
    pin = String(crypto.randomInt(100000, 1000000));
    console.log(`Teacher PIN for this session: ${pin}  (set ADMIN_PIN to choose your own)`);
  }
  const auth = new AdminAuth({ pin });

  const base = `http://localhost:${config.port}`;
  const server = createServer({ runtime, auth });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Class Quest already seems to be running at ${base}`);
      if (config.open) openBrowser(base);
      setTimeout(() => process.exit(0), 500);
      return;
    }
    console.error(err.message);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log('');
    console.log('  Class Quest is running!');
    console.log(`  Class display:     ${base}`);
    console.log(`  Teacher controls:  ${base}/admin`);
    if (config.host === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  On your network:   http://${ip}:${config.port}`);
    console.log('');
    if (config.demo) {
      console.log(`  Showing a demo class (${config.demoReason || 'demo mode'}). Connect Canvas in Teacher controls.`);
    } else {
      console.log(`  Reading course ${config.courseId} from ${config.canvasUrl} every ${config.refreshSeconds}s.`);
    }
    console.log('  Keep this window open while you use Class Quest. Close it (or press Ctrl+C) to stop.');
    console.log('');
    runtime.start();
    if (config.open) openBrowser(config.demo && !process.argv.includes('--demo') ? `${base}/admin` : base);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { createServer };
