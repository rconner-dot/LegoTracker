// Level themes ("worlds") and the procedural 8-bit scenery for each one.
(function (root, factory) {
  const api = factory(root.Sprites || (typeof require !== 'undefined' ? require('./sprites.js') : null));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Worlds = api;
})(typeof self !== 'undefined' ? self : this, function (Sprites) {
  'use strict';

  const THEMES = [
    { key: 'hills', name: 'Green Hills', sky: ['#5c94fc', '#7ca8fc', '#9cc0fc'], far: '#2e8b3a', far2: '#58c858', kind: 'hills',
      ground: '#c84c0c', groundTop: '#58d854', groundDots: '#7c2c00', obstacle: 'pipe', label: '#58d854' },
    { key: 'desert', name: 'Sunset Dunes', sky: ['#f87858', '#fca044', '#f8b800'], far: '#d8803c', far2: '#e8a050', kind: 'dunes',
      ground: '#e4b860', groundTop: '#fce0a8', groundDots: '#c08838', obstacle: 'cactus', label: '#fca044' },
    { key: 'ice', name: 'Frost Peaks', sky: ['#3cbcfc', '#7cd4fc', '#bce8fc'], far: '#8098c8', far2: '#ffffff', kind: 'mountains',
      ground: '#a4e4fc', groundTop: '#ffffff', groundDots: '#78b8e8', obstacle: 'ice', label: '#a4e4fc' },
    { key: 'cyber', name: 'Neon Circuit', sky: ['#0c0c24', '#1a1040', '#2c1860'], far: '#241c58', far2: '#00e8d8', kind: 'city',
      ground: '#181830', groundTop: '#f878f8', groundDots: '#00e8d8', obstacle: 'firewall', label: '#f878f8' },
    { key: 'lava', name: 'Lava Forge', sky: ['#300808', '#581010', '#881400'], far: '#3c1c14', far2: '#f83800', kind: 'volcano',
      ground: '#3c2018', groundTop: '#f83800', groundDots: '#fca044', obstacle: 'rock', label: '#f83800' },
    { key: 'ocean', name: 'Coral Deep', sky: ['#003c80', '#0058b0', '#0070d0'], far: '#00a088', far2: '#a4e4fc', kind: 'ocean',
      ground: '#e8d098', groundTop: '#f8e8b8', groundDots: '#c8a868', obstacle: 'coral', label: '#3cbcfc' },
    { key: 'space', name: 'Star Station', sky: ['#000000', '#080818', '#101030'], far: '#a05cfc', far2: '#fcfcfc', kind: 'space',
      ground: '#787878', groundTop: '#bcbcbc', groundDots: '#505050', obstacle: 'crate', label: '#bcbcbc' },
    { key: 'castle', name: 'Byte Castle', sky: ['#200838', '#381060', '#502080'], far: '#281040', far2: '#fcfcb0', kind: 'castle',
      ground: '#605870', groundTop: '#9890a8', groundDots: '#403848', obstacle: 'spikes', label: '#c8a0fc' },
  ];

  function themeFor(levelIndex, override) {
    if (override) {
      const t = THEMES.find((x) => x.key === override);
      if (t) return t;
    }
    return THEMES[((levelIndex % THEMES.length) + THEMES.length) % THEMES.length];
  }

  // 8x8 obstacle bitmaps. 'k' is the outline unless the palette overrides it.
  const OBSTACLES = {
    pipe: { rows: ['kkkkkkkk', 'kcaaaabk', 'kkkkkkkk', '.kcaabk.', '.kcaabk.', '.kcaabk.', '.kcaabk.', '.kcaabk.'],
      colors: { k: '#101018', a: '#00a800', b: '#005800', c: '#b8f818' } },
    cactus: { rows: ['...kk...', '..kabk..', 'k.kabk..', 'kbkabk.k', 'kbkabkbk', '.kkabkbk', '..kabkk.', '..kabk..'],
      colors: { k: '#0c4c0c', a: '#38b838', b: '#1c7c1c' } },
    ice: { rows: ['...kk...', '...kck..', '..kcak..', '..kcaak.', '.kcaabk.', '.kcaabk.', 'kcaaabbk', 'kkkkkkkk'],
      colors: { k: '#1c5c9c', a: '#a4e4fc', b: '#3cbcfc', c: '#ffffff' } },
    firewall: { rows: ['kkkkkkkk', 'kakaaaak', 'kkkkkkkk', 'kaaakaak', 'kkkkkkkk', 'kakaaaak', 'kkkkkkkk', 'kaaakaak'],
      colors: { k: '#f878f8', a: '#2c0c48' } },
    rock: { rows: ['..kkkk..', '.kaaack.', 'kaaaacck', 'kaaaaaak', 'kbaaaaak', 'kbbaaabk', 'kbbbbbbk', '.kkkkkk.'],
      colors: { k: '#101018', a: '#7c4c2c', b: '#4c2c1c', c: '#fca044' } },
    coral: { rows: ['k..k...k', 'a..a..ka', 'ak.a.kak', '.akakak.', '..aaak..', '...ak...', '..kaak..', '.kaaaak.'],
      colors: { k: '#a01c3c', a: '#fc5c7c' } },
    crate: { rows: ['kkkkkkkk', 'kbaaaabk', 'kabaabak', 'kaabbaak', 'kaabbaak', 'kabaabak', 'kbaaaabk', 'kkkkkkkk'],
      colors: { k: '#101018', a: '#9c9cac', b: '#5c5c6c' } },
    spikes: { rows: ['..k...k.', '..k...k.', '.kck.kck', '.kak.kak', 'kaaakaaa', 'kaaakaaa', 'kkkkkkkk', 'kbbbbbbk'],
      colors: { k: '#101018', a: '#bcbcbc', b: '#605870', c: '#ffffff' } },
  };
  const TROPHY = { rows: ['kkkkkkkk', 'kacaaaak', 'kacaaaak', '.kaaaak.', '..kaak..', '...kk...', '..kaak..', '.kkkkkk.'],
    colors: { k: '#101018', a: '#fcd03c', c: '#fff8c0' } };
  const FLAG_DONE = { rows: ['kaaa', 'kaaa', 'k...', 'k...'], colors: { k: '#fcfcfc', a: '#3cc83c' } };

  function rng(seed) {
    let t = (seed >>> 0) + 0x6d2b79f5;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    const x0 = Math.round(x), y0 = Math.round(y);
    ctx.fillRect(x0, y0, Math.round(x + w) - x0, Math.round(y + h) - y0);
  }

  // Draw a filled shape column by column (stepped, like real 8-bit art).
  // heightAt(dx) returns the column height in px for an offset from the shape's left edge.
  function columns(ctx, left, width, baseY, u, color, heightAt) {
    for (let dx = 0; dx < width; dx += u) {
      const h = Math.round(heightAt(dx + u / 2) / u) * u;
      if (h > 0) rect(ctx, left + dx, baseY - h, u, h, color);
    }
  }

  function cloud(ctx, x, y, u, color) {
    rect(ctx, x + 2 * u, y, 4 * u, u, color);
    rect(ctx, x + u, y + u, 7 * u, u, color);
    rect(ctx, x, y + 2 * u, 10 * u, 2 * u, color);
  }

  const FAR = {
    hills(ctx, t, x, y, w, h, u, r) {
      for (let i = 0; i < Math.max(1, Math.ceil(w / (40 * u))); i++) cloud(ctx, x + r() * w, y + u * 2 + r() * h * 0.3, u, '#fcfcfc');
      const n = Math.max(1, Math.round(w / (36 * u)));
      for (let i = 0; i < n; i++) {
        const rad = (10 + r() * 14) * u, cx = x + (i + r()) * (w / n);
        columns(ctx, cx - rad, rad * 2, y + h, u, i % 2 ? t.far : t.far2, (dx) => Math.sqrt(Math.max(0, rad * rad - (dx - rad) ** 2)) * 0.8);
      }
    },
    dunes(ctx, t, x, y, w, h, u, r) {
      rect(ctx, x + w * (0.2 + r() * 0.6), y + h * 0.15, 8 * u, 8 * u, '#fce060');
      const p = r() * 6;
      columns(ctx, x, w, y + h, u, t.far2, (dx) => h * 0.35 + Math.sin(dx / (22 * u) + p) * 5 * u);
      columns(ctx, x, w, y + h, u, t.far, (dx) => h * 0.18 + Math.sin(dx / (14 * u) + p * 2) * 3 * u);
    },
    mountains(ctx, t, x, y, w, h, u, r) {
      const n = Math.max(1, Math.round(w / (34 * u)));
      for (let i = 0; i < n; i++) {
        const peak = h * (0.5 + r() * 0.4), half = (14 + r() * 10) * u, cx = x + (i + r()) * (w / n);
        columns(ctx, cx - half, half * 2, y + h, u, t.far, (dx) => peak * (1 - Math.abs(dx - half) / half));
        columns(ctx, cx - half * 0.3, half * 0.6, y + h - peak * 0.7, u, t.far2, (dx) => peak * 0.3 * (1 - Math.abs(dx - half * 0.3) / (half * 0.3)));
      }
    },
    city(ctx, t, x, y, w, h, u, r) {
      for (let i = 0; i < w / (6 * u); i++) rect(ctx, x + r() * w, y + r() * h * 0.5, u, u, '#5c4c9c');
      let cx = x;
      while (cx < x + w) {
        const bw = (6 + Math.floor(r() * 6)) * u, bh = h * (0.3 + r() * 0.55);
        rect(ctx, cx, y + h - bh, bw - u, bh, t.far);
        for (let wy = y + h - bh + 2 * u; wy < y + h - 2 * u; wy += 3 * u)
          for (let wx = cx + u; wx < cx + bw - 2 * u; wx += 2 * u) if (r() < 0.35) rect(ctx, wx, wy, u, u, r() < 0.5 ? t.far2 : '#f878f8');
        cx += bw;
      }
    },
    volcano(ctx, t, x, y, w, h, u, r) {
      const half = Math.min(w * 0.35, 30 * u), cx = x + w * (0.3 + r() * 0.4), peak = h * 0.75;
      columns(ctx, cx - half, half * 2, y + h, u, t.far, (dx) => Math.min(peak, peak * (1.15 - Math.abs(dx - half) / half)));
      rect(ctx, cx - 3 * u, y + h - peak, 6 * u, u, t.far2);
      for (let i = 0; i < w / (10 * u); i++) rect(ctx, x + r() * w, y + r() * h * 0.8, u, u, r() < 0.5 ? '#fca044' : t.far2);
    },
    ocean(ctx, t, x, y, w, h, u, r) {
      for (let i = 0; i < w / (12 * u); i++) {
        const bx = x + r() * w, by = y + r() * h * 0.8;
        rect(ctx, bx, by, 2 * u, u, t.far2); rect(ctx, bx - u, by + u, u, u, t.far2); rect(ctx, bx + 2 * u, by + u, u, u, t.far2); rect(ctx, bx, by + 2 * u, 2 * u, u, t.far2);
      }
      for (let i = 0; i < w / (14 * u); i++) {
        const kx = x + r() * w, kh = h * (0.3 + r() * 0.5), ph = r() * 6;
        for (let ky = 0; ky < kh; ky += u) rect(ctx, kx + Math.round(Math.sin(ky / (3 * u) + ph)) * u, y + h - ky - u, u * 2, u, t.far);
      }
    },
    space(ctx, t, x, y, w, h, u, r) {
      for (let i = 0; i < w / (4 * u); i++) rect(ctx, x + r() * w, y + r() * h, u, u, r() < 0.8 ? '#fcfcfc' : '#fce060');
      const pr = 7 * u, px = x + w * (0.2 + r() * 0.6), py = y + h * 0.4;
      for (let dx = -pr; dx < pr; dx += u) {
        const half = Math.round(Math.sqrt(Math.max(0, pr * pr - (dx + u / 2) ** 2)) / u) * u;
        rect(ctx, px + dx, py - half, u, half * 2, t.far);
      }
      rect(ctx, px - pr - 3 * u, py, pr * 2 + 6 * u, u, '#fcd03c');
    },
    castle(ctx, t, x, y, w, h, u, r) {
      rect(ctx, x + w * (0.1 + r() * 0.8), y + h * 0.12, 6 * u, 6 * u, t.far2);
      for (let i = 0; i < w / (8 * u); i++) rect(ctx, x + r() * w, y + r() * h * 0.5, u, u, '#fcfcfc');
      let cx = x + r() * 10 * u;
      while (cx < x + w) {
        const tw = (6 + Math.floor(r() * 4)) * u, th = h * (0.35 + r() * 0.45);
        rect(ctx, cx, y + h - th, tw, th, t.far);
        for (let bx = cx; bx < cx + tw; bx += 2 * u) rect(ctx, bx, y + h - th - u, u, u, t.far);
        rect(ctx, cx + tw / 2 - u / 2, y + h - th * 0.7, u, 2 * u, '#fcd03c');
        cx += tw + (4 + r() * 10) * u;
      }
      rect(ctx, x, y + h - h * 0.25, w, h * 0.25, t.far);
    },
  };

  // Paint a full scene (sky, distant scenery, ground) into a rectangle.
  function drawScene(ctx, theme, x, y, w, h, u, seed, groundUnits) {
    const r = rng(seed * 9973 + 17);
    const groundH = (groundUnits || 5) * u;
    const skyH = h - groundH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const bands = theme.sky, bandH = skyH / bands.length;
    bands.forEach((c, i) => rect(ctx, x, y + i * bandH, w, bandH + 1, c));
    for (let i = 1; i < bands.length; i++) {
      const by = y + i * bandH;
      for (let dx = 0; dx < w; dx += 2 * u) {
        rect(ctx, x + dx, by - u, u, u, bands[i]);
        rect(ctx, x + dx + u, by, u, u, bands[i - 1]);
      }
    }
    FAR[theme.kind](ctx, theme, x, y, w, skyH, u, r);
    rect(ctx, x, y + skyH, w, groundH, theme.ground);
    rect(ctx, x, y + skyH, w, u, theme.groundTop);
    for (let gy = y + skyH + 2 * u; gy < y + h - u; gy += 2 * u)
      for (let gx = x + ((gy / u) % 4) * u; gx < x + w; gx += 4 * u) if (r() < 0.5) rect(ctx, gx, gy, u, u, theme.groundDots);
    ctx.restore();
  }

  // Obstacle centred on cx, sitting on groundY.
  function drawObstacle(ctx, theme, cx, groundY, u) {
    const o = OBSTACLES[theme.obstacle];
    Sprites.drawBitmap(ctx, o.rows, o.colors, cx - 4 * u, groundY - 8 * u, u);
  }

  function drawDoneFlag(ctx, cx, groundY, u) {
    Sprites.drawBitmap(ctx, FLAG_DONE.rows, FLAG_DONE.colors, cx + 4 * u, groundY - 12 * u, u);
  }

  function drawTrophy(ctx, cx, groundY, u) {
    Sprites.drawBitmap(ctx, TROPHY.rows, TROPHY.colors, cx - 4 * u, groundY - 8 * u, u);
  }

  // Checkered finish zone with a flag.
  function drawFinish(ctx, x, y, w, h, u, groundUnits) {
    const groundH = (groundUnits || 5) * u;
    const r = rng(Math.round(w * 31 + h));
    rect(ctx, x, y, w, h, '#181830');
    for (let i = 0; i < w / (3 * u); i++) rect(ctx, x + r() * w, y + r() * (h - groundH), u, u, r() < 0.7 ? '#fce060' : '#fcfcfc');
    for (let row = 0; row * u < groundH; row++)
      for (let col = 0; col * u < w; col++) rect(ctx, x + col * u, y + h - groundH + row * u, u, u, (row + col) % 2 ? '#101018' : '#fcfcfc');
    const pole = x + 3 * u;
    rect(ctx, pole, y + 2 * u, u, h - groundH - 2 * u, '#bcbcbc');
    for (let fy = 0; fy < 4; fy++)
      for (let fx = 0; fx < 6; fx++) rect(ctx, pole + u + fx * u, y + 2 * u + fy * u, u, u, (fx + fy) % 2 ? '#101018' : '#fcfcfc');
  }

  return { THEMES, themeFor, drawScene, drawObstacle, drawDoneFlag, drawTrophy, drawFinish, rect };
});
