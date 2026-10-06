// Collects every assignment's instructions from a Canvas course (descriptions,
// rubrics, allowed file types, due dates, plus module pages and the syllabus)
// into one readable Markdown document and a JSON file. Course content only:
// no student names, submissions or grades are fetched.
'use strict';

const { mapLimit } = require('./canvas');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', deg: '°', times: '×' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Canvas stores instructions as HTML; turn it into readable plain text with
// lists, headings, links and image descriptions kept.
function htmlToText(html) {
  if (!html) return '';
  let s = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = (tag.match(/\balt="([^"]*)"/i) || [])[1];
      return alt ? `[image: ${alt}]` : '[image]';
    })
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) => {
      const label = text.replace(/<[^>]+>/g, '').trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (m, n) => `\n\n${'#'.repeat(Math.min(6, Number(n) + 2))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|ul|ol|table|blockquote)>/gi, '\n\n')
    .replace(/<\/(div|tr)>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Links to course files inside instructions (starter files, example .llsp3s…).
function fileLinks(html) {
  const out = [];
  const re = /<a\b[^>]*href="([^"]*\/files\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) out.push({ id: m[2], name: decodeEntities(m[3].replace(/<[^>]+>/g, '').trim()) || `file ${m[2]}`, url: m[1] });
  return out;
}

function rubricOf(a) {
  return (a.rubric || []).map((c) => ({
    criterion: c.description || '',
    details: c.long_description || '',
    points: c.points,
    ratings: (c.ratings || []).map((r) => ({ rating: r.description || '', details: r.long_description || '', points: r.points })),
  }));
}

function shapeAssignment(a) {
  return {
    id: a.id,
    name: a.name,
    url: a.html_url || null,
    pointsPossible: a.points_possible ?? null,
    dueAt: a.due_at || null,
    submissionTypes: a.submission_types || [],
    allowedExtensions: a.allowed_extensions || [],
    published: a.published !== false,
    instructions: htmlToText(a.description),
    files: fileLinks(a.description),
    rubric: rubricOf(a),
  };
}

async function optional(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function collectInstructions(client, courseId) {
  const c = encodeURIComponent(courseId);
  const [course, modules, assignments, quizzes] = await Promise.all([
    client.fetchJson(client.url(`/api/v1/courses/${c}`, { 'include[]': 'syllabus_body' })).then((r) => r.data),
    client.listModules(courseId),
    client.getAll(`/api/v1/courses/${c}/assignments`, { order_by: 'position' }),
    optional(() => client.getAll(`/api/v1/courses/${c}/quizzes`), []),
  ]);

  const byAssignment = new Map(assignments.map((a) => [String(a.id), a]));
  const byQuiz = new Map(quizzes.map((q) => [String(q.id), q]));
  const pageUrls = [...new Set(modules.flatMap((m) => (m.items || []).filter((i) => i.type === 'Page' && i.page_url).map((i) => i.page_url)))];
  const pages = new Map();
  await mapLimit(pageUrls, 4, async (u) => {
    const page = await optional(() => client.fetchJson(client.url(`/api/v1/courses/${c}/pages/${encodeURIComponent(u)}`)).then((r) => r.data), null);
    if (page) pages.set(u, page);
  });

  const used = new Set();
  const shapedModules = modules
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((m) => ({
      id: m.id,
      name: m.name,
      published: m.published !== false,
      items: (m.items || []).map((i) => {
        const base = { type: i.type, title: i.title, required: !!i.completion_requirement, requirement: i.completion_requirement ? i.completion_requirement.type : null };
        if (i.type === 'Assignment' && byAssignment.has(String(i.content_id))) {
          used.add(String(i.content_id));
          return { ...base, assignment: shapeAssignment(byAssignment.get(String(i.content_id))) };
        }
        if (i.type === 'Quiz' && byQuiz.has(String(i.content_id))) {
          const q = byQuiz.get(String(i.content_id));
          if (q.assignment_id) used.add(String(q.assignment_id));
          return { ...base, quiz: { id: q.id, title: q.title, pointsPossible: q.points_possible ?? null, dueAt: q.due_at || null, instructions: htmlToText(q.description), files: fileLinks(q.description) } };
        }
        if (i.type === 'Page' && pages.has(i.page_url)) {
          const p = pages.get(i.page_url);
          return { ...base, page: { url: p.html_url || null, content: htmlToText(p.body), files: fileLinks(p.body) } };
        }
        if (i.type === 'ExternalUrl' || i.type === 'ExternalTool') return { ...base, link: i.external_url || i.html_url || null };
        return base;
      }),
    }));

  return {
    exportedAt: new Date().toISOString(),
    course: { id: course.id, name: course.name, code: course.course_code || '', syllabus: htmlToText(course.syllabus_body) },
    modules: shapedModules,
    otherAssignments: assignments.filter((a) => !used.has(String(a.id))).map(shapeAssignment),
  };
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'no due date';
}

function assignmentMarkdown(a, heading) {
  const lines = [`${heading} ${a.name}`, ''];
  const facts = [
    `**Points:** ${a.pointsPossible ?? '—'}`,
    `**Due:** ${fmtDate(a.dueAt)}`,
    `**Submit as:** ${a.submissionTypes.join(', ') || '—'}`,
  ];
  if (a.allowedExtensions.length) facts.push(`**Allowed files:** ${a.allowedExtensions.map((e) => `.${e}`).join(', ')}`);
  if (!a.published) facts.push('**Unpublished**');
  lines.push(facts.join(' · '), '');
  if (a.url) lines.push(`Canvas: ${a.url}`, '');
  lines.push(a.instructions || '_No instructions written in Canvas._', '');
  if (a.files.length) lines.push('**Linked files:**', ...a.files.map((f) => `- ${f.name} (${f.url})`), '');
  if (a.rubric.length) {
    lines.push('**Rubric:**', '', '| Criterion | Points | Ratings |', '| --- | --- | --- |');
    for (const r of a.rubric) {
      const ratings = r.ratings.map((x) => `${x.rating} (${x.points})${x.details ? `: ${x.details}` : ''}`).join('; ');
      const crit = `${r.criterion}${r.details ? ` — ${r.details}` : ''}`.replace(/\|/g, '/').replace(/\n/g, ' ');
      lines.push(`| ${crit} | ${r.points ?? ''} | ${ratings.replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
    }
    lines.push('');
  }
  return lines;
}

