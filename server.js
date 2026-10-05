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
const { loadConfig } = require('./lib/config');
const { CanvasSource, DemoSource } = require('./lib/sources');
const { Tracker } = require('./lib/tracker');
const { SettingsStore } = require('./lib/settings');
const { AdminAuth, sameOrigin, progressCsv } = require('./lib/admin');

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

function createServer({ tracker, auth }) {
  async function handleAdmin(req, res, url) {
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

      if (url.pathname === '/api/state') return sendJson(res, 200, tracker.getState(url.searchParams.get('view')));
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

async function main() {
  const config = loadConfig();
  const settings = new SettingsStore({ dir: config.dataDir, file: config.demo ? 'settings.demo.json' : 'settings.json', config });
  const source = config.demo ? new DemoSource() : new CanvasSource(config);
  const tracker = new Tracker({ source, settings, mode: config.demo ? 'demo' : 'live' });

  let pin = config.adminPin;
  if (!pin && config.host !== '127.0.0.1' && config.host !== 'localhost') {
    pin = String(crypto.randomInt(100000, 1000000));
    console.log(`Teacher PIN for this session: ${pin}  (set ADMIN_PIN to choose your own)`);
  }
  const auth = new AdminAuth({ pin });

  if (config.demo) {
    console.log(`Running in DEMO mode${config.demoReason ? ` (${config.demoReason})` : ''}. See README.md to connect Canvas.`);
  } else {
    console.log(`Reading course ${config.courseId} from ${config.canvasUrl} every ${config.refreshSeconds}s`);
  }
  tracker.start(config.demo ? 3000 : config.refreshSeconds * 1000);

  const server = createServer({ tracker, auth });
  server.listen(config.port, config.host, () => {
    console.log(`Class Quest is running at http://localhost:${config.port}`);
    console.log(`Teacher controls:         http://localhost:${config.port}/admin`);
    if (config.host === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  on your network: http://${ip}:${config.port}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { createServer };
