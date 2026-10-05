// Teacher-only access. Requests from this computer are trusted when no PIN is
// set; anything from another device needs the PIN. Sessions live in memory.
'use strict';

const crypto = require('crypto');

const COOKIE = 'cq_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;

function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

class AdminAuth {
  constructor({ pin, now = Date.now }) {
    this.pin = pin || '';
    this.now = now;
    this.sessions = new Map();
    this.failures = [];
  }

  // 'ok', 'login' (show the PIN form) or 'blocked' (no PIN set, remote device).
  status(req) {
    if (!this.pin) return isLoopback(req) ? 'ok' : 'blocked';
    const token = readCookie(req, COOKIE);
    const expires = token && this.sessions.get(token);
    if (expires && expires > this.now()) return 'ok';
    if (token) this.sessions.delete(token);
    return 'login';
  }

  // Returns a Set-Cookie header value, or null for a wrong PIN.
  login(pin, secure) {
    const now = this.now();
    this.failures = this.failures.filter((t) => now - t < 60 * 1000);
    if (!this.pin || this.failures.length >= 10) return null;
    if (!sameText(pin, this.pin)) {
      this.failures.push(now);
      return null;
    }
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, now + SESSION_MS);
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  logout(req) {
    const token = readCookie(req, COOKIE);
    if (token) this.sessions.delete(token);
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}

// Changes must come from our own pages: JSON body, and an Origin (if the
// browser sent one) that matches the Host we were reached on.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function progressCsv(data) {
  const sections = new Map(data.sections.map((s) => [s.id, s.name]));
  const levelName = (s) => (s.finished ? 'Finished' : data.levels[s.level] ? `${s.level + 1}. ${data.levels[s.level].name}` : '');
  const rows = [['Name', 'Display name', 'Section', 'Level', 'Completed', 'Total', 'Percent', 'Vs pace', 'Last submission', 'Missing', 'Late', 'Badges']];
  for (const s of data.students) {
    rows.push([
      s.realName, s.name, s.sections.map((id) => sections.get(id) || id).join('; '), levelName(s), s.done, s.total,
      s.total ? Math.round((s.done / s.total) * 100) : 0, s.vsPace == null ? '' : s.vsPace,
      s.stats && s.stats.lastSubmittedAt ? s.stats.lastSubmittedAt : '', s.stats ? s.stats.missing : '', s.stats ? s.stats.late : '',
      s.badges.join('; '),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { AdminAuth, isLoopback, sameOrigin, progressCsv, readCookie };
