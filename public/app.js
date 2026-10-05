// Class Quest browser client: polls /api/state and animates the class race.
(() => {
  'use strict';

  const { renderSprite, decodeCharacter, CHARACTER_COUNT } = window.Sprites;
  const { themeFor, drawScene, drawObstacle, drawDoneFlag, drawTrophy, drawFinish, rect } = window.Worlds;
  const $ = (id) => document.getElementById(id);

  // Layout, in "units" (one 8-bit pixel). Unit size u is chosen to fit the screen.
  const LANE = 30, HEADER = 12, GROUND = 5, GUTTER = 24, PAD = 10, FINISH = 26, JUMP = 9;
  const FONT = '"Press Start 2P", ui-monospace, monospace';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = $('track');
  const ctx = canvas.getContext('2d');
  const scene = $('scene');
  const sctx = scene.getContext('2d');

  let state = null;
  let bootId = null;
  let firstLoad = true;
  let layout = null;
  let structureKey = '';
  let hoverSlot = -1;
  let selectedId = null;
  let detailRun = null;
  const actors = new Map();
  const seen = new Set();
  const particles = [];
  const floaters = [];
  const spriteUrls = new Map();

  // ---------- data ----------

  async function poll() {
    let delay = 10;
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();
      delay = s.pollSeconds || delay;
      applyState(s);
    } catch (err) {
      showError(`Can't reach the Class Quest server (${err.message}). Retrying…`);
    }
    setTimeout(poll, delay * 1000);
  }

  function applyState(s) {
    if (bootId && s.bootId !== bootId) { seen.clear(); firstLoad = true; }
    bootId = s.bootId;
    state = s;

    $('title').textContent = s.course.name;
    document.title = `${s.course.name} · Class Quest`;
    $('mode').textContent = s.mode === 'demo' ? 'DEMO' : 'LIVE';
    $('mode').className = `badge ${s.mode}`;
    $('updated').textContent = s.updatedAt
      ? `Updated ${new Date(s.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: s.mode === 'demo' ? '2-digit' : undefined })}`
      : 'Connecting to Canvas…';
    if (s.error) showError(`Couldn't refresh from Canvas: ${s.error}${s.updatedAt ? ' Showing the last progress we saw.' : ''}`);
    else showError(null);

    const empty = $('empty');
    if (s.updatedAt && !s.levels.length) {
      empty.hidden = false;
      empty.textContent = 'No modules with completion requirements yet. Add requirements to your Canvas modules and they will appear here as levels.';
    } else if (s.updatedAt && !s.students.length) {
      empty.hidden = false;
      empty.textContent = 'No active students are enrolled in this course yet.';
    } else {
      empty.hidden = true;
    }

    const key = JSON.stringify([s.levels.map((l) => [l.id, l.items.length, l.theme, l.name]), s.students.length]);
    if (key !== structureKey) { structureKey = key; layout = null; }

    syncActors(s);
    renderBoard(s);
    handleEvents(s.events || []);
    if ($('detail').open) renderDetail(false);
    firstLoad = false;
  }

  function showError(msg) {
    const el = $('error');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function syncActors(s) {
    const nL = s.levels.length;
    const ids = new Set();
    s.students.forEach((st, slot) => {
      ids.add(st.id);
      const target = st.finished ? nL + 0.5 : st.position;
      let a = actors.get(st.id);
      if (!a) {
        const start = firstLoad && !reduceMotion ? 0 : target;
        a = { id: st.id, pos: start, lane: slot, delay: firstLoad ? Math.random() * 0.8 : 0, moving: false, hop: 0,
          phase: Math.random() * 6, walk: 0, lastLevel: Math.floor(start), quiet: firstLoad };
        actors.set(st.id, a);
      }
      a.student = st;
      a.target = target;
      a.slot = slot;
      if (reduceMotion) { a.pos = target; a.lane = slot; a.lastLevel = Math.floor(target); }
    });
    for (const id of [...actors.keys()]) if (!ids.has(id)) actors.delete(id);
  }

  // ---------- leaderboard / ticker / toasts ----------

  function spriteUrl(index) {
    if (!spriteUrls.has(index)) spriteUrls.set(index, renderSprite(index, 0, 4).toDataURL());
    return spriteUrls.get(index);
  }

  function ordinal(n) {
    const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderBoard(s) {
    const ol = $('board');
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    ol.replaceChildren(...s.students.map((st) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'board-row';
      btn.dataset.id = st.id;
      const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      const where = st.finished ? 'Quest complete!' : `Level ${st.level + 1} · ${Math.round(st.levelProgress * 100)}%`;
      btn.setAttribute('aria-label', `${ordinal(st.rank).toLowerCase()} place, ${st.name}, ${where}, ${pct}% of the quest`);
      btn.innerHTML = `<span class="rank r${st.rank}"></span><img alt=""><span class="name"></span><span class="lvl"></span><span class="bar"><span></span></span>`;
      btn.querySelector('.rank').textContent = ordinal(st.rank);
      btn.querySelector('img').src = spriteUrl(st.character);
      btn.querySelector('.name').textContent = st.name;
      btn.querySelector('.lvl').textContent = st.finished ? '★ DONE' : `LV ${st.level + 1}`;
      btn.querySelector('.bar > span').style.width = `${pct}%`;
      btn.addEventListener('click', () => openDetail(st.id));
      li.appendChild(btn);
      return li;
    }));
    if (focusedId) { const b = ol.querySelector(`[data-id="${focusedId}"]`); if (b) b.focus(); }
  }

  function handleEvents(events) {
    const fresh = events.filter((e) => !seen.has(e.id));
    fresh.forEach((e) => seen.add(e.id));
    const ul = $('ticker');
    ul.replaceChildren(...events.slice(-8).reverse().map((e) => {
      const li = document.createElement('li');
      const t = document.createElement('time');
      t.textContent = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      li.append(t, e.text);
      return li;
    }));
    if (!events.length) {
      const li = document.createElement('li');
      li.textContent = 'Waiting for the first submission…';
      ul.appendChild(li);
    }
    if (firstLoad) return;
    for (const e of fresh) if (e.type !== 'item') queueToast(e);
  }

  const toastQueue = [];
  let toastBusy = false;
  function queueToast(e) {
    toastQueue.push(e);
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const e = toastQueue.shift();
    const el = $('toast');
    if (!e) { toastBusy = false; return; }
    toastBusy = true;
    el.className = `toast ${e.type}`;
    el.textContent = e.type === 'finish' ? `🏆 ${e.text}` : e.type === 'level' ? `LEVEL UP! ${e.text}` : e.text;
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(nextToast, 300);
    }, 3500);
  }

  // ---------- race track ----------

  function buildLayout() {
    const wrap = $('trackWrap');
    const width = Math.max(320, wrap.clientWidth);
    const n = Math.max(1, state.students.length);
    const nL = Math.max(1, state.levels.length);
    const avail = Math.max(320, window.innerHeight - wrap.getBoundingClientRect().top - $('tickerBar').offsetHeight);
    let u = Math.floor((avail / (n * LANE + HEADER)) * 2) / 2;
    u = Math.max(1.5, Math.min(3, u));
    if (width < 700) u = Math.min(u, 1.5);
    const dpr = window.devicePixelRatio || 1;
    const gutter = GUTTER * u, trackX = gutter + PAD * u, finishW = FINISH * u;
    const segW = (width - trackX - finishW) / nL;
    const laneH = LANE * u, headerH = HEADER * u;
    const height = headerH + state.students.length * laneH;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const obstacles = [];
    state.levels.forEach((level, i) => {
      const k = level.items.length;
      const spacing = segW / k;
      const ou = Math.max(1, Math.min(u, spacing / 11));
      level.items.forEach((_, j) => obstacles.push({ x: trackX + (i + (j + 0.5) / k) * segW, half: Math.min(7 * u, spacing * 0.45), u: ou, level: i }));
    });

    layout = { width, height, u, dpr, gutter, trackX, finishW, segW, laneH, headerH, nL: state.levels.length, obstacles };
    layout.lanes = [0, 1].map((variant) => renderLane(variant));
    layout.header = renderHeader();
  }

  function offscreen(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.imageSmoothingEnabled = false;
    return [c, x];
  }

  function renderLane(variant) {
    const L = layout;
    const [c, x] = offscreen(L.width, L.laneH, L.dpr);
    const groundY = L.laneH - GROUND * L.u;
    state.levels.forEach((level, i) => {
      const theme = themeFor(i, level.theme);
      const x0 = i === 0 ? L.gutter : L.trackX + i * L.segW;
      const x1 = L.trackX + (i + 1) * L.segW;
      drawScene(x, theme, x0, 0, x1 - x0, L.laneH, L.u, variant * 101 + i * 7 + 1, GROUND);
      if (i > 0) rect(x, x0, 0, Math.max(1, L.u / 2), L.laneH, 'rgba(0,0,0,0.45)');
    });
    for (const o of L.obstacles) drawObstacle(x, themeFor(o.level, state.levels[o.level].theme), o.x, groundY, o.u);
    drawFinish(x, L.trackX + L.nL * L.segW, 0, L.finishW, L.laneH, L.u, GROUND);
    rect(x, 0, 0, L.gutter, L.laneH, '#101018');
    rect(x, 0, 0, L.width, 1, 'rgba(0,0,0,0.6)');
    return c;
  }

  function fitText(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return t.length > 1 ? `${t}…` : '';
  }

  function renderHeader() {
    const L = layout;
    const [c, x] = offscreen(L.width, L.headerH, L.dpr);
    rect(x, 0, 0, L.width, L.headerH, '#101018');
    const fs = L.u >= 2.5 ? 10 : 8;
    x.font = `${fs}px ${FONT}`;
    x.textBaseline = 'middle';
    state.levels.forEach((level, i) => {
      const theme = themeFor(i, level.theme);
      const x0 = i === 0 ? L.gutter : L.trackX + i * L.segW;
      const x1 = L.trackX + (i + 1) * L.segW;
      rect(x, x0, L.headerH - L.u, x1 - x0, L.u, theme.label);
      rect(x, x0, 0, L.u / 2, L.headerH, '#2e2e50');
      x.fillStyle = theme.label;
      x.fillText(fitText(x, `${i + 1} ${level.name}`, x1 - x0 - 3 * L.u), x0 + 2 * L.u, L.headerH / 2);
    });
    x.fillStyle = '#fcd03c';
    x.fillText(fitText(x, 'GOAL', L.finishW - 2 * L.u), L.trackX + L.nL * L.segW + 2 * L.u, L.headerH / 2);
    return c;
  }

  function xOf(p) {
    const L = layout;
    return p <= L.nL ? L.trackX + p * L.segW : L.trackX + L.nL * L.segW + (p - L.nL) * L.finishW;
  }
  function posOf(x) {
    const L = layout;
    const end = L.trackX + L.nL * L.segW;
    return x <= end ? (x - L.trackX) / L.segW : L.nL + (x - end) / L.finishW;
  }

  // Arc over whichever obstacle the character is currently passing.
  function jumpOffset(x, obstacles, height) {
    for (const o of obstacles) {
      const d = x - (o.x - o.half);
      if (d >= 0 && d <= o.half * 2) return -height * Math.sin((Math.PI * d) / (o.half * 2));
    }
    return 0;
  }

  function update(dt, t) {
    const L = layout;
    for (const a of actors.values()) {
      a.lane += (a.slot - a.lane) * Math.min(1, dt * 5);
      if (Math.abs(a.slot - a.lane) < 0.01) a.lane = a.slot;
      a.hop = Math.max(0, a.hop - dt);
      if (a.delay > 0) { a.delay -= dt; continue; }
      const xNow = xOf(a.pos), xTarget = xOf(a.target);
      const dist = Math.abs(xTarget - xNow);
      if (dist > 0.5) {
        const speed = Math.max(40 * L.u, dist * 0.9);
        const step = speed * dt;
        a.pos = step >= dist ? a.target : posOf(xNow + Math.sign(xTarget - xNow) * step);
        a.moving = true;
        a.walk += dt;
      } else {
        a.pos = a.target;
        if (a.moving) { a.moving = false; a.hop = 0.35; a.quiet = false; }
      }
      const lv = Math.floor(a.pos + 1e-6);
      if (lv > a.lastLevel && !a.quiet && !reduceMotion) celebrate(a, lv);
      a.lastLevel = lv;
      if (a.student.finished && !a.moving && a.hop === 0 && (t + a.phase) % 2.4 < dt) a.hop = 0.35;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      floaters[i].life -= dt;
      if (floaters[i].life <= 0) floaters.splice(i, 1);
    }
  }

  function actorFeet(a) {
    const L = layout;
    return { x: xOf(a.pos), y: L.headerH + a.lane * L.laneH + L.laneH - GROUND * L.u };
  }

  function celebrate(a, lv) {
    const { x, y } = actorFeet(a);
    const colors = ['#fcd03c', '#f878f8', '#3cdcfc', '#58d854', '#fcfcfc'];
    for (let i = 0; i < 24; i++) {
      particles.push({ x, y: y - 10 * layout.u, vx: (Math.random() - 0.5) * 220, vy: -120 - Math.random() * 160, life: 0.9 + Math.random() * 0.5,
        color: colors[i % colors.length] });
    }
    floaters.push({ actor: a, text: lv >= layout.nL ? 'FINISH!' : `LEVEL ${lv + 1}!`, life: 1.6 });
  }

  function yOffset(a, x) {
    const u = layout.u;
    if (a.moving) return jumpOffset(x, layout.obstacles, JUMP * u);
    if (a.hop > 0) return -4 * u * Math.sin(Math.PI * (1 - a.hop / 0.35));
    return 0;
  }

  function drawLabel(c, text, cx, bottom, u, color) {
    const fs = u >= 2.5 ? 10 : 8;
    c.font = `${fs}px ${FONT}`;
    c.textBaseline = 'alphabetic';
    const w = Math.ceil(c.measureText(text).width);
    const padX = 3, h = fs + 6;
    const left = Math.round(cx - w / 2 - padX);
    c.fillStyle = 'rgba(10,10,20,0.78)';
    c.fillRect(left, Math.round(bottom - h), w + padX * 2, h);
    c.fillStyle = color;
    c.fillText(text, left + padX, Math.round(bottom - 3));
  }

  function drawRank(rank, y) {
    const L = layout;
    const color = rank === 1 ? '#fcd03c' : rank === 2 ? '#c8c8dc' : rank === 3 ? '#d88c4c' : '#6c6c90';
    const cy = y + L.laneH / 2;
    const fs = L.u >= 2.5 ? 12 : 8;
    ctx.font = `${fs}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    const text = ordinal(rank);
    const w = ctx.measureText(text).width;
    ctx.fillText(text, Math.round((L.gutter - w) / 2), Math.round(cy));
  }

  function draw(t) {
    const L = layout;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, L.width, L.height);
    ctx.drawImage(L.header, 0, 0, L.width, L.headerH);
    for (let i = 0; i < state.students.length; i++) ctx.drawImage(L.lanes[i % 2], 0, L.headerH + i * L.laneH, L.width, L.laneH);
    if (hoverSlot >= 0 && hoverSlot < state.students.length) {
      ctx.strokeStyle = '#3cdcfc';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, L.headerH + hoverSlot * L.laneH + 1, L.width - 2, L.laneH - 2);
    }

    const list = [...actors.values()].sort((a, b) => a.lane - b.lane);
    for (const a of list) drawRank(a.student.rank, L.headerH + a.lane * L.laneH);
    for (const a of list) {
      const { x, y } = actorFeet(a);
      const jy = yOffset(a, x);
      const frame = a.moving ? Math.floor(a.walk * 8) % 2 : 0;
      const bob = !a.moving && a.hop === 0 && Math.sin(t * 3 + a.phase) > 0.85 ? -L.u : 0;
      const sprite = renderSprite(a.student.character, frame, L.u * L.dpr);
      if (jy < 0) rect(ctx, x - 5 * L.u, y - L.u, 10 * L.u, L.u, 'rgba(0,0,0,0.35)');
      ctx.drawImage(sprite, Math.round(x - 8 * L.u), Math.round(y - 16 * L.u + jy + bob), 16 * L.u, 16 * L.u);
      const color = a.id === selectedId ? '#3cdcfc' : a.student.rank === 1 ? '#fcd03c' : '#ffffff';
      drawLabel(ctx, a.student.name, x, y - 16 * L.u + jy + bob - L.u, L.u, color);
    }
    for (const p of particles) rect(ctx, p.x, p.y, L.u * 1.5, L.u * 1.5, p.color);
    for (const f of floaters) {
      const { x, y } = actorFeet(f.actor);
      const rise = (1.6 - f.life) * 20 * L.u;
      ctx.globalAlpha = Math.min(1, f.life * 2);
      drawLabel(ctx, f.text, x, y - 26 * L.u - rise, L.u, '#fcd03c');
      ctx.globalAlpha = 1;
    }
  }

  // ---------- student detail ----------

  function openDetail(id) {
    selectedId = id;
    renderDetail(true);
    const dlg = $('detail');
    if (!dlg.open) dlg.showModal();
  }

  function renderDetail(restartRun) {
    const st = state.students.find((s) => s.id === selectedId);
    if (!st) { $('detail').close(); return; }
    const nL = state.levels.length;
    const li = Math.min(st.level, nL - 1);
    const level = state.levels[li];
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;

    $('dSprite').src = spriteUrl(st.character);
    $('dSprite').alt = decodeCharacter(st.character).label;
    $('dName').textContent = st.name;
    $('dSub').textContent = `${ordinal(st.rank)} place of ${state.students.length} · ${st.done}/${st.total} challenges · ${pct}% of the quest`;

    const items = $('dItems');
    if (st.finished) {
      $('dLevelTitle').textContent = 'Quest complete! 🏆';
      items.replaceChildren();
    } else {
      const theme = themeFor(li, level.theme);
      $('dLevelTitle').textContent = `Level ${li + 1}: ${level.name} (${theme.name})`;
      const doneIds = new Set((st.levels[li].doneItemIds || []).map(String));
      items.replaceChildren(...level.items.map((item, j) => {
        const el = document.createElement('li');
        const done = doneIds.has(String(item.id));
        el.className = done ? 'done' : 'todo';
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = done ? '✓' : String(j + 1);
        el.append(mark, item.title);
        return el;
      }));
    }

    $('dLevels').replaceChildren(...state.levels.map((l, i) => {
      const p = st.levels[i];
      const el = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = 'mark';
      if (p.completed) { el.className = 'done'; mark.textContent = '★'; }
      else if (i === st.level) { el.className = 'current'; mark.textContent = '▶'; }
      else { el.className = 'locked'; mark.textContent = '·'; }
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `${p.done}/${p.total}`;
      el.append(mark, `${i + 1}. ${l.name}`, count);
      return el;
    }));

    const target = st.finished ? 1 : st.levelProgress;
    if (restartRun || !detailRun) detailRun = { pos: 0, target, hop: 0, walk: 0, moving: true, start: performance.now() + 300 };
    else detailRun.target = target;
    if (reduceMotion) detailRun.pos = target;
  }

  function drawDetail(dt, t) {
    const st = state && state.students.find((s) => s.id === selectedId);
    if (!st || !detailRun) return;
    const cssW = scene.clientWidth;
    if (!cssW) return;
    const dpr = window.devicePixelRatio || 1;
    const UNITS_W = 220, UNITS_H = 80;
    const u = cssW / UNITS_W;
    const cssH = Math.round(UNITS_H * u);
    if (scene.width !== Math.round(cssW * dpr) || scene.height !== Math.round(cssH * dpr)) {
      scene.width = Math.round(cssW * dpr);
      scene.height = Math.round(cssH * dpr);
      scene.style.height = `${cssH}px`;
    }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.imageSmoothingEnabled = false;
    const groundY = cssH - 10 * u;
    const startX = 24 * u, endX = cssW - 24 * u, span = endX - startX;
    const nL = state.levels.length;
    const li = Math.min(st.level, nL - 1);
    let obstacles = [];

    if (st.finished) {
      drawFinish(sctx, 0, 0, cssW, cssH, u, 10);
      drawTrophy(sctx, cssW / 2 + 20 * u, groundY, u * 2);
    } else {
      const level = state.levels[li];
      const theme = themeFor(li, level.theme);
      drawScene(sctx, theme, 0, 0, cssW, cssH, u, li * 13 + 5, 10);
      const k = level.items.length;
      const doneIds = new Set((st.levels[li].doneItemIds || []).map(String));
      sctx.font = `${Math.max(8, Math.round(u * 4))}px ${FONT}`;
      sctx.textBaseline = 'alphabetic';
      level.items.forEach((item, j) => {
        const ox = startX + ((j + 0.5) / k) * span;
        const ou = Math.min(u * 2, (span / k) / 11);
        obstacles.push({ x: ox, half: Math.min(9 * ou, (span / k) * 0.45) });
        drawObstacle(sctx, theme, ox, groundY, ou);
        if (doneIds.has(String(item.id))) drawDoneFlag(sctx, ox, groundY, ou);
        const label = String(j + 1);
        const w = sctx.measureText(label).width;
        sctx.fillStyle = 'rgba(10,10,20,0.75)';
        sctx.fillRect(ox - w / 2 - 3, groundY + 3 * u - 2, w + 6, Math.round(u * 4) + 6);
        sctx.fillStyle = doneIds.has(String(item.id)) ? '#58d854' : '#ffffff';
        sctx.fillText(label, ox - w / 2, groundY + 3 * u + Math.round(u * 4) + 1);
      });
    }

    const run = detailRun;
    if (performance.now() > run.start) {
      const dx = (run.target - run.pos) * span;
      if (Math.abs(dx) > 0.5) {
        const step = Math.max(50 * u, Math.abs(dx)) * dt;
        run.pos += Math.sign(dx) * Math.min(Math.abs(dx), step) / span;
        run.moving = true;
        run.walk += dt;
      } else {
        run.pos = run.target;
        if (run.moving) { run.moving = false; run.hop = 0.4; }
      }
    }
    run.hop = Math.max(0, run.hop - dt);
    if (st.finished && !run.moving && run.hop === 0 && t % 1.4 < dt) run.hop = 0.4;

    const cu = u * 2;
    const x = st.finished ? startX + run.pos * (span / 2) : startX + run.pos * span;
    let jy = 0;
    if (run.moving) jy = jumpOffset(x, obstacles, 16 * u);
    else if (run.hop > 0) jy = -8 * u * Math.sin(Math.PI * (1 - run.hop / 0.4));
    const frame = run.moving ? Math.floor(run.walk * 8) % 2 : 0;
    sctx.drawImage(renderSprite(st.character, frame, cu * dpr), Math.round(x - 8 * cu), Math.round(groundY - 16 * cu + jy), 16 * cu, 16 * cu);
    drawLabel(sctx, st.name, x, groundY - 16 * cu + jy - u, u * 1.5, '#ffffff');
  }

  // ---------- gallery ----------

  function openGallery() {
    const grid = $('galleryGrid');
    if (!grid.childElementCount) {
      for (let i = 0; i < CHARACTER_COUNT; i++) {
        const c = decodeCharacter(i);
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = spriteUrl(i);
        img.alt = c.label;
        const cap = document.createElement('figcaption');
        cap.textContent = c.label;
        const code = document.createElement('code');
        code.textContent = c.spec;
        cap.append(document.createElement('br'), code);
        fig.append(img, cap);
        grid.appendChild(fig);
      }
    }
    $('gallery').showModal();
  }

  // ---------- wiring ----------

  canvas.addEventListener('mousemove', (e) => {
    if (!layout) return;
    const y = e.offsetY - layout.headerH;
    hoverSlot = y >= 0 ? Math.floor(y / layout.laneH) : -1;
  });
  canvas.addEventListener('mouseleave', () => { hoverSlot = -1; });
  canvas.addEventListener('click', (e) => {
    if (!layout || !state) return;
    const slot = Math.floor((e.offsetY - layout.headerH) / layout.laneH);
    const st = state.students[slot];
    if (st) openDetail(st.id);
  });
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close();
    });
  }
  $('detail').addEventListener('close', () => { selectedId = null; detailRun = null; });
  $('galleryLink').addEventListener('click', (e) => { e.preventDefault(); openGallery(); });
  $('boardToggle').addEventListener('click', () => {
    const on = !$('layout').classList.toggle('no-board');
    $('boardToggle').setAttribute('aria-pressed', String(on));
    layout = null;
  });
  window.addEventListener('resize', () => { layout = null; });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout = null; });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state && state.students.length && state.levels.length) {
      if (!layout) buildLayout();
      update(dt, now / 1000);
      draw(now / 1000);
    } else if (layout || canvas.height) {
      canvas.height = 0;
      layout = null;
    }
    if ($('detail').open && state) drawDetail(dt, now / 1000);
    requestAnimationFrame(frame);
  }

  poll();
  requestAnimationFrame(frame);
})();