function toMarkdown(data) {
  const out = [`# ${data.course.name} — assignment instructions`, '', `Exported from Canvas on ${fmtDate(data.exportedAt)}. Course content only; no student information.`, ''];
  const all = [...data.modules.flatMap((m) => m.items.filter((i) => i.assignment).map((i) => i.assignment)), ...data.otherAssignments];
  const lego = all.filter((a) => a.allowedExtensions.some((e) => /^llsp/i.test(e)));
  out.push(`**${data.modules.length}** modules · **${all.length}** assignments${lego.length ? ` · **${lego.length}** accept LEGO (.llsp3) files` : ''}`, '');
  for (const m of data.modules) {
    out.push(`## Module: ${m.name}${m.published ? '' : ' (unpublished)'}`, '');
    for (const i of m.items) {
      if (i.type === 'SubHeader') { out.push(`**${i.title}**`, ''); continue; }
      if (i.assignment) { out.push(...assignmentMarkdown(i.assignment, '###')); continue; }
      if (i.quiz) {
        out.push(`### Quiz: ${i.quiz.title}`, '', `**Points:** ${i.quiz.pointsPossible ?? '—'} · **Due:** ${fmtDate(i.quiz.dueAt)}`, '', i.quiz.instructions || '_No instructions._', '');
        continue;
      }
      if (i.page) { out.push(`### Page: ${i.title}`, '', i.page.content || '_Empty page._', ''); continue; }
      out.push(`- ${i.type}: ${i.title}${i.link ? ` (${i.link})` : ''}`, '');
    }
  }
  if (data.otherAssignments.length) {
    out.push('## Assignments not in any module', '');
    for (const a of data.otherAssignments) out.push(...assignmentMarkdown(a, '###'));
  }
  if (data.course.syllabus) out.push('## Syllabus', '', data.course.syllabus, '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

module.exports = { collectInstructions, toMarkdown, htmlToText, fileLinks };
