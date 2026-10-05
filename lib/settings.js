// Teacher settings, edited from /admin and saved to data/settings.json.
// config.json only provides the starting values.
'use strict';

const fs = require('fs');
const path = require('path');
const { NAME_FORMATS } = require('./config');
const { parseCharacterSpec } = require('../public/sprites.js');
const { THEMES } = require('../public/worlds.js');

const THEME_KEYS = THEMES.map((t) => t.key);
const VIEW_BASES = ['all', 'sections', 'none'];
const SPOTLIGHT_CHOICES = [0, 10, 20, 30, 60];

function defaults(config = {}) {
  return {
    title: config.title || '',
    nameFormat: config.nameFormat || 'first-last-initial',
    showRanks: true,
    showBoard: true,
    showPace: true,
    sound: false,
    spotlightSeconds: 0,
    nicknames: {},
    characters: { ...(config.characters || {}) },
    levels: { moduleIds: config.moduleIds || null, exclude: [], themes: { ...(config.themes || {}) } },
    views: [{ id: 'all', name: 'Whole class', base: 'all', sections: [], include: [], exclude: [], goal: null }],
    defaultView: 'all',
  };
}

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const idList = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 40)).filter(Boolean))] : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function cleanMap(v, fn) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    const key = str(k, 40);
    const cleaned = fn(val);
    if (key && cleaned != null && cleaned !== '') out[key] = cleaned;
  }
  return out;
}

function cleanView(v, i) {
  if (!isObj(v)) return null;
  const id = str(v.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '-') || `screen-${i + 1}`;
  let goal = null;
  if (isObj(v.goal) && Number(v.goal.target) > 0) {
    goal = { target: Math.min(100000, Math.round(Number(v.goal.target))), reward: str(v.goal.reward, 120) };
  }
  return {
    id,
    name: str(v.name, 60) || 'Untitled screen',
    base: VIEW_BASES.includes(v.base) ? v.base : 'all',
    sections: idList(v.sections),
    include: idList(v.include),
    exclude: idList(v.exclude),
    goal,
  };
}

// Validate and normalise a settings object from the admin page.
function sanitize(input, config) {
  const d = defaults(config);
  if (!isObj(input)) return d;
  const s = { ...d };
  if ('title' in input) s.title = str(input.title, 80);
  if (NAME_FORMATS.includes(input.nameFormat)) s.nameFormat = input.nameFormat;
  for (const k of ['showRanks', 'showBoard', 'showPace', 'sound']) if (typeof input[k] === 'boolean') s[k] = input[k];
  if (SPOTLIGHT_CHOICES.includes(Number(input.spotlightSeconds))) s.spotlightSeconds = Number(input.spotlightSeconds);
  if ('nicknames' in input) s.nicknames = cleanMap(input.nicknames, (v) => str(v, 24));
  if ('characters' in input) s.characters = cleanMap(input.characters, (v) => (parseCharacterSpec(v) == null ? null : String(v)));
  if (isObj(input.levels)) {
    const l = input.levels;
    s.levels = {
      moduleIds: Array.isArray(l.moduleIds) && l.moduleIds.length ? idList(l.moduleIds) : null,
      exclude: idList(l.exclude),
      themes: cleanMap(l.themes, (v) => (THEME_KEYS.includes(v) ? v : null)),
    };
  }
  if (Array.isArray(input.views)) {
    const seen = new Set();
    s.views = input.views.slice(0, 50).map(cleanView).filter(Boolean).filter((v) => !seen.has(v.id) && seen.add(v.id));
    if (!s.views.length) s.views = d.views;
  }
  s.defaultView = s.views.some((v) => v.id === input.defaultView) ? input.defaultView : s.views[0].id;
  return s;
}

class SettingsStore {
  constructor({ dir, file = 'settings.json', config }) {
    this.config = config;
    this.file = dir ? path.join(dir, file) : null;
    let saved = null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (err) {
        console.error(`[settings] ignoring unreadable ${this.file}: ${err.message}`);
      }
    }
    this.settings = saved ? sanitize(saved, config) : defaults(config);
  }

  get() {
    return this.settings;
  }

  replace(input) {
    this.settings = sanitize(input, this.config);
    this.save();
    return this.settings;
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

function findView(settings, id) {
  return settings.views.find((v) => v.id === id) || settings.views.find((v) => v.id === settings.defaultView) || settings.views[0];
}

// Who starts on a screen before any individual picks.
function inBase(view, student) {
  if (view.base === 'none') return false;
  if (view.base === 'sections') return student.sections.some((s) => view.sections.includes(s));
  return true;
}

function isMember(view, student) {
  if (view.exclude.includes(student.userId)) return false;
  return view.include.includes(student.userId) || inBase(view, student);
}

module.exports = { SettingsStore, sanitize, defaults, findView, isMember, inBase, THEME_KEYS, SPOTLIGHT_CHOICES };
