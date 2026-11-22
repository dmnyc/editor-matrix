#!/usr/bin/env node
'use strict';

// node run.js sidecar [--browser chrome|firefox] [--surface compose,panel] [--only group,group]
//                     [--ids id,id] [--no-control] [--json out.json]
//
// Runs every case against each surface, and against a bare contenteditable in the same
// browser (the control), so each failure says whether it is the app's or the browser's.

const fs = require('node:fs');
const { CASES } = require('./cases');
const { run, select, report } = require('./lib/runner');

const args = process.argv.slice(2);
const app = args[0];
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : args[i + 1]; };
const list = (v) => (v ? v.split(',') : undefined);

(async () => {
  const cases = select(CASES, { only: list(opt('only')), ids: list(opt('ids')) });
  const out = {};
  if (app === 'sidecar') {
    const { startSidecar, sidecarAdapter } = require('./adapters/sidecar');
    const browser = opt('browser', 'chrome');
    const surfaces = list(opt('surface', 'compose,panel'));
    if (!args.includes('--no-control')) surfaces.unshift('control');
    const x = await startSidecar({ browser });
    try {
      for (const surface of surfaces) {
        const a = await sidecarAdapter(x, { surface, browser });
        process.stderr.write(`${a.name}: `);
        out[a.name] = await run(a, cases, { onResult: (r) => process.stderr.write(r.status === 'pass' ? '.' : r.status === 'skip' ? 's' : 'F') });
        process.stderr.write('\n');
        await a.close();
      }
    } finally { x.close(); }
    const control = out[`sidecar/control/${browser}`];
    for (const [name, results] of Object.entries(out)) console.log(report(name, results, name.includes('/control/') ? null : control));
  } else if (app === 'zapcooking') {
    const { startZapCooking, zapcookingAdapter } = require('./adapters/zapcooking-web');
    const surfaces = list(opt('surface', 'note'));
    if (!args.includes('--no-control')) surfaces.unshift('control');
    const z = await startZapCooking({ headless: !args.includes('--headed') });
    try {
      for (const surface of surfaces) {
        const a = await zapcookingAdapter(z, { surface });
        process.stderr.write(`${a.name}: `);
        out[a.name] = await run(a, cases, { onResult: (r) => process.stderr.write(r.status === 'pass' ? '.' : r.status === 'skip' ? 's' : 'F') });
        process.stderr.write('\n');
        await a.close();
      }
    } finally { z.chrome.close(); }
    const control = out['zapcooking/control/chrome'];
    for (const [name, results] of Object.entries(out)) console.log(report(name, results, name.includes('/control/') ? null : control));
  } else {
    console.error('usage: node run.js zapcooking [--surface note] [--only groups] [--ids ids]');
    console.error('usage: node run.js sidecar [--browser chrome|firefox] [--surface compose,panel] [--only groups] [--ids ids]');
    process.exit(2);
  }
  if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(out, null, 1));
  const failed = Object.entries(out).some(([n, rs]) => !n.includes('/control/') && rs.some((r) => r.status === 'fail'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
