#!/usr/bin/env node
'use strict';

// The editor lab: drive a composer through every feature in lab/features.js, take the signed
// event each one publishes off the lab's own relay, check it, and write down what was signed.
//
//   SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --surface compose
//   SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --surface panel --only note,reply
//   node lab/run.js sidecar --ids note-image,reply-article --out lab/reports
//
// Writes <out>/<app>-<surface>-<browser>-<date>.json (every event, every check) and a .md report
// beside it. Exits 1 when any feature fails.

const fs = require('node:fs');
const path = require('node:path');
const { startLab } = require('./server');
const { FEATURES, basics } = require('./features');
const RECIPES = require(path.join(__dirname, '..', 'recipes', 'fixtures.json'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// What an app signs on the way to publishing that is not the published event itself.
const SIDE_KINDS = new Set([0, 3, 5, 10002, 10063, 22242, 24242, 27235, 30078, 31234]);

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  const app = process.argv[2];
  if (!app || app.startsWith('--')) { console.error('usage: node lab/run.js <app> [--surface s] [--browser b] [--only groups] [--ids ids] [--out dir]'); process.exit(2); }
  const surface = arg('surface', 'compose');
  const browser = arg('browser', 'chrome');
  const only = (arg('only', '') || '').split(',').filter(Boolean);
  const ids = (arg('ids', '') || '').split(',').filter(Boolean);
  const out = path.resolve(arg('out', path.join(__dirname, 'reports')));

  const lab = await startLab();
  const adapterFile = path.join(__dirname, '..', 'adapters', app + '-lab.js');
  if (!fs.existsSync(adapterFile)) throw new Error('no lab adapter for ' + app + ' (adapters/' + app + '-lab.js)');
  const adapter = require(adapterFile);
  const start = adapter[Object.keys(adapter).find((k) => k.startsWith('start'))];
  const session = await start({ lab, surface, browser });
  console.log(`editor lab: ${session.name}, relay ${lab.relay}`);

  const results = [];
  const features = FEATURES.filter((f) => (!only.length || only.includes(f.group)) && (!ids.length || ids.includes(f.id)));
  for (const f of features) {
    const missing = (f.needs || []).filter((n) => !session.abilities.has(n));
    if (missing.length) { results.push({ id: f.id, group: f.group, title: f.title, status: 'skipped', why: 'cannot ' + missing.join(', ') }); process.stdout.write('-'); continue; }
    const refs = {};
    const record = { id: f.id, group: f.group, title: f.title, steps: f.steps, seeded: [], event: null, checks: [], status: 'fail' };
    try {
      for (const [name, make, who] of f.seed || []) {
        const ev = session.sign(make(refs), who);
        lab.seed(ev);
        refs[name] = ev;
        record.seeded.push(ev);
      }
      await session.reset();
      const mark = lab.events.length;
      const ctx = { refs, people: session.people, recipes: RECIPES };
      for (const step of f.steps) await session.step(step, ctx);
      // The published event: the first new one from the account, of the kind the feature names.
      let ev = null;
      const end = Date.now() + 60000;
      while (!ev && Date.now() < end) {
        ev = lab.events.slice(mark).find((e) => e.pubkey === session.pubkey && !e.seeded && !SIDE_KINDS.has(e.kind) && (f.kind == null || e.kind === f.kind));
        if (!ev) await sleep(250);
      }
      if (!ev) throw new Error('nothing was published' + (f.kind != null ? ' of kind ' + f.kind : ''));
      record.event = ev;
      let sigOk = null;
      try { sigOk = session.verify ? !!(await session.verify(ev)) : null; } catch (_) { sigOk = false; }
      const all = { ...ctx, pubkey: session.pubkey, eventId: lab.eventId, sigOk, uploads: lab.uploads.slice() };
      record.checks = [...basics(ev, all), ...f.expect(ev, all)].map(([what, ok, detail, level]) => ({ what, ok, ...(level ? { level } : {}), ...(detail !== undefined ? { detail: String(detail) } : {}) }));
      record.status = record.checks.every((c) => c.ok || c.level === 'advice') ? 'pass' : 'fail';
      if (record.status === 'pass' && record.checks.some((c) => !c.ok)) record.advice = true;
    } catch (e) {
      record.error = String((e && e.message) || e);
    }
    // Put back what the feature changed, whatever happened to it.
    for (const step of f.after || []) { try { await session.step(step, {}); } catch (_) { /* the next reset starts clean anyway */ } }
    const errs = session.errors ? session.errors() : [];
    if (errs.length) record.pageErrors = errs;
    results.push(record);
    process.stdout.write(record.status === 'pass' ? '.' : 'F');
  }
  process.stdout.write('\n');
  await session.close();
  await lab.close();

  // ---- the report ----
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(out, `${session.name.replace(/\//g, '-')}-${stamp}`);
  const summary = { app: session.name, relay: 'local lab relay', ran: new Date().toISOString(),
    pass: results.filter((r) => r.status === 'pass').length, fail: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length };
  fs.writeFileSync(base + '.json', JSON.stringify({ summary, results }, null, 2) + '\n');

  const md = [`# Editor lab: ${session.name}`, '', `Run ${summary.ran}. ${summary.pass} pass, ${summary.fail} fail, ${summary.skipped} skipped.`, '',
    '| Feature | Result | What failed |', '|---|---|---|'];
  for (const r of results) {
    const failed = r.status === 'skipped' ? r.why : r.error || (r.checks || []).filter((c) => !c.ok).map((c) => (c.level === 'advice' ? 'advice: ' : '') + c.what + (c.detail ? ` (${c.detail.slice(0, 80)})` : '')).join('; ');
    const mark = r.status === 'skipped' ? '—' : r.status === 'fail' ? '❌' : r.advice ? '✅ ⚠' : '✅';
    md.push(`| \`${r.id}\` ${r.title} | ${mark} | ${(failed || '').replace(/\|/g, '\\|')} |`);
  }
  md.push('', '## What was signed', '');
  for (const r of results.filter((x) => x.event)) {
    md.push(`### \`${r.id}\` ${r.title}`, '', '```json', JSON.stringify(r.event, null, 2), '```', '');
  }
  fs.writeFileSync(base + '.md', md.join('\n'));

  for (const r of results.filter((x) => x.advice)) console.log(`⚠ ${r.id}: ${r.checks.filter((c) => !c.ok).map((c) => c.what).join('; ')}`);
  for (const r of results.filter((x) => x.status === 'fail')) {
    console.log(`✗ ${r.id}: ${r.error || r.checks.filter((c) => !c.ok).map((c) => c.what + (c.detail ? ' [' + c.detail.slice(0, 100) + ']' : '')).join('; ')}`);
  }
  console.log(`${summary.pass} pass, ${summary.fail} fail, ${summary.skipped} skipped. Report: ${base}.md`);
  process.exit(summary.fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
