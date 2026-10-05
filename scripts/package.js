#!/usr/bin/env node
// Builds ready-to-run downloads that include the official Node.js program,
// so teachers can unzip and double-click without installing anything.
//
//   node scripts/package.js                      # latest Node LTS, all targets
//   node scripts/package.js --node v24.21.0 --targets win-x64,mac-arm64
//
// Needs `zip`, `unzip` and `tar` on the build machine (any Mac/Linux, or CI).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(DIST, '.cache');
const APP_FILES = ['server.js', 'package.json', 'README.md', 'config.example.json', 'lib', 'public'];

const TARGETS = {
  'win-x64': { archive: (v) => `node-${v}-win-x64.zip`, binary: 'node.exe', dest: 'node/node.exe', launchers: ['Start Class Quest.bat', 'Show on other devices.bat'] },
  'mac-arm64': { archive: (v) => `node-${v}-darwin-arm64.tar.gz`, binary: 'bin/node', dest: 'node/bin/node', launchers: ['Start Class Quest.command'] },
  'mac-x64': { archive: (v) => `node-${v}-darwin-x64.tar.gz`, binary: 'bin/node', dest: 'node/bin/node', launchers: ['Start Class Quest.command'] },
  'linux-x64': { archive: (v) => `node-${v}-linux-x64.tar.xz`, binary: 'bin/node', dest: 'node/bin/node', launchers: ['start.sh'] },
};

const START_HERE = {
  win: `CLASS QUEST - START HERE

1. Double-click "Start Class Quest".
   (If Windows says it protected your PC, click "More info" then "Run anyway".
   If that keeps happening, right-click the zip you downloaded, choose
   Properties, tick "Unblock", click OK, and unzip it again.)
2. Your browser opens Teacher controls. Follow the Canvas tab to connect
   your course. It takes about a minute.
3. Keep the black Class Quest window open while you use it. Close it to stop.

To show the display on a classroom TV or another computer, use
"Show on other devices" instead and open the address it prints there.

Nothing is installed. To remove Class Quest, delete this folder.
Your settings and Canvas connection are saved in the "data" folder here.
`,
  mac: `CLASS QUEST - START HERE

1. Right-click (or Control-click) "Start Class Quest.command" and choose Open,
   then click Open again. (Only needed the first time; after that you can
   double-click it.)
2. Your browser opens Teacher controls. Follow the Canvas tab to connect
   your course. It takes about a minute.
3. Keep the Terminal window open while you use Class Quest. Close it to stop.

Nothing is installed. To remove Class Quest, delete this folder.
Your settings and Canvas connection are saved in the "data" folder here.
`,
  linux: `CLASS QUEST - START HERE

Run ./start.sh (add --lan to share the display on your network).
Your browser opens Teacher controls; connect Canvas from the Canvas tab.
`,
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

async function download(url, file) {
  if (fs.existsSync(file)) return;
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copy(src, dest) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !path.basename(p).startsWith('.') });
}

async function main() {
  let version = arg('node');
  if (!version) {
    const index = await (await fetch('https://nodejs.org/dist/index.json')).json();
    version = index.find((r) => r.lts).version;
  }
  const targets = (arg('targets') || Object.keys(TARGETS).join(',')).split(',');
  console.log(`Packaging Class Quest with Node.js ${version}`);

  const sums = await (await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).text();
  const expected = new Map(sums.trim().split('\n').map((l) => l.trim().split(/\s+/).reverse()));

  for (const name of targets) {
    const t = TARGETS[name];
    if (!t) throw new Error(`Unknown target ${name}. Choose from: ${Object.keys(TARGETS).join(', ')}`);
    console.log(`\n${name}`);
    const archive = t.archive(version);
    const cached = path.join(CACHE, archive);
    await download(`https://nodejs.org/dist/${version}/${archive}`, cached);
    if (sha256(cached) !== expected.get(archive)) {
      fs.rmSync(cached);
      throw new Error(`Checksum mismatch for ${archive}; deleted it. Try again.`);
    }

    const stage = path.join(DIST, 'stage', name);
    const app = path.join(stage, 'ClassQuest');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(app, { recursive: true });
    for (const f of APP_FILES) copy(path.join(ROOT, f), path.join(app, f));
    for (const l of t.launchers) fs.copyFileSync(path.join(ROOT, 'launchers', l), path.join(app, l));
    const os = name.split('-')[0];
    fs.writeFileSync(path.join(app, 'START HERE.txt'), os === 'win' ? START_HERE.win.replace(/\n/g, '\r\n') : START_HERE[os]);

    // Pull just the node binary and its licence out of the official archive.
    const top = archive.replace(/\.(zip|tar\.gz|tar\.xz)$/, '');
    const unpack = path.join(stage, 'unpack');
    fs.mkdirSync(unpack);
    const wanted = [`${top}/${t.binary}`, `${top}/LICENSE`];
    if (archive.endsWith('.zip')) execFileSync('unzip', ['-q', cached, ...wanted, '-d', unpack]);
    else execFileSync('tar', ['-xf', cached, '-C', unpack, ...wanted]);
    const dest = path.join(app, t.dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(path.join(unpack, top, t.binary), dest);
    fs.chmodSync(dest, 0o755);
    fs.renameSync(path.join(unpack, top, 'LICENSE'), path.join(app, 'node', 'LICENSE'));
    fs.rmSync(unpack, { recursive: true });
    for (const l of t.launchers) if (!l.endsWith('.bat')) fs.chmodSync(path.join(app, l), 0o755);

    const out = path.join(DIST, `ClassQuest-${name}.zip`);
    fs.rmSync(out, { force: true });
    execFileSync('zip', ['-q', '-r', '-X', '-9', out, 'ClassQuest'], { cwd: stage });
    console.log(`  wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
  }
  fs.rmSync(path.join(DIST, 'stage'), { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
