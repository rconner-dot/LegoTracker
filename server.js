#!/usr/bin/env node
// Class Quest: a local web server that reads module progress from Canvas and
// serves an 8-bit race view of the class. The Canvas token never leaves this
// process; browsers only see names, characters and progress.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { CanvasSource, DemoSource } = require('./lib/sources');
const { Tracker } = require('./lib/tracker');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function createServer(tracker) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

    if (url.pathname === '/api/state') return send(res, 200, JSON.stringify(tracker.getState()), 'application/json');
    if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
    });
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

async function main() {
  const config = loadConfig();
  const source = config.demo ? new DemoSource() : new CanvasSource(config);
  const tracker = new Tracker({ source, config, mode: config.demo ? 'demo' : 'live' });

  if (config.demo) {
    console.log(`Running in DEMO mode${config.demoReason ? ` (${config.demoReason})` : ''}. See README.md to connect Canvas.`);
  } else {
    console.log(`Reading course ${config.courseId} from ${config.canvasUrl} every ${config.refreshSeconds}s`);
  }
  tracker.start(config.demo ? 3000 : config.refreshSeconds * 1000);

  const server = createServer(tracker);
  server.listen(config.port, config.host, () => {
    console.log(`Class Quest is running at http://localhost:${config.port}`);
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
