// Class Quest browser client: polls /api/state and animates the class race.
(() => {
  'use strict';

  const { renderSprite, renderIcon, decodeCharacter, CHARACTER_COUNT } = window.Sprites;
  const { themeFor, drawScene, drawObstacle, drawDoneFlag, drawTrophy, drawFinish, rect } = window.Worlds;
  const $ = (id) => document.getElementById(id);

  // Layout, in "units" (one 8-bit pixel). Unit size u is chosen to fit the screen.
  const LANE = 30, HEADER = 12, GROUND = 5, GUTTER = 24, PAD = 10, FINISH = 26, JUMP = 9;
  const FONT = '"Press Start 2P", ui-monospace, monospace';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);

  const canvas = $('track');
  const ctx = canvas.getContext('2d');
  const scene = $('scene');
  const sctx = scene.getContext('2d');

  let state = null;
  let bootId = null;
  let firstLoad = true;
  let layout = null;
  let structureKey = '';
  let hoverId = null;
  let selectedId = null;
  let detailRun = null;
  let viewId = params.get('view') || '';
  let boardOverride = params.has('board') ? params.get('board') !== '0' : null;
  let leaderId = null;
  let lastGoalDone = null;
  let pollTimer = null;
  const actors = new Map();
  const seen = new Set();
  const particles = [];
  const floaters = [];
  const spriteUrls = new Map();

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ---------- sound ----------

  const Sound = (() => {
    let ac = null;
    let on = false;
    function audio() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, start, dur, type, vol) {
      const a = audio();
      if (!a) return;
      const t0 = a.currentTime + start;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    const seq = (notes, step, type = 'square', vol = 0.04) => notes.forEach((f, i) => f && tone(f, i * step, step * 0.95, type, vol));
    const SONGS = {
      coin: () => seq([988, 1319], 0.07),
      level: () => seq([523, 659, 784, 1047], 0.09),
      finish: () => seq([523, 659, 784, 1047, 0, 784, 1047, 1319], 0.11),
      badge: () => seq([784, 988, 1175, 1568], 0.07, 'triangle', 0.06),
      lead: () => seq([392, 523, 659, 784], 0.07),
      goal: () => seq([523, 523, 523, 659, 0, 587, 659, 784, 0, 1047], 0.1),
    };
    return {
      get on() { return on; },
      set(v) { on = v; if (v) audio(); },
      unlock() { if (on) audio(); },
      play(kind) { if (on && SONGS[kind]) SONGS[kind](); },
    };
  })();

  // ---------- data ----------

  function schedulePoll(seconds) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, seconds * 1000);
  }

  async function poll() {
    let delay = 10;
    try {
      const qs = viewId ? `?view=${encodeURIComponent(viewId)}` : '';
      const res = await fetch(`/api/state${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();
      delay = s.pollSeconds || delay;
      applyState(s);
    } catch (err) {
      showError(`Can't reach the Class Quest server (${err.message}). Retrying…`);
    }
    schedulePoll(delay);
  }

  function applyState(s) {
    if (bootId && s.bootId !== bootId) { seen.clear(); firstLoad = true; }
    const viewChanged = state && state.view.id !== s.view.id;
    if (viewChanged) { firstLoad = true; actors.clear(); leaderId = null; lastGoalDone = null; }
    bootId = s.bootId;
    state = s;

    $('title').textContent = s.course.name;
    document.title = `${s.course.name} · Class Quest`;
    $('mode').textContent = s.mode === 'demo' ? 'DEMO' : 'LIVE';
    $('mode').className = `badge ${s.mode}`;
    $('updated').textContent = s.updatedAt
      ? `Updated ${new Date(s.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Connecting to Canvas…';
    if (s.error) showError(`Couldn't refresh from Canvas: ${s.error}${s.updatedAt ? ' Showing the last progress we saw.' : ''}`);
    else showError(null);

    renderViewPicker(s);
    renderGoal(s);
    applyDisplay(s.display);

    const empty = $('empty');
    if (s.updatedAt && !s.levels.length) {
      empty.hidden = false;
      empty.textContent = 'No modules with completion requirements yet. Add requirements to your Canvas modules (or check the Levels tab in Teacher controls) and they will appear here.';
    } else if (s.updatedAt && !s.students.length) {
      empty.hidden = false;
      empty.textContent = `Nobody is on the “${s.view.name}” screen yet. Choose students in Teacher controls.`;
    } else {
      empty.hidden = true;
    }

    const key = JSON.stringify([s.levels.map((l) => [l.id, l.items.length, l.theme, l.name]), s.students.length, s.display.showRanks, s.display.layout, s.display.laneColumns, s.display.scenery, s.display.levelsBefore, s.display.levelsAfter]);
    if (key !== structureKey) { structureKey = key; layout = null; }

    syncActors(s);
    renderBoard(s);
    handleEvents(s.events || []);
    checkLeader(s);
    if ($('detail').open) renderDetail(false);
    firstLoad = false;
  }

  function showError(msg) {
    const el = $('error');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function renderViewPicker(s) {
    const sel = $('viewPicker');
    sel.hidden = s.views.length < 2;
    const sig = JSON.stringify(s.views);
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.replaceChildren(...s.views.map((v) => new Option(v.name, v.id)));
    }
    sel.value = s.view.id;
  }

  function renderGoal(s) {
    const el = $('goal');
    if (!s.goal) { el.hidden = true; lastGoalDone = null; return; }
    el.hidden = false;
    const pct = Math.min(100, Math.round((s.goal.done / s.goal.target) * 100));
    $('goalFill').style.width = `${pct}%`;
    const reached = s.goal.done >= s.goal.target;
    el.classList.toggle('reached', reached);
    $('goalText').textContent = `${s.goal.done}/${s.goal.target}${s.goal.reward ? ` · ${s.goal.reward}` : ''}${reached ? ' ✓' : ''}`;
    el.setAttribute('aria-label', `Class goal: ${s.goal.done} of ${s.goal.target} challenges${s.goal.reward ? ` for ${s.goal.reward}` : ''}`);
    if (lastGoalDone != null && lastGoalDone < s.goal.target && reached) {
      queueToast({ type: 'goal', text: `CLASS GOAL REACHED!${s.goal.reward ? ` ${s.goal.reward}!` : ''}` });
      confetti(120);
    }
    lastGoalDone = s.goal.done;
  }

  let displayApplied = null;
  function applyDisplay(d) {
    const showBoard = boardOverride != null ? boardOverride : d.showBoard;
    const sig = JSON.stringify([showBoard, d.spotlightSeconds, d.sound]);
    if (sig === displayApplied) return;
    const first = displayApplied == null;
    displayApplied = sig;
    setBoard(showBoard);
    const spotParam = params.get('spotlight');
    configureSpotlight(spotParam != null ? Number(spotParam) || 0 : d.spotlightSeconds);
    if (first) {
      const fromUrl = params.get('sound');
      const saved = fromUrl != null ? (fromUrl === '0' ? '0' : '1') : storage.get('cq-sound');
      setSound(saved != null ? saved === '1' : d.sound, false);
    }
  }

  function setBoard(on) {
    $('layout').classList.toggle('no-board', !on);
    $('boardToggle').setAttribute('aria-pressed', String(on));
    layout = null;
  }

  function setSound(on, remember) {
    Sound.set(on);
    $('soundToggle').setAttribute('aria-pressed', String(on));
    $('soundToggle').textContent = on ? '♪ On' : '♪ Off';
    if (remember) storage.set('cq-sound', on ? '1' : '0');
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

  function checkLeader(s) {
    if (!s.display.showRanks) { leaderId = null; return; }
    const leaders = s.students.filter((x) => x.rank === 1);
    const id = leaders.length === 1 ? leaders[0].id : null;
    if (id && leaderId && id !== leaderId && !firstLoad) {
      queueToast({ type: 'lead', text: `${leaders[0].name} takes the lead!` });
      spotlightSoon(id);
    }
    if (id || firstLoad) leaderId = id;
  }

  // ---------- leaderboard / ticker / toasts ----------

  function spriteUrl(index) {
    if (!spriteUrls.has(index)) spriteUrls.set(index, renderSprite(index, 0, 4).toDataURL());
    return spriteUrls.get(index);
  }

  const iconUrls = new Map();
  function iconUrl(key) {
    if (!iconUrls.has(key)) {
      const c = renderIcon(key, 4);
      iconUrls.set(key, c ? c.toDataURL() : '');
    }
    return iconUrls.get(key);
  }

  function ordinal(n) {
    const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function badgeIcons(badges, cls) {
    const wrap = document.createElement('span');
    wrap.className = cls;
    const list = badges || [];
    for (const b of list.slice(0, 5)) {
      const img = document.createElement('img');
      img.src = iconUrl(b.key);
      img.alt = b.label;
      img.title = `${b.label}${b.count > 1 ? ` ×${b.count}` : ''}: ${b.desc}`;
      wrap.appendChild(img);
    }
    if (list.length > 5) wrap.append(`+${list.length - 5}`);
    return wrap;
  }

  function renderBoard(s) {
    const ol = $('board');
    $('boardTitle').textContent = s.display.showRanks ? 'Leaderboard' : 'Explorers';
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    ol.replaceChildren(...s.students.map((st) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'board-row';
      btn.dataset.id = st.id;
      const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      const where = st.finished ? 'Quest complete!' : `Level ${st.level + 1} · ${Math.round(st.levelProgress * 100)}%`;
      const place = st.rank ? `${ordinal(st.rank).toLowerCase()} place, ` : '';
      btn.setAttribute('aria-label', `${place}${st.name}, ${where}, ${pct}% of the quest`);
      btn.innerHTML = '<span class="rank"></span><img alt=""><span class="name"></span><span class="lvl"></span><span class="bar"><span></span></span>';
      const rank = btn.querySelector('.rank');
      if (st.rank) { rank.textContent = ordinal(st.rank); rank.classList.add(`r${st.rank}`); }
      else rank.textContent = st.finished ? '★' : `L${st.level + 1}`;
      btn.querySelector('img').src = spriteUrl(st.character);
      const name = btn.querySelector('.name');
      name.textContent = st.name;
      name.appendChild(badgeIcons(st.badges, 'badges'));
      btn.querySelector('.lvl').textContent = st.finished ? '★ DONE' : `LV ${st.level + 1}`;
      btn.querySelector('.bar > span').style.width = `${pct}%`;
      btn.addEventListener('click', () => openDetail(st.id));
      li.appendChild(btn);
      return li;
    }));
    if (focusedId) { const b = ol.querySelector(`[data-id="${focusedId}"]`); if (b) b.focus(); }
  }

  const SOUND_FOR = { item: 'coin', level: 'level', finish: 'finish', badge: 'badge' };
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
    const kinds = new Set(fresh.map((e) => e.type));
    const loudest = ['finish', 'level', 'badge', 'item'].find((k) => kinds.has(k));
    if (loudest) Sound.play(SOUND_FOR[loudest]);
    for (const e of fresh) {
      if (e.type !== 'item') { queueToast(e, true); spotlightSoon(e.studentId); }
    }
  }

  const toastQueue = [];
  let toastBusy = false;
  function queueToast(e, silent) {
    toastQueue.push({ ...e, silent });
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const e = toastQueue.shift();
    const el = $('toast');
    if (!e) { toastBusy = false; return; }
    toastBusy = true;
    el.className = `toast ${e.type}`;
    el.textContent = e.type === 'finish' ? `🏆 ${e.text}` : e.type === 'level' ? `LEVEL UP! ${e.text}` : e.text;
    if (!e.silent && (e.type === 'goal' || e.type === 'lead')) Sound.play(e.type);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(nextToast, 300);
    }, 3500);
  }

  // ---------- spotlight (projector auto-tour) ----------

  const spot = { seconds: 0, timer: null, idx: 0, queue: [], active: false };

  function configureSpotlight(seconds) {
    seconds = Math.max(0, Math.min(600, seconds || 0));
    $('spotToggle').setAttribute('aria-pressed', String(seconds > 0));
    if (seconds === spot.seconds) return;
    spot.seconds = seconds;
    clearTimeout(spot.timer);
    if (seconds > 0) spot.timer = setTimeout(spotlightNext, seconds * 1000);
    else if (spot.active) $('detail').close();
  }

  function spotlightSoon(id) {
    if (spot.seconds <= 0 || !id) return;
    spot.queue = [id, ...spot.queue.filter((x) => x !== id)].slice(0, 5);
  }

  function spotlightNext() {
    if (spot.seconds <= 0) return;
    const students = state ? state.students : [];
    if (!students.length || ($('detail').open && !spot.active) || $('gallery').open || $('badgeBook').open) {
      spot.timer = setTimeout(spotlightNext, spot.seconds * 1000);
      return;
    }
    let id = null;
    while (spot.queue.length && !id) {
      const q = spot.queue.shift();
      if (students.some((s) => s.id === q)) id = q;
    }
    if (!id) id = students[spot.idx++ % students.length].id;
    openDetail(id, true);
    spot.timer = setTimeout(() => {
      if (spot.active) $('detail').close();
      spot.timer = setTimeout(spotlightNext, spot.seconds * 1000);
    }, Math.max(6, spot.seconds * 0.6) * 1000);
  }

  // ---------- race track ----------
  //
  // Two layouts share one coordinate system: positions are in "level units"
  // (0 = start, 2.5 = halfway through level 3, nL = finish line).
  //  - lanes: everyone on the same track, so you can compare at a glance. With
  //    many students the lanes split into side-by-side columns to stay readable.
  //  - tiles: each student gets a card showing only the levels around them.

  const TILE_HEAD = 9, SEG = 32, MARGIN = 0.18, GAP = 6, LANE_SEG_MIN = 22;

  function layoutSettings() {
    const d = state.display || {};
    const num = (raw) => (raw === '' || raw === 'all' ? null : Math.max(0, Number(raw) || 0));
    let mode = d.layout === 'cards' ? 'tiles' : 'lanes';
    let before = d.levelsBefore, after = d.levelsAfter;
    if (params.has('before') || params.has('after')) {
      mode = 'tiles';
      if (params.has('before')) before = num(params.get('before'));
      if (params.has('after')) after = num(params.get('after'));
    }
    if (params.get('layout') === 'lanes') mode = 'lanes';
    if (params.get('layout') === 'cards') mode = 'tiles';
    if (before == null && after == null) mode = 'lanes';
    const columns = params.has('columns') ? Math.max(0, Number(params.get('columns')) || 0) : d.laneColumns || 0;
    const calm = (params.get('scenery') || d.scenery) !== 'detailed';
    return { mode, before, after, columns, calm };
  }

  function availableHeight(wrap) {
    return Math.max(240, window.innerHeight - wrap.getBoundingClientRect().top - $('tickerBar').offsetHeight - 2);
  }

  function buildLayout() {
    const wrap = $('trackWrap');
    const width = Math.max(320, wrap.clientWidth);
    const n = Math.max(1, state.students.length);
    const nL = state.levels.length;
    const dpr = window.devicePixelRatio || 1;
    const avail = availableHeight(wrap);
    const cfg = layoutSettings();
    const L = { width, dpr, nL, n, calm: cfg.calm, mode: cfg.mode };

    if (cfg.mode === 'lanes') {
      // Everyone on one track. More columns only when it makes lanes clearly bigger.
      const needU = GUTTER + PAD + FINISH + Math.max(1, nL) * LANE_SEG_MIN;
      const fit = (cols) => {
        const rows = Math.ceil(n / cols);
        const colW = (width - (cols - 1) * GAP) / cols;
        return { cols, rows, colW, u: Math.min(avail / (rows * LANE + HEADER), colW / needU) };
      };
      let best = null;
      if (cfg.columns) best = fit(Math.min(cfg.columns, n));
      else for (let cols = 1; cols <= Math.min(4, n); cols++) { const f = fit(cols); if (!best || f.u > best.u * 1.12) best = f; }
      Object.assign(L, { cols: best.cols, rows: best.rows, colW: best.colW });
      L.u = Math.max(1, Math.min(4, best.u));
      if (width < 700) L.u = Math.min(L.u, 1.5);
      L.gutter = GUTTER * L.u;
      L.trackX = L.gutter + PAD * L.u;
      L.finishW = FINISH * L.u;
      L.segW = (L.colW - L.trackX - L.finishW) / Math.max(1, nL);
      L.laneH = LANE * L.u;
      L.headerH = HEADER * L.u;
      L.height = L.headerH + L.rows * L.laneH;
    } else {
      // Cards: height sets the size; cards stretch to the full width as long as
      // each level stays at least SEG units wide.
      L.before = Math.min(cfg.before == null ? nL : cfg.before, nL);
      L.after = Math.min(cfg.after == null ? nL : cfg.after, nL);
      L.slots = L.before + 1 + L.after;
      const hU = TILE_HEAD + LANE;
      let best = { u: 0, cols: 1 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const segW = (width - (cols + 1) * GAP) / cols / (L.slots + 2 * MARGIN);
        const u = Math.min((avail - (rows + 1) * GAP) / (rows * hU), segW / SEG);
        if (u > best.u + 1e-9) best = { u, cols };
      }
      L.u = Math.max(1, Math.min(4, best.u));
      L.cols = best.cols;
      L.rows = Math.ceil(n / L.cols);
      L.tileW = (width - (L.cols + 1) * GAP) / L.cols;
      L.headH = TILE_HEAD * L.u;
      L.laneH = LANE * L.u;
      L.tileH = L.headH + L.laneH;
      L.segW = L.tileW / (L.slots + 2 * MARGIN);
      L.height = L.rows * L.tileH + (L.rows + 1) * GAP;
    }

    canvas.style.width = `${width}px`;
    canvas.style.height = `${L.height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(L.height * dpr);

    // Obstacles in level units; `half` is how far either side the jump starts.
    L.obstacles = [];
    state.levels.forEach((level, i) => {
      const k = level.items.length;
      const spacing = L.segW / k;
      const ou = Math.max(1, Math.min(L.u, spacing / 11));
      const half = Math.min(7 * L.u, spacing * 0.45) / L.segW;
      level.items.forEach((_, j) => L.obstacles.push({ p: i + (j + 0.5) / k, half, u: ou, level: i }));
    });

    layout = L;
    if (L.mode === 'lanes') {
      L.lanes = [0, 1].map((variant) => renderLane(variant));
      L.header = renderHeader();
    } else {
      L.segments = renderSegments();
    }
  }

  function offscreen(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.imageSmoothingEnabled = false;
    return [c, x];
  }

  function drawLevelObstacles(x, i, x0, groundY) {
    const L = layout;
    const theme = themeFor(i, state.levels[i].theme);
    for (const o of L.obstacles) if (o.level === i) drawObstacle(x, theme, x0 + (o.p - i) * L.segW, groundY, o.u);
  }

  function renderLane(variant) {
    const L = layout;
    const [c, x] = offscreen(L.colW, L.laneH, L.dpr);
    const groundY = L.laneH - GROUND * L.u;
    state.levels.forEach((level, i) => {
      const theme = themeFor(i, level.theme);
      const x0 = i === 0 ? L.gutter : L.trackX + i * L.segW;
      const x1 = L.trackX + (i + 1) * L.segW;
      drawScene(x, theme, x0, 0, x1 - x0, L.laneH, L.u, variant * 101 + i * 7 + 1, GROUND, L.calm);
      if (i > 0) rect(x, x0, 0, Math.max(1, L.u / 2), L.laneH, 'rgba(0,0,0,0.45)');
      drawLevelObstacles(x, i, L.trackX + i * L.segW, groundY);
    });
    drawFinish(x, L.trackX + L.nL * L.segW, 0, L.finishW, L.laneH, L.u, GROUND);
    if (variant === 1) rect(x, L.gutter, 0, L.colW - L.gutter, L.laneH, 'rgba(0,0,0,0.14)'); // zebra rows
    rect(x, 0, 0, L.gutter, L.laneH, variant === 1 ? '#0c0c16' : '#141424');
    rect(x, 0, 0, L.colW, 1, 'rgba(0,0,0,0.6)');
    return c;
  }

  // One pre-drawn picture per level (plus the start area and the finish) that
  // cards stitch together.
  function renderSegments() {
    const L = layout;
    const groundY = L.laneH - GROUND * L.u;
    const make = (draw) => {
      const [c, x] = offscreen(L.segW, L.laneH, L.dpr);
      draw(x);
      return c;
    };
    const levels = state.levels.map((level, i) => make((x) => {
      drawScene(x, themeFor(i, level.theme), 0, 0, L.segW, L.laneH, L.u, i * 7 + 1, GROUND, L.calm);
      rect(x, 0, 0, Math.max(1, L.u / 2), L.laneH, 'rgba(0,0,0,0.45)');
      drawLevelObstacles(x, i, 0, groundY);
    }));
    const start = make((x) => {
      drawScene(x, themeFor(0, state.levels[0] && state.levels[0].theme), 0, 0, L.segW, L.laneH, L.u, 3, GROUND, true);
      rect(x, 0, 0, L.segW, L.laneH, 'rgba(10,10,20,0.45)');
    });
    const finish = make((x) => drawFinish(x, 0, 0, L.segW, L.laneH, L.u, GROUND));
    return { levels, start, finish };
  }

  function fitText(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return t.length > 1 ? `${t}…` : '';
  }

  // Text grows with the track so names stay readable on big screens.
  function fontPx(u) {
    return Math.max(8, Math.min(20, Math.round(u * 5)));
  }

  function renderHeader() {
    const L = layout;
    const [c, x] = offscreen(L.colW, L.headerH, L.dpr);
    rect(x, 0, 0, L.colW, L.headerH, '#101018');
    x.font = `${Math.min(fontPx(L.u), Math.floor(L.headerH * 0.6))}px ${FONT}`;
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

  // Lanes: x within a column for a track position.
  function xOf(p) {
    const L = layout;
    return p <= L.nL ? L.trackX + p * L.segW : L.trackX + L.nL * L.segW + (p - L.nL) * L.finishW;
  }

  // Pixel distance between two track positions, and a step of `px` from p toward target.
  function trackDist(p, q) {
    return layout.mode === 'lanes' ? Math.abs(xOf(q) - xOf(p)) : Math.abs(q - p) * layout.segW;
  }
  function stepToward(p, target, px) {
    const L = layout;
    if (L.mode === 'tiles') return p + Math.sign(target - p) * (px / L.segW);
    const x = xOf(p) + Math.sign(xOf(target) - xOf(p)) * px;
    const end = L.trackX + L.nL * L.segW;
    return x <= end ? (x - L.trackX) / L.segW : L.nL + (x - end) / L.finishW;
  }

  // Detail view: arc over whichever obstacle (in pixels) the character is passing.
  function jumpOffset(x, obstacles, height) {
    for (const o of obstacles) {
      const d = x - (o.x - o.half);
      if (d >= 0 && d <= o.half * 2) return -height * Math.sin((Math.PI * d) / (o.half * 2));
    }
    return 0;
  }

  // Track: the same, in level units.
  function jumpAt(p, height) {
    for (const o of layout.obstacles) {
      const d = p - (o.p - o.half);
      if (d >= 0 && d <= o.half * 2) return -height * Math.sin((Math.PI * d) / (o.half * 2));
    }
    return 0;
  }

  function camTarget(a) {
    return Math.floor(a.pos + 1e-6) - layout.before;
  }

  // Grid cell for a place in the order: lanes fill down each column, cards fill across.
  function cellFor(slot) {
    const L = layout;
    return L.mode === 'lanes' ? { col: Math.floor(slot / L.rows), row: slot % L.rows } : { col: slot % L.cols, row: Math.floor(slot / L.cols) };
  }

  function update(dt, t) {
    const L = layout;
    const ease = Math.min(1, dt * 5);
    for (const a of actors.values()) {
      const cell = cellFor(a.slot);
      if (a.col == null || a.layoutRef !== L) {
        a.col = cell.col; a.row = cell.row; a.layoutRef = L;
        if (L.mode === 'tiles') a.cam = camTarget(a);
      }
      a.col += (cell.col - a.col) * ease;
      a.row += (cell.row - a.row) * ease;
      if (Math.abs(cell.col - a.col) < 0.01) a.col = cell.col;
      if (Math.abs(cell.row - a.row) < 0.01) a.row = cell.row;
      if (L.mode === 'tiles') a.cam += (camTarget(a) - a.cam) * Math.min(1, dt * 3);
      a.hop = Math.max(0, a.hop - dt);
      if (a.delay > 0) { a.delay -= dt; continue; }
      const dist = trackDist(a.pos, a.target);
      if (dist > 0.5) {
        const step = Math.max(40 * L.u, dist * 0.9) * dt;
        a.pos = step >= dist ? a.target : stepToward(a.pos, a.target, step);
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

  // The rectangle a student's scene occupies (lane or card body).
  function sceneBox(a) {
    const L = layout;
    if (L.mode === 'lanes') return { x: a.col * (L.colW + GAP), y: L.headerH + a.row * L.laneH, w: L.colW, h: L.laneH };
    const x = GAP + a.col * (L.tileW + GAP), tileY = GAP + a.row * (L.tileH + GAP);
    return { x, y: tileY + L.headH, w: L.tileW, h: L.laneH, tileY, lo: a.cam - MARGIN };
  }

  function actorFeet(a) {
    const L = layout;
    const box = sceneBox(a);
    const x = L.mode === 'lanes' ? box.x + xOf(a.pos) : box.x + (a.pos - box.lo) * L.segW;
    return { x, y: box.y + L.laneH - GROUND * L.u };
  }

  const CONFETTI = ['#fcd03c', '#f878f8', '#3cdcfc', '#58d854', '#fcfcfc'];
  function burst(x, y, n) {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: (Math.random() - 0.5) * 220, vy: -120 - Math.random() * 160, life: 0.9 + Math.random() * 0.5,
        color: CONFETTI[i % CONFETTI.length] });
    }
  }

  function confetti(n) {
    if (!layout || reduceMotion) return;
    for (let i = 0; i < n / 12; i++) burst(Math.random() * layout.width, Math.random() * Math.min(layout.height, window.innerHeight * 0.6), 12);
  }

  function celebrate(a, lv) {
    const { x, y } = actorFeet(a);
    burst(x, y - 10 * layout.u, 24);
    floaters.push({ actor: a, text: lv >= layout.nL ? 'FINISH!' : `LEVEL ${lv + 1}!`, life: 1.6 });
  }

  function yOffset(a) {
    const u = layout.u;
    if (a.moving) return jumpAt(a.pos, JUMP * u);
    if (a.hop > 0) return -4 * u * Math.sin(Math.PI * (1 - a.hop / 0.35));
    return 0;
  }

  // Returns the label's box so decorations can sit beside it.
  function drawLabel(c, text, cx, bottom, u, color) {
    const fs = fontPx(u);
    c.font = `${fs}px ${FONT}`;
    c.textBaseline = 'alphabetic';
    const w = Math.ceil(c.measureText(text).width);
    const padX = Math.round(fs * 0.35), h = Math.round(fs * 1.6);
    const left = Math.round(cx - w / 2 - padX);
    c.fillStyle = 'rgba(10,10,20,0.85)';
    c.fillRect(left, Math.round(bottom - h), w + padX * 2, h);
    c.fillStyle = color;
    c.fillText(text, left + padX, Math.round(bottom - (h - fs) / 2));
    return { left, top: Math.round(bottom - h), h };
  }

  function rankText(st) {
    if (st.rank) return { text: ordinal(st.rank), color: st.rank === 1 ? '#fcd03c' : st.rank === 2 ? '#c8c8dc' : st.rank === 3 ? '#d88c4c' : '#8c8cb0' };
    return { text: st.finished ? '★' : `L${st.level + 1}`, color: st.finished ? '#fcd03c' : '#8c8cb0' };
  }

  function drawGutter(a) {
    const L = layout;
    const box = sceneBox(a);
    ctx.font = `${Math.min(fontPx(L.u), Math.floor(L.gutter / 4))}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const { text, color } = rankText(a.student);
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(box.x + (L.gutter - ctx.measureText(text).width) / 2), Math.round(box.y + L.laneH / 2));
  }

  function dashedLine(x, y0, y1) {
    const dash = 3 * layout.u;
    ctx.fillStyle = 'rgba(200,200,240,0.55)';
    for (let y = y0; y < y1; y += dash * 2) ctx.fillRect(Math.round(x) - 1, y, 2, Math.min(dash, y1 - y));
  }

  function drawPace(t) {
    const L = layout;
    const pace = state.pace;
    if (!pace || pace.position <= 0) return;
    const bob = Math.sin(t * 2) > 0 ? 0 : L.u;
    for (let c = 0; c < L.cols; c++) {
      const x = c * (L.colW + GAP) + xOf(Math.min(pace.position, L.nL));
      dashedLine(x, L.headerH, L.headerH + Math.min(L.rows, L.n - c * L.rows) * L.laneH);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(renderIcon('pace', L.u * L.dpr), x - 4 * L.u, 2 * L.u + bob - L.u, 8 * L.u, 8 * L.u);
      ctx.globalAlpha = 1;
    }
  }

  function hasBadge(st, key) {
    return (st.badges || []).some((b) => b.key === key);
  }

  const trailColors = new Map();
  function trailColor(index) {
    if (!trailColors.has(index)) trailColors.set(index, window.Sprites.PALETTES[decodeCharacter(index).palette].a);
    return trailColors.get(index);
  }

  // A card: header strip with place and level names, then the stitched scene.
  function drawTile(a, t) {
    const L = layout;
    const box = sceneBox(a);
    const lo = box.lo, hi = lo + L.slots + 2 * MARGIN;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.tileY, box.w, L.tileH);
    ctx.clip();

    rect(ctx, box.x, box.tileY, box.w, L.headH, '#101018');
    for (let k = Math.floor(lo); k < hi; k++) {
      const sx = box.x + (k - lo) * L.segW;
      const img = k < 0 ? L.segments.start : k >= L.nL ? L.segments.finish : L.segments.levels[k];
      ctx.drawImage(img, sx, box.y, L.segW + 0.5, L.laneH);
    }

    ctx.font = `${Math.min(fontPx(L.u), Math.floor(L.headH * 0.7))}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const { text: rk, color: rkColor } = rankText(a.student);
    const rankW = Math.ceil(ctx.measureText(rk).width) + 3 * L.u;
    for (let k = Math.max(0, Math.floor(lo)); k < Math.min(L.nL + 1, hi); k++) {
      const sx = Math.max(box.x + rankW, box.x + (k - lo) * L.segW);
      const ex = box.x + (k + 1 - lo) * L.segW;
      if (ex - sx < 12) continue;
      const theme = k < L.nL ? themeFor(k, state.levels[k].theme) : null;
      const color = theme ? theme.label : '#fcd03c';
      rect(ctx, sx, box.y - L.u, ex - sx, L.u, color);
      ctx.fillStyle = color;
      ctx.fillText(fitText(ctx, k < L.nL ? `${k + 1} ${state.levels[k].name}` : 'GOAL', ex - sx - 2 * L.u), sx + L.u, box.tileY + (L.headH - L.u) / 2);
    }
    ctx.fillStyle = rkColor;
    ctx.fillText(rk, box.x + L.u * 1.5, box.tileY + (L.headH - L.u) / 2);

    const pace = state.pace;
    if (pace && pace.position > 0 && pace.position > lo && pace.position < hi) {
      dashedLine(box.x + (Math.min(pace.position, L.nL) - lo) * L.segW, box.y, box.y + L.laneH);
    }
    drawActor(a, t, box.x);
    ctx.restore();
  }

  // `trailStart` is where this student's progress trail begins.
  function drawActor(a, t, trailStart) {
    const L = layout;
    const st = a.student;
    const { x, y } = actorFeet(a);
    if (x > trailStart) {
      // A bright trail along the ground from the start line: reads like a bar chart.
      rect(ctx, trailStart, y - L.u, x - trailStart, L.u * 3, 'rgba(0,0,0,0.55)');
      rect(ctx, trailStart, y - L.u * 0.5, x - trailStart, L.u * 2, trailColor(st.character));
    }
    const jy = yOffset(a);
    const frame = a.moving ? Math.floor(a.walk * 8) % 2 : 0;
    const bob = !a.moving && a.hop === 0 && Math.sin(t * 3 + a.phase) > 0.85 ? -L.u : 0;
    const top = y - 16 * L.u + jy + bob;
    if (hasBadge(st, 'onfire') && !reduceMotion) {
      const flick = Math.sin(t * 14 + a.phase) > 0 ? 0 : L.u;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(renderIcon('onfire', L.u * L.dpr), Math.round(x - 15 * L.u), Math.round(top + 7 * L.u + flick), 8 * L.u, 8 * L.u - flick);
      ctx.globalAlpha = 1;
    }
    if (jy < 0) rect(ctx, x - 5 * L.u, y - L.u, 10 * L.u, L.u, 'rgba(0,0,0,0.35)');
    ctx.drawImage(renderSprite(st.character, frame, L.u * L.dpr), Math.round(x - 8 * L.u), Math.round(top), 16 * L.u, 16 * L.u);
    const color = a.id === selectedId ? '#3cdcfc' : st.rank === 1 ? '#fcd03c' : '#ffffff';
    const lbl = drawLabel(ctx, st.name, x, top - L.u, L.u, color);
    if (st.rank === 1) ctx.drawImage(renderIcon('crown', L.u * L.dpr), lbl.left - 9 * L.u, lbl.top + lbl.h / 2 - 2.5 * L.u, 8 * L.u, 5 * L.u);
  }

  function draw(t) {
    const L = layout;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, L.width, L.height);
    const list = [...actors.values()].sort((a, b) => a.slot - b.slot);

    if (L.mode === 'lanes') {
      for (let c = 0; c < L.cols; c++) {
        const cx = c * (L.colW + GAP);
        ctx.drawImage(L.header, cx, 0, L.colW, L.headerH);
        for (let r = 0; r < L.rows && c * L.rows + r < L.n; r++) ctx.drawImage(L.lanes[r % 2], cx, L.headerH + r * L.laneH, L.colW, L.laneH);
      }
      drawPace(t);
      for (const a of list) drawGutter(a);
      for (const a of list) drawActor(a, t, sceneBox(a).x + L.trackX);
    } else {
      for (const a of list) drawTile(a, t);
    }

    const hover = list.find((a) => a.id === hoverId);
    if (hover) {
      const box = sceneBox(hover);
      ctx.strokeStyle = '#3cdcfc';
      ctx.lineWidth = 2;
      if (L.mode === 'lanes') ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, L.laneH - 2);
      else ctx.strokeRect(box.x + 1, box.tileY + 1, box.w - 2, L.tileH - 2);
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

  // Which student is under a point on the track canvas.
  function studentAt(px, py) {
    const L = layout;
    if (!L || !state) return null;
    let slot;
    if (L.mode === 'lanes') {
      const col = Math.floor(px / (L.colW + GAP));
      const row = Math.floor((py - L.headerH) / L.laneH);
      if (py < L.headerH || row >= L.rows || col < 0 || col >= L.cols) return null;
      slot = col * L.rows + row;
    } else {
      const col = Math.floor((px - GAP / 2) / (L.tileW + GAP));
      const row = Math.floor((py - GAP / 2) / (L.tileH + GAP));
      if (col < 0 || col >= L.cols || row < 0) return null;
      slot = row * L.cols + col;
    }
    return state.students[slot] || null;
  }

  // ---------- student detail ----------

  function openDetail(id, fromSpotlight) {
    selectedId = id;
    spot.active = !!fromSpotlight;
    renderDetail(true);
    const dlg = $('detail');
    dlg.classList.toggle('spotlight', !!fromSpotlight);
    if (!dlg.open) dlg.showModal();
  }

  function formatDue(iso) {
    const d = new Date(iso);
    const days = Math.round((d - Date.now()) / 86400000);
    const when = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (days === 0) return `due today`;
    if (days === 1) return `due tomorrow`;
    return days < 0 ? `was due ${when}` : `due ${when}`;
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
    const place = st.rank ? `${ordinal(st.rank)} place of ${state.students.length} · ` : '';
    $('dSub').textContent = `${place}${st.done}/${st.total} challenges · ${pct}% of the quest`;

    const hl = $('dHighlights');
    const bits = [];
    if (st.ahead) bits.push(`⚡ ${st.ahead} ahead of pace!`);
    const doneIds = st.finished ? new Set() : new Set((st.levels[li].doneItemIds || []).map(String));
    const next = st.finished ? null : level.items.find((i) => !doneIds.has(String(i.id)));
    if (next) bits.push(`Next up: ${next.title}${next.dueAt ? ` (${formatDue(next.dueAt)})` : ''}`);
    hl.textContent = bits.join('   ·   ');
    hl.hidden = !bits.length;

    $('dBar').style.width = `${pct}%`;
    renderBadgeCase(st);

    const items = $('dItems');
    if (st.finished) {
      $('dLevelTitle').textContent = 'Quest complete! 🏆';
      items.replaceChildren();
    } else {
      const theme = themeFor(li, level.theme);
      $('dLevelTitle').textContent = `Level ${li + 1}: ${level.name} (${theme.name})`;
      items.replaceChildren(...level.items.map((item, j) => {
        const el = document.createElement('li');
        const done = doneIds.has(String(item.id));
        el.className = done ? 'done' : 'todo';
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = done ? '✓' : String(j + 1);
        el.append(mark, item.title);
        if (!done && item.dueAt) {
          const due = document.createElement('span');
          due.className = 'count';
          due.textContent = formatDue(item.dueAt);
          el.append(due);
        }
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

  // Badges this student earned in the last few minutes get a NEW tag.
  function recentBadges(studentId) {
    const cutoff = Date.now() - 15 * 60 * 1000;
    return new Set((state.events || []).filter((e) => e.type === 'badge' && e.studentId === studentId && e.ts >= cutoff).map((e) => e.badge));
  }

  // Every badge on offer: earned ones lit up first, the rest locked with how to earn them.
  function renderBadgeCase(st) {
    const earned = new Map((st.badges || []).map((b) => [b.key, b]));
    const fresh = recentBadges(st.id);
    const all = state.badges || [];
    const ordered = [...all.filter((b) => earned.has(b.key)), ...all.filter((b) => !earned.has(b.key))];
    $('dCaseTitle').textContent = `Badges · ${earned.size} of ${all.length}`;
    $('dCase').replaceChildren(...ordered.map((b) => {
      const got = earned.get(b.key);
      const li = document.createElement('li');
      li.className = got ? `earned${fresh.has(b.key) ? ' fresh' : ''}` : 'locked';
      const img = document.createElement('img');
      img.src = iconUrl(got ? b.key : 'lock');
      img.alt = '';
      const name = document.createElement('strong');
      name.textContent = `${b.label}${got && got.count > 1 ? ` ×${got.count}` : ''}`;
      const how = document.createElement('small');
      how.textContent = b.desc;
      li.append(img, name, how);
      if (fresh.has(b.key)) {
        const tag = document.createElement('span');
        tag.className = 'new-tag';
        tag.textContent = 'NEW!';
        li.append(tag);
      }
      li.setAttribute('aria-label', `${b.label}: ${got ? 'earned' : 'not yet earned'}. ${b.desc}`);
      return li;
    }));
  }

  function openBadgeBook() {
    const students = state ? state.students : [];
    $('badgeBookList').replaceChildren(...(state ? state.badges : []).map((b) => {
      const holders = students.filter((s) => (s.badges || []).some((x) => x.key === b.key));
      const row = document.createElement('div');
      row.className = 'book-row';
      const img = document.createElement('img');
      img.src = iconUrl(b.key);
      img.alt = '';
      const text = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = b.label;
      const how = document.createElement('p');
      how.textContent = b.desc;
      text.append(name, how);
      const who = document.createElement('div');
      who.className = 'book-who';
      const count = document.createElement('span');
      count.textContent = holders.length ? `${holders.length} earned` : 'Be the first!';
      who.append(count);
      for (const h of holders.slice(0, 12)) {
        const face = document.createElement('img');
        face.src = spriteUrl(h.character);
        face.alt = h.name;
        face.title = h.name;
        who.append(face);
      }
      if (holders.length > 12) who.append(`+${holders.length - 12}`);
      row.append(img, text, who);
      return row;
    }));
    $('badgeBook').showModal();
  }

  function drawDetail(dt, t) {
    const st = state && state.students.find((s) => s.id === selectedId);
    if (!st || !detailRun) return;
    const availW = scene.parentElement.clientWidth - 8;
    if (availW <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const UNITS_W = 220, UNITS_H = 80;
    // Fit the width, but leave room for the checklist on short projector screens.
    // In spotlight the badge case is the star, so the scene gets less room.
    const share = $('detail').classList.contains('spotlight') ? 0.2 : 0.3;
    const u = Math.min(availW / UNITS_W, Math.max(1.5, (window.innerHeight * share) / UNITS_H));
    const cssW = Math.round(UNITS_W * u);
    const cssH = Math.round(UNITS_H * u);
    if (scene.width !== Math.round(cssW * dpr) || scene.height !== Math.round(cssH * dpr)) {
      scene.width = Math.round(cssW * dpr);
      scene.height = Math.round(cssH * dpr);
      scene.style.width = `${cssW}px`;
      scene.style.height = `${cssH}px`;
    }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.imageSmoothingEnabled = false;
    const groundY = cssH - 10 * u;
    const startX = 24 * u, endX = cssW - 24 * u, span = endX - startX;
    const nL = state.levels.length;
    const li = Math.min(st.level, nL - 1);
    const obstacles = [];

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
        fig.append(img, cap);
        grid.appendChild(fig);
      }
    }
    $('gallery').showModal();
  }

  // ---------- wiring ----------

  canvas.addEventListener('mousemove', (e) => {
    const st = studentAt(e.offsetX, e.offsetY);
    hoverId = st ? st.id : null;
  });
  canvas.addEventListener('mouseleave', () => { hoverId = null; });
  canvas.addEventListener('click', (e) => {
    const st = studentAt(e.offsetX, e.offsetY);
    if (st) openDetail(st.id);
  });
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close();
    });
  }
  $('detail').addEventListener('close', () => { selectedId = null; detailRun = null; spot.active = false; });
  $('galleryLink').addEventListener('click', (e) => { e.preventDefault(); openGallery(); });
  $('badgeLink').addEventListener('click', (e) => { e.preventDefault(); if (state) openBadgeBook(); });
  $('boardToggle').addEventListener('click', () => {
    boardOverride = $('boardToggle').getAttribute('aria-pressed') !== 'true';
    setBoard(boardOverride);
  });
  $('soundToggle').addEventListener('click', () => {
    setSound(!Sound.on, true);
    Sound.play('coin');
  });
  $('spotToggle').addEventListener('click', () => {
    const on = $('spotToggle').getAttribute('aria-pressed') === 'true';
    configureSpotlight(on ? 0 : (state && state.display.spotlightSeconds) || 20);
  });
  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => { layout = null; });
  $('viewPicker').addEventListener('change', (e) => {
    viewId = e.target.value;
    const url = new URL(location.href);
    url.searchParams.set('view', viewId);
    history.replaceState(null, '', url);
    poll();
  });
  const unlock = () => Sound.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
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
