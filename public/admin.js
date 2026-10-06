// Teacher controls: choose who appears on each screen, names and characters,
// which modules count as levels, display options, and private insights.
(() => {
  'use strict';

  const { renderSprite, renderIcon, decodeCharacter, CHARACTER_COUNT } = window.Sprites;
  const { THEMES, themeFor } = window.Worlds;
  const $ = (id) => document.getElementById(id);

  let data = null;
  let settings = null;
  const TABS = ['canvas', 'screens', 'students', 'levels', 'badges', 'display', 'insights'];
  let tab = null;
  let canvas = null;
  const conn = { url: '', token: '', courses: null, courseId: '', busy: false, msg: '', switching: false };
  let screenId = null;
  let screenSearch = '';
  let studentSearch = '';
  let insightView = '';
  let insightSort = { key: 'vsPace', dir: 1 };
  let charFor = null;
  let saveTimer = null;
  let dirty = false;
  let version = 0;
  const spriteUrls = new Map();

  const NAME_FORMATS = [
    ['first-last-initial', 'First name + last initial (Ava S.)'],
    ['first', 'First name only (Ava)'],
    ['initials', 'Initials (A.S.)'],
    ['display', 'Canvas display name'],
    ['full', 'Full name (Ava Smith)'],
  ];
  const SPOTLIGHT = [[0, 'Off'], [10, 'Every 10 seconds'], [20, 'Every 20 seconds'], [30, 'Every 30 seconds'], [60, 'Every minute']];

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'className') el.className = v;
      else if (k === 'checked' || k === 'value' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  function spriteUrl(index) {
    if (!spriteUrls.has(index)) spriteUrls.set(index, renderSprite(index, 0, 3).toDataURL());
    return spriteUrls.get(index);
  }
  const iconUrls = new Map();
  function iconUrl(key) {
    if (!iconUrls.has(key)) iconUrls.set(key, renderIcon(key, 3).toDataURL());
    return iconUrls.get(key);
  }

  // ---------- server ----------

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, auth: body.auth });
    return body;
  }

  function show(view) {
    for (const id of ['app', 'loginView', 'blockedView']) $(id).hidden = id !== view;
    $('refresh').hidden = view !== 'app';
  }

  async function load() {
    try {
      data = await api('/api/admin/data');
      canvas = await api('/api/admin/canvas').catch(() => null);
      if (!tab) tab = canvas && !canvas.connected ? 'canvas' : 'screens';
      if (canvas && !conn.url && canvas.canvasUrl) conn.url = canvas.canvasUrl;
      if (!dirty) settings = structuredClone(data.settings);
      show('app');
      $('logout').hidden = false;
      renderHeader();
      render();
    } catch (err) {
      if (err.auth === 'login') { show('loginView'); $('pin').focus(); }
      else if (err.auth === 'blocked') { show('blockedView'); $('blockedText').textContent = err.message; }
      else showError(err.message);
    }
  }

  function showError(msg) {
    $('error').hidden = !msg;
    $('error').textContent = msg || '';
  }

  function status(text, kind) {
    const el = $('status');
    el.hidden = false;
    el.textContent = text;
    el.className = `status ${kind || ''}`;
    clearTimeout(status.t);
    if (kind === 'ok') status.t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  // Save the whole settings object shortly after the last change.
  function changed(rerender = true) {
    dirty = true;
    version++;
    status('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 450);
    if (rerender) render();
  }

  async function save() {
    const saving = version;
    try {
      const res = await api('/api/admin/settings', { method: 'PUT', body: settings });
      const fresh = await api('/api/admin/data');
      if (saving !== version) return; // more edits arrived; the next save will catch up
      dirty = false;
      data = fresh;
      settings = structuredClone(res.settings);
      status('Saved ✓', 'ok');
      renderHeader();
      render();
    } catch (err) {
      status(`Not saved: ${err.message}`, 'err');
      if (err.status === 401) load();
    }
  }

  function renderHeader() {
    $('courseName').textContent = data.course ? data.course.name : '';
    $('mode').textContent = data.mode === 'demo' ? 'DEMO' : 'LIVE';
    $('mode').className = `badge ${data.mode}`;
    $('updated').textContent = data.updatedAt ? `Canvas data from ${new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for Canvas…';
    showError(data.error ? `Couldn't refresh from Canvas: ${data.error}` : null);
  }

  // ---------- rendering ----------

  // Re-render the active tab, keeping keyboard focus and caret where they were.
  function render() {
    if (!data || !settings) return;
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.key : null;
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    for (const t of TABS) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
      $(`tab-${t}`).tabIndex = t === tab ? 0 : -1;
      $(`panel-${t}`).hidden = t !== tab;
    }
    const panel = $(`panel-${tab}`);
    panel.replaceChildren(...{ canvas: renderCanvas, screens: renderScreens, students: renderStudents, levels: renderLevels, badges: renderBadges, display: renderDisplay, insights: renderInsights }[tab]());
    if (key) {
      const el = panel.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (el) {
        el.focus();
        if (sel && 'setSelectionRange' in el) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
      }
    }
  }

  const sectionName = (id) => (data.sections.find((s) => s.id === id) || {}).name || `Section ${id}`;
  const sectionsOf = (st) => st.sections.map(sectionName).join(', ');

  function inBase(view, st) {
    if (view.base === 'none') return false;
    if (view.base === 'sections') return st.sections.some((s) => view.sections.includes(s));
    return true;
  }
  function isMember(view, st) {
    if (view.exclude.includes(st.userId)) return false;
    return view.include.includes(st.userId) || inBase(view, st);
  }
  function setMember(view, st, on) {
    view.include = view.include.filter((x) => x !== st.userId);
    view.exclude = view.exclude.filter((x) => x !== st.userId);
    if (on && !inBase(view, st)) view.include.push(st.userId);
    if (!on && inBase(view, st)) view.exclude.push(st.userId);
  }

  function slug(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'screen';
    let id = base, n = 2;
    while (settings.views.some((v) => v.id === id)) id = `${base}-${n++}`;
    return id;
  }

  function screenUrl(view) {
    return `${location.origin}/?view=${encodeURIComponent(view.id)}`;
  }

  function matches(st, q) {
    if (!q) return true;
    const t = `${st.realName} ${st.name} ${sectionsOf(st)}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => t.includes(w));
  }


  // ---------- Canvas connection ----------

  async function findCourses() {
    conn.busy = true; conn.msg = ''; conn.courses = null; render();
    try {
      const r = await api('/api/admin/canvas/courses', { method: 'POST', body: { canvasUrl: conn.url, token: conn.token } });
      conn.url = r.canvasUrl;
      conn.courses = r.courses;
      conn.courseId = r.courseId && r.courses.some((c) => c.id === r.courseId) ? r.courseId : (r.courses[0] || {}).id || '';
      if (!r.courses.length) conn.msg = 'Canvas didn’t list any courses where you’re a teacher or TA. You can still connect by pasting a link to the course page into the Canvas address box.';
      if (!r.courses.length && r.courseId) { conn.courses = [{ id: r.courseId, name: `Course ${r.courseId}`, term: '', code: '' }]; conn.courseId = r.courseId; }
    } catch (err) {
      conn.msg = err.message;
    }
    conn.busy = false;
    render();
  }

  async function connectCourse() {
    conn.busy = true; conn.msg = ''; render();
    try {
      canvas = await api('/api/admin/canvas/connect', { method: 'POST', body: { canvasUrl: conn.url, token: conn.token, courseId: conn.courseId } });
      Object.assign(conn, { token: '', courses: null, switching: false, busy: false });
      dirty = false;
      settings = null;
      status('Connected ✓ Loading your class…', 'ok');
      await new Promise((r) => setTimeout(r, 1500));
      tab = 'screens';
      await load();
      return;
    } catch (err) {
      conn.msg = err.message;
    }
    conn.busy = false;
    render();
  }

  async function disconnectCanvas() {
    if (!confirm('Disconnect from Canvas? The saved token will be deleted from this computer and the display will show the demo class.')) return;
    try {
      canvas = await api('/api/admin/canvas/disconnect', { method: 'POST', body: {} });
      settings = null;
      dirty = false;
      await load();
    } catch (err) {
      conn.msg = err.message;
      render();
    }
  }

  function renderCanvas() {
    if (!canvas) return [h('div', { className: 'panel' }, h('p', { className: 'hint' }, 'Canvas settings aren’t available.'))];
    const host = canvas.canvasUrl ? new URL(canvas.canvasUrl).host : '';
    const showForm = !canvas.connected || conn.switching;
    const summary = canvas.connected
      ? h('div', {},
        h('p', {}, 'Connected to ', h('strong', {}, canvas.courseName || `course ${canvas.courseId}`), ` (course ${canvas.courseId}) on ${host}.`),
        canvas.locked
          ? h('p', { className: 'hint' }, 'This connection comes from environment variables on this computer, so it can only be changed there.')
          : h('div', { className: 'row' },
            !conn.switching ? h('button', { className: 'btn', onclick: () => { conn.switching = true; conn.courses = null; render(); } }, 'Switch course') : null,
            h('button', { className: 'btn danger', onclick: disconnectCanvas }, 'Disconnect')))
      : h('p', {}, h('strong', {}, 'Not connected yet.'), ' The display is showing a pretend class so you can try everything out. Connect your Canvas course below. It takes about a minute.');

    const canReuse = canvas.connected && conn.url.replace(/\/+$/, '') === canvas.canvasUrl;
    const form = showForm ? h('form', { onsubmit: (e) => { e.preventDefault(); if (conn.courses && conn.courseId) connectCourse(); else findCourses(); } },
      h('h3', {}, '1. Your Canvas address'),
      h('label', { className: 'field' }, h('span', {}, 'Copy it from your browser’s address bar while you’re in Canvas. If you paste the link to your course page, that course is picked for you.'),
        h('input', { type: 'text', value: conn.url, placeholder: 'https://yourschool.instructure.com', autocomplete: 'url', 'data-key': 'canvas-url', required: true,
          oninput: (e) => { conn.url = e.target.value; conn.courses = null; } })),
      h('h3', {}, '2. An access token'),
      h('details', { open: !canvas.connected },
        h('summary', {}, 'How do I get a token?'),
        h('ol', { className: 'steps' },
          h('li', {}, 'In Canvas, click ', h('strong', {}, 'Account'), ' (your picture, top left), then ', h('strong', {}, 'Settings'), '.'),
          h('li', {}, 'Scroll to ', h('strong', {}, 'Approved Integrations'), ' and click ', h('strong', {}, '+ New Access Token'), '.'),
          h('li', {}, 'For purpose, type “Class Quest”. Leave the expiry blank, or pick the end of the term. Click ', h('strong', {}, 'Generate Token'), '.'),
          h('li', {}, 'Copy the long token and paste it below. Canvas only shows it once.')),
        h('p', { className: 'hint' }, 'Treat the token like a password. It is saved only on this computer (in the data folder) and never sent to the class display. You can delete it any time from Canvas → Settings.')),
      h('label', { className: 'field' }, h('span', {}, canReuse ? 'Access token (leave blank to keep using the current one)' : 'Access token'),
        h('input', { type: 'password', value: conn.token, autocomplete: 'off', spellcheck: 'false', 'data-key': 'canvas-token', required: !canReuse,
          oninput: (e) => { conn.token = e.target.value; } })),
      h('div', { className: 'row' },
        h('button', { className: `btn${conn.courses ? '' : ' primary'}`, type: conn.courses ? 'button' : 'submit', disabled: conn.busy, onclick: conn.courses ? findCourses : null },
          conn.busy && !conn.courses ? 'Checking…' : 'Find my courses'),
        conn.switching ? h('button', { className: 'btn', type: 'button', onclick: () => { conn.switching = false; conn.msg = ''; render(); } }, 'Cancel') : null),
      conn.courses && conn.courses.length ? [
        h('h3', {}, '3. Pick your course'),
        h('div', { className: 'picker', role: 'radiogroup', 'aria-label': 'Course' },
          conn.courses.map((c) => h('label', { className: 'picker-row course-row' },
            h('input', { type: 'radio', name: 'course', value: c.id, checked: c.id === conn.courseId, 'data-key': `course-${c.id}`, onchange: () => { conn.courseId = c.id; } }),
            h('span', {}, c.name, h('span', { className: 'meta-text' }, [c.code, c.term].filter(Boolean).length ? ` · ${[c.code, c.term].filter(Boolean).join(' · ')}` : '')),
            h('span', { className: 'meta-text' }, `#${c.id}`)))),
        h('div', { className: 'row', style: 'margin-top:12px' },
          h('button', { className: 'btn primary', type: 'submit', disabled: conn.busy }, conn.busy ? 'Connecting…' : 'Connect this course')),
      ] : null,
      conn.msg ? h('p', { className: 'error-text', role: 'alert' }, conn.msg) : null) : null;

    return [h('div', { className: 'panel' },
      h('h2', {}, 'Canvas'),
      summary,
      form,
      h('p', { className: 'hint', style: 'margin-top:16px' }, 'Your account needs to be a teacher or TA in the course so Class Quest can read each student’s module progress.'))];
  }

  function demoBanner() {
    if (!canvas || canvas.connected) return null;
    return h('div', { className: 'panel notice' }, 'These are pretend students from the demo class. ',
      h('button', { className: 'btn primary', onclick: () => { tab = 'canvas'; render(); } }, 'Connect Canvas'));
  }

  function renderScreens() {
    if (!settings.views.some((v) => v.id === screenId)) screenId = settings.defaultView;
    const view = settings.views.find((v) => v.id === screenId);
    const memberCount = (v) => data.students.filter((s) => isMember(v, s)).length;

    const list = h('ul', { className: 'screen-list' },
      settings.views.map((v) => h('li', {},
        h('button', { 'aria-current': String(v.id === screenId), onclick: () => { screenId = v.id; render(); } },
          v.name, v.id === settings.defaultView ? h('span', { className: 'default' }, 'DEFAULT') : null,
          h('span', { className: 'count' }, memberCount(v))))),
      h('li', {}, h('button', {
        onclick: () => {
          const id = slug('New screen');
          settings.views.push({ id, name: 'New screen', base: 'none', sections: [], include: [], exclude: [], goal: null });
          screenId = id;
          changed();
        },
      }, '+ New screen')),
      data.sections.length > 1 ? h('li', {}, h('button', {
        onclick: () => {
          for (const sec of data.sections) {
            if (settings.views.some((v) => v.base === 'sections' && v.sections.length === 1 && v.sections[0] === sec.id)) continue;
            settings.views.push({ id: slug(sec.name), name: sec.name, base: 'sections', sections: [sec.id], include: [], exclude: [], goal: null });
          }
          changed();
        },
      }, '+ One screen per section')) : null);

    const shown = data.students.filter((s) => matches(s, screenSearch));
    const members = data.students.filter((s) => isMember(view, s));

    const editor = h('div', {},
      h('label', { className: 'field' }, h('span', {}, 'Screen name'),
        h('input', { type: 'text', value: view.name, 'data-key': 'view-name', maxlength: 60,
          oninput: (e) => { view.name = e.target.value; changed(false); } })),
      h('div', { className: 'row' },
        h('span', { className: 'url' }, screenUrl(view)),
        h('button', { className: 'btn', onclick: (e) => { navigator.clipboard.writeText(screenUrl(view)).then(() => { e.target.textContent = 'Copied!'; }); } }, 'Copy link'),
        h('a', { className: 'btn', href: `/?view=${encodeURIComponent(view.id)}`, target: '_blank', rel: 'noopener' }, 'Open ↗'),
        view.id === settings.defaultView
          ? h('span', { className: 'hint', style: 'margin:0' }, 'Shown at the plain address')
          : h('button', { className: 'btn', onclick: () => { settings.defaultView = view.id; changed(); } }, 'Make default'),
        settings.views.length > 1 ? h('button', {
          className: 'btn danger',
          onclick: () => {
            if (!confirm(`Delete the “${view.name}” screen?`)) return;
            settings.views = settings.views.filter((v) => v !== view);
            if (settings.defaultView === view.id) settings.defaultView = settings.views[0].id;
            screenId = settings.defaultView;
            changed();
          },
        }, 'Delete') : null),

      h('h3', {}, 'Who’s on this screen'),
      h('div', { className: 'choices', role: 'radiogroup', 'aria-label': 'Start from' },
        [['all', 'Everyone in the course'], ['sections', 'Students in chosen sections'], ['none', 'Only students I check']].map(([val, label]) =>
          h('label', { className: 'choice' },
            h('input', { type: 'radio', name: 'base', value: val, checked: view.base === val, 'data-key': `base-${val}`,
              onchange: () => { view.base = val; view.include = []; view.exclude = []; changed(); } }),
            label))),
      view.base === 'sections' ? h('div', { className: 'choices', style: 'margin:8px 0 4px' },
        data.sections.length ? data.sections.map((sec) => h('label', { className: 'choice' },
          h('input', { type: 'checkbox', checked: view.sections.includes(sec.id), 'data-key': `sec-${sec.id}`,
            onchange: (e) => {
              view.sections = e.target.checked ? [...view.sections, sec.id] : view.sections.filter((x) => x !== sec.id);
              changed();
            } }),
          `${sec.name} (${data.students.filter((s) => s.sections.includes(sec.id)).length})`))
          : h('p', { className: 'hint' }, 'This course has no sections.')) : null,
      h('p', { className: 'hint', style: 'margin-top:8px' },
        'Check or uncheck anyone below to add or remove them from this screen. ',
        h('strong', {}, `${members.length} of ${data.students.length}`), ' students are on it.'),
      h('div', { className: 'row', style: 'margin-bottom:8px' },
        h('input', { type: 'search', placeholder: 'Search names or sections', value: screenSearch, 'data-key': 'screen-search', 'aria-label': 'Search students',
          oninput: (e) => { screenSearch = e.target.value; render(); } }),
        h('button', { className: 'btn', onclick: () => { shown.forEach((s) => setMember(view, s, true)); changed(); } }, screenSearch ? 'Check shown' : 'Check all'),
        h('button', { className: 'btn', onclick: () => { shown.forEach((s) => setMember(view, s, false)); changed(); } }, screenSearch ? 'Uncheck shown' : 'Uncheck all')),
      h('div', { className: 'picker' },
        shown.length ? shown.map((st) => {
          const on = isMember(view, st);
          return h('label', { className: `picker-row${on ? '' : ' off'}` },
            h('input', { type: 'checkbox', checked: on, 'data-key': `m-${st.userId}`, onchange: (e) => { setMember(view, st, e.target.checked); changed(); } }),
            h('img', { src: spriteUrl(st.character), alt: '' }),
            h('span', {}, st.realName, st.name !== st.realName ? h('span', { className: 'meta-text' }, ` · shown as ${st.name}`) : null),
            h('span', { className: 'meta-text' }, sectionsOf(st)));
        }) : h('p', { className: 'hint', style: 'padding:10px' }, data.students.length ? 'No matches.' : 'No students yet.')),

      h('h3', {}, 'Class goal'),
      h('p', { className: 'hint' }, 'A shared target for everyone on this screen, shown as a progress bar at the top. Every challenge anyone completes counts toward it.'),
      h('div', { className: 'row' },
        h('label', { className: 'choice' },
          h('input', { type: 'checkbox', checked: !!view.goal, 'data-key': 'goal-on',
            onchange: (e) => {
              const total = members.reduce((n, s) => n + s.total, 0);
              view.goal = e.target.checked ? { target: Math.max(1, Math.round(total * 0.5)), reward: '' } : null;
              changed();
            } }),
          'Set a class goal'),
        view.goal ? [
          h('input', { type: 'number', min: 1, value: view.goal.target, style: 'width:90px', 'data-key': 'goal-target', 'aria-label': 'Challenges needed',
            oninput: (e) => { view.goal.target = Math.max(1, Number(e.target.value) || 1); changed(false); } }),
          h('span', {}, 'challenges for'),
          h('input', { type: 'text', value: view.goal.reward, placeholder: 'e.g. Free-choice Friday', maxlength: 120, 'data-key': 'goal-reward', 'aria-label': 'Reward',
            oninput: (e) => { view.goal.reward = e.target.value; changed(false); } }),
        ] : null),
      view.goal ? h('p', { className: 'hint', style: 'margin-top:8px' },
        `So far: ${members.reduce((n, s) => n + s.done, 0)} of ${members.reduce((n, s) => n + s.total, 0)} possible challenges completed by this screen's students.`) : null);

    return [demoBanner(), h('div', { className: 'panel' },
      h('h2', {}, 'Screens'),
      h('p', { className: 'hint' }, 'Each screen is a separate display with its own link, showing only the students you choose. Use one per class period, a small group, or whatever you need. Places are ranked within the screen.'),
      h('div', { className: 'screens' }, list, editor))];
  }

  function renderStudents() {
    const shown = data.students.filter((s) => matches(s, studentSearch));
    return [h('div', { className: 'panel' },
      h('h2', {}, 'Students'),
      h('p', { className: 'hint' }, 'Change how a name appears on screen (a nickname, or just for privacy) and pick characters. These apply to every screen.'),
      h('div', { className: 'row', style: 'margin-bottom:10px' },
        h('input', { type: 'search', placeholder: 'Search', value: studentSearch, 'data-key': 'student-search', 'aria-label': 'Search students',
          oninput: (e) => { studentSearch = e.target.value; render(); } })),
      h('table', { className: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Character'), h('th', {}, 'Student'), h('th', {}, 'Shown as'), h('th', { className: 'hide-sm' }, 'Screens'))),
        h('tbody', {}, shown.map((st) => h('tr', {},
          h('td', {}, h('button', { className: 'char-btn', 'data-key': `c-${st.userId}`, 'aria-label': `Change character for ${st.realName} (${decodeCharacter(st.character).label})`,
            onclick: () => openCharPicker(st) }, h('img', { className: 'sprite', src: spriteUrl(st.character), alt: '' }))),
          h('td', {}, st.realName, h('br'), h('small', { className: 'hint' }, sectionsOf(st))),
          h('td', {}, h('input', { type: 'text', value: settings.nicknames[st.userId] || '', placeholder: st.autoName, maxlength: 24, 'data-key': `n-${st.userId}`,
            'aria-label': `Display name for ${st.realName}`,
            oninput: (e) => {
              if (e.target.value.trim()) settings.nicknames[st.userId] = e.target.value;
              else delete settings.nicknames[st.userId];
              changed(false);
            } })),
          h('td', { className: 'hide-sm' }, settings.views.filter((v) => isMember(v, st)).map((v) => v.name).join(', ') || h('span', { className: 'hint' }, 'none'))))))) ];
  }

  function openCharPicker(st) {
    charFor = st;
    const taken = new Set(data.students.filter((s) => s.userId !== st.userId).map((s) => s.character));
    $('charTitle').textContent = `Pick a character for ${st.realName}`;
    $('charGrid').replaceChildren(...Array.from({ length: CHARACTER_COUNT }, (_, i) => {
      const c = decodeCharacter(i);
      return h('button', { 'aria-pressed': String(i === st.character), className: taken.has(i) ? 'taken' : '', title: c.label, 'aria-label': c.label,
        onclick: () => { settings.characters[st.userId] = c.spec; $('charDialog').close(); changed(); } },
      h('img', { src: spriteUrl(i), alt: '' }));
    }));
    $('charDialog').showModal();
  }

  function renderLevels() {
    let n = 0;
    const exclude = new Set(settings.levels.exclude);
    const rows = data.modules.map((m) => {
      const eligible = m.published && m.requirements > 0;
      const on = eligible && !exclude.has(m.id);
      const levelIndex = on && m.included ? n++ : null;
      const auto = levelIndex != null ? themeFor(levelIndex).name : '—';
      return h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: on, disabled: !eligible, 'data-key': `lv-${m.id}`, 'aria-label': `Use ${m.name} as a level`,
          onchange: (e) => {
            settings.levels.exclude = e.target.checked ? settings.levels.exclude.filter((x) => x !== m.id) : [...settings.levels.exclude, m.id];
            changed();
          } })),
        h('td', {}, levelIndex != null ? h('strong', {}, `Level ${levelIndex + 1}: `) : null, m.name,
          !eligible ? h('div', { className: 'hint', style: 'margin:0' }, !m.published ? 'Unpublished' : 'No completion requirements, so there is nothing to track') : null),
        h('td', {}, m.requirements),
        h('td', {}, h('select', { className: 'input', disabled: !on, 'data-key': `th-${m.id}`, 'aria-label': `World for ${m.name}`,
          onchange: (e) => {
            if (e.target.value) settings.levels.themes[m.id] = e.target.value;
            else delete settings.levels.themes[m.id];
            changed();
          } },
        h('option', { value: '' }, `Automatic (${auto})`),
        THEMES.map((t) => { const o = h('option', { value: t.key }, t.name); o.selected = settings.levels.themes[m.id] === t.key; return o; }))));
    });
    return [h('div', { className: 'panel' },
      h('h2', {}, 'Levels'),
      h('p', { className: 'hint' }, 'Each Canvas module with completion requirements is a level, and each requirement is an obstacle. Uncheck modules you don’t want in the game, and pick a world for any level. To add or change obstacles, edit the module’s requirements in Canvas.'),
      settings.levels.moduleIds ? h('p', { className: 'hint' }, 'Note: config.json lists specific moduleIds, so only those modules can appear.') : null,
      data.modules.length
        ? h('table', { className: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Use'), h('th', {}, 'Module'), h('th', {}, 'Challenges'), h('th', {}, 'World'))),
          h('tbody', {}, rows))
        : h('p', { className: 'hint' }, 'No modules loaded yet.'))];
  }

  function levelChoice(key, label) {
    const max = Math.max(10, data.levels.length);
    return h('label', { className: 'field' }, h('span', {}, label),
      h('select', { className: 'input', 'data-key': key, onchange: (e) => { settings[key] = e.target.value === '' ? null : Number(e.target.value); changed(); } },
        [['', 'All'], ...Array.from({ length: max + 1 }, (_, i) => [String(i), String(i)])].map(([v, l]) => {
          const o = h('option', { value: v }, l);
          o.selected = String(settings[key] ?? '') === v;
          return o;
        })));
  }

  function renderBadges() {
    const disabled = new Set(settings.disabledBadges);
    const setAll = (on) => { settings.disabledBadges = on ? [] : data.badges.map((b) => b.key); changed(); };
    const groups = [...new Set(data.badges.map((b) => b.group))];
    return [h('div', { className: 'panel' },
      h('h2', {}, 'Badges'),
      h('p', { className: 'hint' }, 'Choose which badges students can earn. Turned-off badges disappear from the display, the badge list and the spotlight. Badges only ever celebrate. None of them point out late or missing work.'),
      h('div', { className: 'row', style: 'margin-bottom:12px' },
        h('button', { className: 'btn', onclick: () => setAll(true) }, 'Turn all on'),
        h('button', { className: 'btn', onclick: () => setAll(false) }, 'Turn all off'),
        h('span', { className: 'hint', style: 'margin:0' }, `${data.badges.length - disabled.size} of ${data.badges.length} on`)),
      groups.flatMap((g) => [
        h('h3', {}, g),
        h('table', { className: 'data' },
          h('tbody', {}, data.badges.filter((b) => b.group === g).map((b) => {
            const on = !disabled.has(b.key);
            return h('tr', { className: on ? '' : 'off-row' },
              h('td', { style: 'width:40px' }, h('input', { type: 'checkbox', checked: on, 'data-key': `badge-${b.key}`, 'aria-label': `Allow the ${b.label} badge`,
                onchange: (e) => {
                  settings.disabledBadges = e.target.checked ? settings.disabledBadges.filter((k) => k !== b.key) : [...settings.disabledBadges, b.key];
                  changed();
                } })),
              h('td', { style: 'width:44px' }, h('img', { className: 'sprite', src: iconUrl(b.key), alt: '' })),
              h('td', {}, h('strong', {}, b.label), h('br'), h('span', { className: 'hint' }, b.desc)),
              h('td', { className: 'hide-sm', style: 'text-align:right;white-space:nowrap' }, on ? `${b.earned} earned` : h('span', { className: 'hint' }, 'off')));
          }))),
      ]))];
  }

  function radio(name, key, value, label, hint) {
    return h('label', { className: 'choice' },
      h('input', { type: 'radio', name, checked: settings[key] === value, 'data-key': `${name}-${value}`, onchange: () => { settings[key] = value; changed(); } }),
      h('span', {}, label, hint ? h('small', { className: 'hint' }, ` ${hint}`) : null));
  }

  function selectField(key, label, options) {
    return h('label', { className: 'field' }, h('span', {}, label),
      h('select', { className: 'input', 'data-key': key, onchange: (e) => { settings[key] = Number(e.target.value); changed(); } },
        options.map(([v, l]) => { const o = h('option', { value: v }, l); o.selected = settings[key] === v; return o; })));
  }

  function renderDisplay() {
    const toggle = (key, label, hint) => h('label', { className: 'choice' },
      h('input', { type: 'checkbox', checked: settings[key], 'data-key': key, onchange: (e) => { settings[key] = e.target.checked; changed(); } }),
      h('span', {}, label, hint ? h('small', { className: 'hint' }, ` ${hint}`) : null));
    return [h('div', { className: 'panel' },
      h('h2', {}, 'Display'),
      h('p', { className: 'hint' }, 'These apply to every screen. Changes show up on open displays within a few seconds.'),
      h('label', { className: 'field' }, h('span', {}, 'Title'),
        h('input', { type: 'text', value: settings.title, placeholder: data.course ? data.course.name : 'Course name', maxlength: 80, 'data-key': 'title',
          oninput: (e) => { settings.title = e.target.value; changed(false); } })),
      h('label', { className: 'field' }, h('span', {}, 'How names appear'),
        h('select', { className: 'input', 'data-key': 'nameFormat', onchange: (e) => { settings.nameFormat = e.target.value; changed(); } },
          NAME_FORMATS.map(([v, l]) => { const o = h('option', { value: v }, l); o.selected = settings.nameFormat === v; return o; }))),
      h('h3', {}, 'Mode'),
      h('div', { className: 'choices', role: 'radiogroup', 'aria-label': 'Mode' },
        h('label', { className: 'choice' }, h('input', { type: 'radio', name: 'mode', checked: settings.showRanks, 'data-key': 'mode-race',
          onchange: () => { settings.showRanks = true; changed(); } }), 'Race: show places (1st, 2nd…) and a crown for the leader'),
        h('label', { className: 'choice' }, h('input', { type: 'radio', name: 'mode', checked: !settings.showRanks, 'data-key': 'mode-coop',
          onchange: () => { settings.showRanks = false; changed(); } }), 'Cooperative: no places, students listed by name')),
      h('h3', {}, 'Extras'),
      h('div', {},
        toggle('showBoard', 'Show the leaderboard panel'),
        toggle('showPace', 'Show the pace marker', '(a dashed line where the class should be, based on due dates)'),
        toggle('sound', 'Sound effects on by default', '(anyone at the display can still toggle them)')),
      h('h3', {}, 'Track layout'),
      h('div', { role: 'radiogroup', 'aria-label': 'Track layout' },
        radio('layout', 'layout', 'lanes', 'Race track: everyone on the same track', '(best for seeing how far everyone is at a glance)'),
        radio('layout', 'layout', 'cards', 'Cards: each student sees only the levels around them', '(bigger scenery, harder to compare)')),
      settings.layout === 'lanes'
        ? h('div', { className: 'row', style: 'margin-top:8px' },
          selectField('laneColumns', 'Columns', [[0, 'Automatic (fit the screen)'], [1, '1 column'], [2, '2 columns'], [3, '3 columns'], [4, '4 columns']]),
          h('p', { className: 'hint', style: 'margin:0;max-width:420px' }, 'With lots of students, the track splits into side-by-side columns so every lane stays tall enough to read. Automatic picks whatever makes names biggest on your screen.'))
        : h('div', { className: 'row', style: 'margin-top:8px' },
          levelChoice('levelsBefore', 'Levels before the current one'),
          levelChoice('levelsAfter', 'Levels after the current one')),
      h('h3', {}, 'Scenery'),
      h('div', { role: 'radiogroup', 'aria-label': 'Scenery' },
        radio('scenery', 'scenery', 'calm', 'Calm', '(softer backgrounds, so names and progress stand out)'),
        radio('scenery', 'scenery', 'detailed', 'Detailed', '(full 8-bit scenery)')),
      h('label', { className: 'field', style: 'margin-top:12px' }, h('span', {}, 'Spotlight: show each student’s level close-up in turn'),
        h('select', { className: 'input', 'data-key': 'spotlight', onchange: (e) => { settings.spotlightSeconds = Number(e.target.value); changed(); } },
          SPOTLIGHT.map(([v, l]) => { const o = h('option', { value: v }, l); o.selected = settings.spotlightSeconds === v; return o; }))),
      h('p', { className: 'hint' }, 'Students who just levelled up or earned a badge are spotlighted first.'))];
  }

  function relTime(iso) {
    if (!iso) return 'never';
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  function renderInsights() {
    const view = settings.views.find((v) => v.id === insightView);
    const rows = data.students.filter((s) => !view || isMember(view, s));
    const val = {
      name: (s) => s.sortableName.toLowerCase(),
      level: (s) => s.position,
      done: (s) => s.done,
      vsPace: (s) => (s.vsPace == null ? 0 : s.vsPace),
      last: (s) => (s.stats && s.stats.lastSubmittedAt ? Date.parse(s.stats.lastSubmittedAt) : 0),
      missing: (s) => (s.stats ? s.stats.missing : 0),
    };
    const { key, dir } = insightSort;
    rows.sort((a, b) => (val[key](a) > val[key](b) ? dir : val[key](a) < val[key](b) ? -dir : 0) || a.sortableName.localeCompare(b.sortableName));
    const behind = rows.filter((s) => s.vsPace != null && s.vsPace < 0 && !s.finished).length;
    const quiet = rows.filter((s) => s.stats && !s.finished && (!s.stats.lastSubmittedAt || Date.now() - Date.parse(s.stats.lastSubmittedAt) > 7 * 86400000)).length;
    const th = (k, label, cls) => h('th', { className: cls, 'aria-sort': key === k ? (dir > 0 ? 'ascending' : 'descending') : null },
      h('button', { onclick: () => { insightSort = { key: k, dir: key === k ? -dir : (k === 'name' || k === 'vsPace' ? 1 : -1) }; render(); } },
        label, key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''));
    const levelName = (s) => (s.finished ? '★ Done' : `${s.level + 1}`);

    return [h('div', { className: 'panel' },
      h('h2', {}, 'Insights'),
      h('p', { className: 'hint' }, 'Only you see this page. Nothing here (late or missing work, pace) is ever shown on a class display.'),
      h('div', { className: 'row', style: 'margin-bottom:12px' },
        h('select', { className: 'input', 'data-key': 'insight-view', 'aria-label': 'Screen', onchange: (e) => { insightView = e.target.value; render(); } },
          h('option', { value: '' }, 'All students'),
          settings.views.map((v) => { const o = h('option', { value: v.id }, v.name); o.selected = v.id === insightView; return o; })),
        h('a', { className: 'btn', href: '/api/admin/export.csv' }, 'Download CSV'),
        data.pace ? h('span', { className: 'hint', style: 'margin:0' }, `Pace: ${data.pace.itemsDue} challenges due so far.`) : h('span', { className: 'hint', style: 'margin:0' }, 'Add due dates in Canvas to see pace.')),
      h('p', {}, h('strong', { className: behind ? 'neg' : 'pos' }, `${behind} behind pace`), ' · ',
        h('strong', { className: quiet ? 'neg' : 'pos' }, `${quiet} with nothing turned in for a week`)),
      h('div', { style: 'overflow-x:auto' }, h('table', { className: 'data' },
        h('thead', {}, h('tr', {}, th('name', 'Student'), h('th', { className: 'hide-sm' }, 'Section'), th('level', 'Level'), th('done', 'Done'),
          th('vsPace', 'Vs pace'), th('last', 'Last turned in', 'hide-sm'), th('missing', 'Missing'), h('th', { className: 'hide-sm' }, 'Late'), h('th', { className: 'hide-sm' }, 'Badges'))),
        h('tbody', {}, rows.map((s) => h('tr', {},
          h('td', {}, s.realName),
          h('td', { className: 'hide-sm' }, sectionsOf(s)),
          h('td', {}, levelName(s)),
          h('td', {}, `${s.done}/${s.total}`),
          h('td', {}, s.vsPace == null ? '—' : s.vsPace === 0 ? 'on pace' : h('span', { className: s.vsPace > 0 ? 'pos' : 'neg' }, s.vsPace > 0 ? `+${s.vsPace}` : `${s.vsPace}`)),
          h('td', { className: 'hide-sm' }, s.stats ? relTime(s.stats.lastSubmittedAt) : '—'),
          h('td', {}, s.stats ? s.stats.missing : '—'),
          h('td', { className: 'hide-sm' }, s.stats ? s.stats.late : '—'),
          h('td', { className: 'hide-sm mini-badges' }, s.badges.map((b) => h('img', { src: iconUrl(b), alt: b, title: b }))))))))) ];
  }

  // ---------- wiring ----------

  for (const t of TABS) {
    $(`tab-${t}`).addEventListener('click', () => { tab = t; render(); });
  }
  $('app').querySelector('.tabs').addEventListener('keydown', (e) => {
    const tabs = TABS;
    const i = tabs.indexOf(tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      tab = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      render();
      $(`tab-${tab}`).focus();
    }
  });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: { pin: $('pin').value } });
      $('pin').value = '';
      $('loginError').textContent = '';
      load();
    } catch (err) {
      $('loginError').textContent = err.message;
    }
  });
  $('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => {});
    location.reload();
  });
  $('refresh').addEventListener('click', async (e) => {
    e.target.disabled = true;
    status('Refreshing from Canvas…');
    try {
      const r = await api('/api/admin/refresh', { method: 'POST', body: {} });
      status(r.ok ? 'Refreshed ✓' : `Canvas error: ${r.error}`, r.ok ? 'ok' : 'err');
      await load();
    } catch (err) {
      status(err.message, 'err');
    }
    e.target.disabled = false;
  });
  $('charAuto').addEventListener('click', () => {
    if (charFor) delete settings.characters[charFor.userId];
    $('charDialog').close();
    changed();
  });
  $('charDialog').addEventListener('click', (e) => {
    if (e.target === $('charDialog') || e.target.hasAttribute('data-close')) $('charDialog').close();
  });

  // Keep insights fresh without disturbing someone mid-edit.
  setInterval(() => {
    const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (!dirty && !typing && !$('app').hidden && !$('charDialog').open) load();
  }, 30000);

  load();
})();
