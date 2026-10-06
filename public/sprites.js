// 8-bit character sprites. Loaded by the browser (window.Sprites) and by the
// server (require) so both agree on how many characters exist.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sprites = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Each frame is 16x16. Letters map to palette slots:
  //   k outline, a main colour, b accent, e eyes/screen, w white, g metal grey, s skin
  const FAMILIES = {
    robot: {
      label: 'Robot',
      frames: [
        [
          '.......ee.......',
          '.......kk.......',
          '...kkkkkkkkkk...',
          '...kwaaaaaaak...',
          '...kaeeaaeeak...',
          '...kaeeaaeeak...',
          '...kaaaaaaaak...',
          '...kabbbbbbak...',
          '...kkkkkkkkkk...',
          '..kgkaaaaaakgk..',
          '..kgkabeebakgk..',
          '..kgkaaaaaakgk..',
          '...kkkkkkkkkk...',
          '....kgk..kgk....',
          '....kgk..kgk....',
          '...kkkk..kkkk...',
        ],
        [
          '.......ee.......',
          '.......kk.......',
          '...kkkkkkkkkk...',
          '...kwaaaaaaak...',
          '...kaeeaaeeak...',
          '...kaeeaaeeak...',
          '...kaaaaaaaak...',
          '...kabbbbbbak...',
          '...kkkkkkkkkk...',
          '..kgkaaaaaakgk..',
          '..kgkabeebakgk..',
          '..kgkaaaaaakgk..',
          '...kkkkkkkkkk...',
          '...kgk....kgk...',
          '...kgk....kgk...',
          '..kkkk....kkkk..',
        ],
      ],
    },
    computer: {
      label: 'Computer',
      frames: [
        [
          '................',
          '..kkkkkkkkkkkk..',
          '..kaaaaaaaaaak..',
          '..kakkkkkkkkak..',
          '..kakeeeeeekak..',
          '..kakeweewekak..',
          '..kakeeeeeekak..',
          '..kakewwwwekak..',
          '..kakeeeeeekak..',
          '..kakkkkkkkkak..',
          '..kaaaaaaabaak..',
          '..kkkkkkkkkkkk..',
          '.....kbbbbk.....',
          '....kgk..kgk....',
          '....kgk..kgk....',
          '...kkkk..kkkk...',
        ],
        [
          '................',
          '..kkkkkkkkkkkk..',
          '..kaaaaaaaaaak..',
          '..kakkkkkkkkak..',
          '..kakeeeeeekak..',
          '..kakeweewekak..',
          '..kakeeeeeekak..',
          '..kakewwwwekak..',
          '..kakeeeeeekak..',
          '..kakkkkkkkkak..',
          '..kaaaaaaabaak..',
          '..kkkkkkkkkkkk..',
          '.....kbbbbk.....',
          '...kgk....kgk...',
          '...kgk....kgk...',
          '..kkkk....kkkk..',
        ],
      ],
    },
    brick: {
      label: 'Brick Figure',
      frames: [
        [
          '......kkkk......',
          '.....kssssk.....',
          '....kssssssk....',
          '...kssssssssk...',
          '...kssksskssk...',
          '...kssssssssk...',
          '...ksskkkkssk...',
          '....kssssssk....',
          '..kkkkkkkkkkkk..',
          '.kaakaaaaaakaak.',
          '.kaakabbbbakaak.',
          '.ksskaaaaaakssk.',
          '....kkkkkkkk....',
          '....kbbkkbbk....',
          '....kbbkkbbk....',
          '....kkkkkkkk....',
        ],
        [
          '......kkkk......',
          '.....kssssk.....',
          '....kssssssk....',
          '...kssssssssk...',
          '...kssksskssk...',
          '...kssssssssk...',
          '...ksskkkkssk...',
          '....kssssssk....',
          '..kkkkkkkkkkkk..',
          '.kaakaaaaaakaak.',
          '.kaakabbbbakaak.',
          '.ksskaaaaaakssk.',
          '....kkkkkkkk....',
          '...kbbk..kbbk...',
          '...kbbk..kbbk...',
          '...kkkk..kkkk...',
        ],
      ],
    },
  };
  const FAMILY_KEYS = Object.keys(FAMILIES);

  const PALETTES = [
    { name: 'Red', a: '#e83c3c', b: '#8c1c1c', e: '#fce060' },
    { name: 'Blue', a: '#3c7cfc', b: '#1c3c9c', e: '#7cfcfc' },
    { name: 'Green', a: '#3cc83c', b: '#1c7c1c', e: '#fcfc7c' },
    { name: 'Gold', a: '#fcd03c', b: '#b08810', e: '#fc5c5c' },
    { name: 'Purple', a: '#a05cfc', b: '#5c2c9c', e: '#7cfc9c' },
    { name: 'Orange', a: '#fc8c2c', b: '#a04c0c', e: '#7cdcfc' },
    { name: 'Teal', a: '#2cc8b8', b: '#0c7c70', e: '#fc7cdc' },
    { name: 'Pink', a: '#fc7cc8', b: '#a03c7c', e: '#fcfcfc' },
    { name: 'Silver', a: '#bcbcc8', b: '#6c6c7c', e: '#fc3c3c' },
    { name: 'Navy', a: '#2c3c8c', b: '#fcfcfc', e: '#fcd03c' },
    { name: 'Lime', a: '#a8f03c', b: '#4c8c1c', e: '#fc5ce0' },
    { name: 'Tan', a: '#c8945c', b: '#7c4c2c', e: '#3cfcfc' },
  ];
  const SHARED = { k: '#101018', w: '#ffffff', g: '#8c8c9c', s: '#fcd000' };

  const CHARACTER_COUNT = FAMILY_KEYS.length * PALETTES.length;

  function decodeCharacter(index) {
    const i = ((Number(index) % CHARACTER_COUNT) + CHARACTER_COUNT) % CHARACTER_COUNT;
    const family = FAMILY_KEYS[i % FAMILY_KEYS.length];
    const palette = Math.floor(i / FAMILY_KEYS.length);
    return { index: i, family, palette, label: `${PALETTES[palette].name} ${FAMILIES[family].label}`, spec: `${family}-${palette + 1}` };
  }

  // Accepts 7, "7", or "robot-3" (palette numbers start at 1). Returns an index or null.
  function parseCharacterSpec(spec) {
    if (spec == null || spec === '') return null;
    if (/^\d+$/.test(String(spec))) {
      const n = Number(spec);
      return n < CHARACTER_COUNT ? n : null;
    }
    const m = String(spec).trim().toLowerCase().match(/^([a-z]+)-(\d+)$/);
    if (!m) return null;
    const f = FAMILY_KEYS.indexOf(m[1]);
    const p = Number(m[2]) - 1;
    if (f < 0 || p < 0 || p >= PALETTES.length) return null;
    return p * FAMILY_KEYS.length + f;
  }

  function colorsFor(index) {
    const { family, palette } = decodeCharacter(index);
    return { rows: FAMILIES[family].frames, colors: Object.assign({}, SHARED, PALETTES[palette]) };
  }

  // Draw a string bitmap. `colors` maps letters to CSS colours; '.' is transparent.
  function drawBitmap(ctx, rows, colors, x, y, u) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      let c = 0;
      while (c < row.length) {
        const ch = row[c];
        let run = 1;
        while (c + run < row.length && row[c + run] === ch) run++;
        const color = colors[ch];
        if (ch !== '.' && color) {
          ctx.fillStyle = color;
          ctx.fillRect(Math.round(x + c * u), Math.round(y + r * u), Math.round(x + (c + run) * u) - Math.round(x + c * u), Math.round(y + (r + 1) * u) - Math.round(y + r * u));
        }
        c += run;
      }
    }
  }

  // 8x8 icons for badges and decorations.
  const ICONS = {
    champion: { rows: ['kkkkkkkk', 'kacaaaak', 'kacaaaak', '.kaaaak.', '..kaak..', '...kk...', '..kaak..', '.kkkkkk.'],
      colors: { k: '#101018', a: '#fcd03c', c: '#fff8c0' } },
    trailblazer: { rows: ['...aa...', '...aa...', 'aaaaaaaa', '.abaaba.', '..aaaa..', '.aa..aa.', 'aa....aa', '........'],
      colors: { a: '#fcd03c', b: '#b08810' } },
    onfire: { rows: ['...a....', '..aa..a.', '..aaa.a.', '.aabaaa.', '.abbbaa.', 'aabbbbaa', 'aabbbbaa', '.aaaaaa.'],
      colors: { a: '#f83800', b: '#fcd03c' } },
    early: { rows: ['..kkkk..', '.kwwwwk.', 'kwwkwwwk', 'kwwkwwwk', 'kwwkkkwk', 'kwwwwwwk', '.kwwwwk.', '..kkkk..'],
      colors: { k: '#3cbcfc', w: '#ffffff' } },
    clockwork: { rows: ['aaaaaaaa', 'abbbbbba', 'abbbbwba', 'abbbwbba', 'awbwbbba', '.abwbba.', '..abba..', '...aa...'],
      colors: { a: '#58d854', b: '#1c7c1c', w: '#ffffff' } },
    firststeps: { rows: ['..aa....', '.aaaa...', '.aaaa...', '.aaa..a.', '..a..aaa', '.....aaa', '.....aa.', '......a.'],
      colors: { a: '#e8b878' } },
    explorer: { rows: ['..kkkk..', '.kwwrwk.', 'kwwwrwwk', 'kwwkkwwk', 'kwwkkwwk', 'kwbwwwwk', '.kbwwwk.', '..kkkk..'],
      colors: { k: '#fcd03c', w: '#fcfcfc', r: '#e83c3c', b: '#3c7cfc' } },
    halfway: { rows: ['kaaaa...', 'kaaaaaa.', 'kaaaaaa.', 'kaaa....', 'k.......', 'k.......', 'k.......', 'kk......'],
      colors: { k: '#bcbcbc', a: '#f878f8' } },
    pacesetter: { rows: ['....aaa.', '...aaa..', '..aaa...', '.aaaaaa.', '....aa..', '...aa...', '..aa....', '.a......'],
      colors: { a: '#fce060' } },
    marathon: { rows: ['.rr..bb.', '..rr.b..', '...rb...', '..aaaa..', '.aaccaa.', '.acaaaa.', '.aaaaaa.', '..aaaa..'],
      colors: { r: '#e83c3c', b: '#3c7cfc', a: '#fcd03c', c: '#fff8c0' } },
    speedrunner: { rows: ['...ww...', '..wwww..', '..wbbw..', '..wwww..', '.wwwwww.', '.r.ww.r.', '...ff...', '...f....'],
      colors: { w: '#fcfcfc', b: '#3cbcfc', r: '#e83c3c', f: '#fca044' } },
    perfect: { rows: ['........', '.cccccc.', 'ccaccacc', 'aaaaaaaa', '.aaaaab.', '..aaab..', '...ab...', '........'],
      colors: { c: '#bcf8fc', a: '#3cdcfc', b: '#1c7c9c' } },
    comeback: { rows: ['.aa..aa.', 'aaaaaaaa', 'aawaaaaa', 'aaaaaaaa', '.aaaaaa.', '..aaaa..', '...aa...', '........'],
      colors: { a: '#fc5c7c', w: '#ffffff' } },
    lock: { rows: ['..kkkk..', '.k....k.', '.k....k.', 'kkkkkkkk', 'kaaaaaak', 'kaakkaak', 'kaaaaaak', 'kkkkkkkk'],
      colors: { k: '#5c5c7c', a: '#2e2e50' } },
    crown: { rows: ['a..aa..a', 'aa.aa.aa', 'aaaaaaaa', 'abaabaab', 'aaaaaaaa'],
      colors: { a: '#fcd03c', b: '#e83c3c' } },
    pace: { rows: ['..aaaa..', '.aaaaaa.', 'aawaawaa', 'aakaakaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'a.aa.aa.'],
      colors: { a: '#c8c8f0', w: '#ffffff', k: '#101018' } },
  };

  const iconCache = new Map();
  function renderIcon(key, scale) {
    const icon = ICONS[key];
    if (!icon) return null;
    const s = Math.max(1, Math.round(scale));
    const ck = `${key}|${s}`;
    let c = iconCache.get(ck);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 8 * s;
    c.height = icon.rows.length * s;
    drawBitmap(c.getContext('2d'), icon.rows, icon.colors, 0, 0, s);
    iconCache.set(ck, c);
    return c;
  }

  const cache = new Map();
  // Returns an offscreen canvas of the sprite at an integer device-pixel scale.
  function renderSprite(index, frame, scale) {
    const s = Math.max(1, Math.round(scale));
    const key = `${index}|${frame}|${s}`;
    let c = cache.get(key);
    if (c) return c;
    const { rows, colors } = colorsFor(index);
    c = document.createElement('canvas');
    c.width = 16 * s;
    c.height = 16 * s;
    drawBitmap(c.getContext('2d'), rows[frame % rows.length], colors, 0, 0, s);
    cache.set(key, c);
    return c;
  }

  return { FAMILIES, FAMILY_KEYS, PALETTES, CHARACTER_COUNT, ICONS, decodeCharacter, parseCharacterSpec, drawBitmap, renderSprite, renderIcon };
});
