// Minimal Canvas LMS REST client: bearer auth, Link-header pagination, and
// retry with backoff when Canvas throttles us. The token is only ever sent to
// the configured Canvas origin.
'use strict';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

class CanvasError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return null;
}

class CanvasClient {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, sleep = sleepMs, perPage = 100, maxRetries = 3 }) {
    if (!baseUrl || !token) throw new Error('CanvasClient needs baseUrl and token');
    this.base = new URL(baseUrl);
    this.token = token;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.perPage = perPage;
    this.maxRetries = maxRetries;
  }

  url(path, params = {}) {
    const u = new URL(path, this.base);
    u.searchParams.set('per_page', String(this.perPage));
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      for (const item of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(item));
    }
    return u;
  }

  async fetchJson(url) {
    if (url.origin !== this.base.origin) throw new CanvasError(`Refusing to send the Canvas token to ${url.origin}`, 500);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetch(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } });
      } catch (err) {
        if (attempt < this.maxRetries) { await this.sleep(1000 * 2 ** attempt); continue; }
        throw new CanvasError(`Could not reach Canvas at ${this.base.origin}: ${err.message}`, 502);
      }
      if (res.ok) return { data: await res.json(), next: parseNextLink(res.headers.get('link')) };
      const body = await res.text().catch(() => '');
      const throttled = res.status === 429 || (res.status === 403 && /rate limit/i.test(body));
      if ((throttled || res.status >= 500) && attempt < this.maxRetries) { await this.sleep(1000 * 2 ** attempt); continue; }
      if (res.status === 401) throw new CanvasError('Canvas rejected the access token (401). Check CANVAS_TOKEN.', 401);
      if (res.status === 403) throw new CanvasError(`Canvas denied access to ${url.pathname} (403). The token needs teacher/TA access to the course.`, 403);
      if (res.status === 404) throw new CanvasError(`Canvas returned 404 for ${url.pathname}. Check CANVAS_URL and the course ID.`, 404);
      throw new CanvasError(`Canvas returned ${res.status} for ${url.pathname}`, res.status);
    }
  }

  async getAll(path, params) {
    const out = [];
    let url = this.url(path, params);
    for (let page = 0; url && page < 200; page++) {
      const { data, next } = await this.fetchJson(url);
      if (!Array.isArray(data)) throw new CanvasError(`Expected a list from ${url.pathname}`, 502);
      out.push(...data);
      url = next ? new URL(next) : null;
    }
    return out;
  }

  async getCourse(courseId) {
    return (await this.fetchJson(this.url(`/api/v1/courses/${encodeURIComponent(courseId)}`))).data;
  }

  // Courses this token can teach (teacher, TA or designer), newest first.
  async listMyCourses() {
    const courses = await this.getAll('/api/v1/courses', { enrollment_state: 'active', 'include[]': 'term' });
    const staff = new Set(['teacher', 'ta', 'designer']);
    return courses
      .filter((c) => c && c.id && !c.access_restricted_by_date && (c.enrollments || []).some((e) => staff.has(String(e.type).toLowerCase())))
      .map((c) => ({ id: String(c.id), name: c.name || `Course ${c.id}`, code: c.course_code || '', term: (c.term && c.term.name) || '' }))
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  listStudents(courseId) {
    return this.getAll(`/api/v1/courses/${encodeURIComponent(courseId)}/users`, {
      'enrollment_type[]': 'student',
      'enrollment_state[]': 'active',
      'include[]': 'enrollments',
    });
  }

  listSections(courseId) {
    return this.getAll(`/api/v1/courses/${encodeURIComponent(courseId)}/sections`);
  }

  // Every student's submissions in one paginated call (used for badges and
  // teacher insights).
  listSubmissions(courseId) {
    return this.getAll(`/api/v1/courses/${encodeURIComponent(courseId)}/students/submissions`, { 'student_ids[]': 'all' });
  }

  // Modules with their items. With studentId, Canvas includes that student's
  // module state and per-item completion_requirement.completed. Without it
  // (the teacher's view) we also ask for due dates.
  async listModules(courseId, studentId) {
    const c = encodeURIComponent(courseId);
    const extra = studentId != null ? { student_id: studentId } : {};
    const include = studentId != null ? ['items'] : ['items', 'content_details'];
    const modules = await this.getAll(`/api/v1/courses/${c}/modules`, { 'include[]': include, ...extra });
    for (const m of modules) {
      // Canvas omits items for very large modules; fetch them separately.
      if (!Array.isArray(m.items)) {
        m.items = await this.getAll(`/api/v1/courses/${c}/modules/${m.id}/items`, studentId != null ? extra : { 'include[]': 'content_details' });
      }
    }
    return modules;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = { CanvasClient, CanvasError, parseNextLink, mapLimit };
