// Settings come from environment variables, the Canvas connection saved from
// teacher controls (data/connection.json), and config.json, in that order.
'use strict';

const fs = require('fs');
const path = require('path');

const NAME_FORMATS = ['first-last-initial', 'first', 'full', 'display', 'initials'];

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

// Accepts "school.instructure.com", "https://school.instructure.com/courses/123", etc.
// Returns { canvasUrl, courseId } or throws with a friendly message.
function parseCanvasAddress(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter your Canvas address, like https://yourschool.instructure.com');
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('That doesn’t look like a web address.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) throw new Error('The Canvas address must start with https://');
  const m = url.pathname.match(/\/courses\/(\d+)/);
  return { canvasUrl: url.origin, courseId: m ? m[1] : null };
}

function connectionFile(dataDir) {
  return path.join(dataDir, 'connection.json');
}

function saveConnection(dataDir, { canvasUrl, token, courseId, courseName }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = connectionFile(dataDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ canvasUrl, token, courseId: String(courseId), courseName: courseName || '' }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function clearConnection(dataDir) {
  fs.rmSync(connectionFile(dataDir), { force: true });
}

function loadConfig({ argv = process.argv.slice(2), env = process.env, file } = {}) {
  const cfgPath = file || env.QUEST_CONFIG || path.join(__dirname, '..', 'config.json');
  const fromFile = readJson(cfgPath);
  const dataDir = path.resolve(path.dirname(cfgPath), env.DATA_DIR || fromFile.dataDir || 'data');
  let fromUi = {};
  try {
    fromUi = readJson(connectionFile(dataDir));
  } catch (err) {
    console.error(`[config] ignoring saved Canvas connection: ${err.message}`);
  }
  const pick = (envKey, key, fallback) => env[envKey] || fromUi[key] || fromFile[key] || fallback;
  const sourceOf = (envKey, key) => (env[envKey] ? 'environment' : fromUi[key] ? 'teacher controls' : fromFile[key] ? 'config.json' : null);

  const cfg = {
    canvasUrl: String(pick('CANVAS_URL', 'canvasUrl', '')).replace(/\/+$/, ''),
    token: pick('CANVAS_TOKEN', 'token', ''),
    courseId: String(pick('CANVAS_COURSE_ID', 'courseId', '')),
    connectionSource: sourceOf('CANVAS_TOKEN', 'token'),
    port: Number(env.PORT || fromFile.port || 3000),
    host: argv.includes('--lan') ? '0.0.0.0' : env.HOST || fromFile.host || '127.0.0.1',
    open: argv.includes('--open'),
    refreshSeconds: Math.max(15, Number(env.REFRESH_SECONDS || fromFile.refreshSeconds || 60)),
    nameFormat: env.NAME_FORMAT || fromFile.nameFormat || 'first-last-initial',
    title: fromFile.title || null,
    moduleIds: Array.isArray(fromFile.moduleIds) ? fromFile.moduleIds : null,
    themes: fromFile.themes || {},
    characters: fromFile.characters || {},
    concurrency: Number(fromFile.concurrency) || 4,
    adminPin: String(env.ADMIN_PIN || fromFile.adminPin || ''),
    dataDir,
    demo: argv.includes('--demo') || env.DEMO === '1',
    demoReason: null,
  };

  if (!NAME_FORMATS.includes(cfg.nameFormat)) {
    throw new Error(`nameFormat must be one of: ${NAME_FORMATS.join(', ')}`);
  }
  if (cfg.canvasUrl && !/^https?:\/\//.test(cfg.canvasUrl)) cfg.canvasUrl = `https://${cfg.canvasUrl}`;
  if (!cfg.demo) {
    const missing = [!cfg.canvasUrl && 'CANVAS_URL', !cfg.token && 'CANVAS_TOKEN', !cfg.courseId && 'CANVAS_COURSE_ID'].filter(Boolean);
    if (missing.length) {
      cfg.demo = true;
      cfg.demoReason = 'not connected to Canvas yet';
    }
  }
  return cfg;
}

module.exports = { loadConfig, NAME_FORMATS, parseCanvasAddress, saveConnection, clearConnection };
