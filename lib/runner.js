'use strict';

// Runs cases against one editor through its adapter, and reports.
//
// AN ADAPTER is an object with
//   name                      e.g. 'sidecar/compose/chrome'
//   supports                  capabilities: 'paste', 'drop', 'ime'
//   platform                  'mac' | 'ios' | 'android' | …
//   reset()                   an empty editor with the caret in it
//   step(step)                one step of a case, as real input
//   read()                    { text, empty, focused, formatting: [descriptions] }
//   errors()                  page errors so far (optional)
//   close()

const MARK = '‸';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function select(cases, { only, ids, skipIds } = {}) {
  return cases.filter((c) => (!only || only.includes(c.group)) && (!ids || ids.includes(c.id)) && !(skipIds && skipIds.includes(c.id)));
}

// A case that hangs (a key the driver never returns from, a dialog) fails, and the run goes on.
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what + ' did not finish in ' + ms / 1000 + 's')), ms))]);

async function runCase(adapter, c, { settle = 70, timeout = 30000 } = {}) {
  return within(timeout, runCaseInner(adapter, c, { settle }), 'the case').catch((e) => ({ id: c.id, group: c.group, status: 'fail', note: 'threw: ' + e.message }));
}

async function runCaseInner(adapter, c, { settle }) {
  const lacks = (c.needs || []).filter((n) => !adapter.supports.includes(n));
  if (lacks.length) return { id: c.id, group: c.group, status: 'skip', note: 'driver cannot ' + lacks.join(', ') };
  if (c.platforms && !c.platforms.includes(adapter.platform)) return { id: c.id, group: c.group, status: 'skip', note: 'not this platform' };
  const errorsBefore = adapter.errors ? (await adapter.errors()).length : 0;
  const problems = [];
  try {
    await adapter.reset();
    for (const st of c.steps) { await adapter.step(st); await sleep(settle); }
    await sleep(settle * 2);
    const state = await adapter.read();
    if (c.empty !== undefined && state.empty !== c.empty) problems.push(c.empty ? 'placeholder missing' : 'reads as empty');
    if (c.clean && state.formatting && state.formatting.length) problems.push('formatting came in: ' + state.formatting.join(', '));
    if (!state.focused) problems.push('lost focus');
    let got = state.text;
    if (c.text.includes(MARK)) {
      await adapter.step(['type', MARK]);
      await sleep(settle * 2);
      got = (await adapter.read()).text;
    }
    if (got !== c.text) problems.push(`text ${show(got)}, expected ${show(c.text)}`);
  } catch (e) {
    problems.push('threw: ' + (e && e.message || e));
  }
  if (adapter.errors) {
    const errs = (await adapter.errors()).slice(errorsBefore);
    if (errs.length) problems.push('page errors: ' + errs.join(' | '));
  }
  return { id: c.id, group: c.group, status: problems.length ? 'fail' : 'pass', note: problems.join('; ') };
}

async function run(adapter, cases, opts = {}) {
  const results = [];
  for (const c of cases) {
    const r = await runCase(adapter, c, opts);
    results.push(r);
    if (opts.onResult) opts.onResult(r);
  }
  return results;
}

// Newlines and the caret mark kept visible: "ab⏎‸cd".
function show(s) {
  if (s === undefined || s === null) return String(s);
  return '"' + String(s).replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/\r/g, '␍').replace(/ /g, '⍽') + '"';
}

// One table per adapter; with a control run beside it, each failure is marked as the
// browser's own (the bare editor fails it too) or the app's.
function report(name, results, control) {
  const lines = [];
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail');
  const skip = results.filter((r) => r.status === 'skip').length;
  lines.push(`\n== ${name}: ${pass} pass, ${fail.length} fail, ${skip} skipped`);
  const ctl = control ? new Map(control.map((r) => [r.id, r])) : null;
  for (const r of fail) {
    const c = ctl && ctl.get(r.id);
    const whose = !c ? '' : c.status === 'fail' ? ' [a bare editor fails too]' : ' [app only]';
    lines.push(`  ✗ ${r.group}/${r.id}${whose}: ${r.note}`);
  }
  return lines.join('\n');
}

module.exports = { run, runCase, select, report, show, MARK, sleep };
