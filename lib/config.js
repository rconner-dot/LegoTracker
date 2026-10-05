// Settings come from config.json (git-ignored) and/or environment variables.
// Environment variables win, so the token can stay out of files entirely.
'use strict';

const fs = require('fs');
const path = require('path');

const NAME_FORMATS = ['first-last-initial', 'first', 'full', 'display', 'initials'];

function loadConfig({ argv = process.argv.slice(2), env = process.env, file } = {}) {
  const cfgPath = file || env.QUEST_CONFIG || path.join(__dirname, '..', 'config.json');
  let fromFile = {};
  if (fs.existsSync(cfgPath)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      throw new Error(`Could not parse ${cfgPath}: ${err.message}`);
    }
  }
  const pick = (envKey, fileKey, fallback) => env[envKey] || fromFile[fileKey] || fallback;

  const cfg = {
    canvasUrl: String(pick('CANVAS_URL', 'canvasUrl', '')).replace(/\/+$/, ''),
    token: pick('CANVAS_TOKEN', 'token', ''),
    courseId: String(pick('CANVAS_COURSE_ID', 'courseId', '')),
    port: Number(pick('PORT', 'port', 3000)),
    host: argv.includes('--lan') ? '0.0.0.0' : pick('HOST', 'host', '127.0.0.1'),
    refreshSeconds: Math.max(15, Number(pick('REFRESH_SECONDS', 'refreshSeconds', 60))),
    nameFormat: pick('NAME_FORMAT', 'nameFormat', 'first-last-initial'),
    title: fromFile.title || null,
    moduleIds: Array.isArray(fromFile.moduleIds) ? fromFile.moduleIds : null,
    themes: fromFile.themes || {},
    characters: fromFile.characters || {},
    concurrency: Number(fromFile.concurrency) || 4,
    adminPin: String(pick('ADMIN_PIN', 'adminPin', '')),
    dataDir: path.resolve(path.dirname(cfgPath), pick('DATA_DIR', 'dataDir', 'data')),
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
      cfg.demoReason = `missing ${missing.join(', ')}`;
    }
  }
  return cfg;
}

module.exports = { loadConfig, NAME_FORMATS };
