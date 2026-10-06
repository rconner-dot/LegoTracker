#!/usr/bin/env node
// Saves every assignment's instructions from your Canvas course into the
// "instructions" folder as instructions.md (easy to read or share) and
// instructions.json (for tools). Uses the Canvas connection you set up in
// Teacher controls. Course content only: no student information is fetched.
//
//   node scripts/export-instructions.js [--course 12345] [--out folder]
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../lib/config');
const { CanvasClient } = require('../lib/canvas');
const { collectInstructions, toMarkdown } = require('../lib/instructions');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

async function main() {
  const config = loadConfig({ argv: [] });
  const courseId = arg('course') || config.courseId;
  if (!config.canvasUrl || !config.token || !courseId) {
    console.log('\n  Class Quest isn\'t connected to Canvas yet.');
    console.log('  Start Class Quest, open Teacher controls → Canvas, connect your course, then run this again.\n');
    process.exitCode = 1;
    return;
  }
  const out = path.resolve(arg('out') || path.join(__dirname, '..', 'instructions'));
  console.log(`\n  Reading course ${courseId} from ${config.canvasUrl}…`);
  const client = new CanvasClient({ baseUrl: config.canvasUrl, token: config.token });
  const data = await collectInstructions(client, courseId);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'instructions.md'), toMarkdown(data));
  fs.writeFileSync(path.join(out, 'instructions.json'), JSON.stringify(data, null, 2));
  const assignments = data.modules.flatMap((m) => m.items.filter((i) => i.assignment)).length + data.otherAssignments.length;
  console.log(`  Saved ${assignments} assignments from ${data.modules.length} modules of “${data.course.name}”:`);
  console.log(`    ${path.join(out, 'instructions.md')}`);
  console.log(`    ${path.join(out, 'instructions.json')}\n`);
}

main().catch((err) => {
  console.error(`\n  Couldn't export instructions: ${err.message}\n`);
  process.exitCode = 1;
});
