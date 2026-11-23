'use strict';

// Sidecar, in the editor lab: the real extension in Chrome for Testing, publishing to the lab's
// relay and uploading to its Blossom server. Two surfaces: 'compose', the full-size composer tab
// (every feature), and 'panel', the side panel's composer (notes and replies).
//
//   SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --surface compose
//
// THE LAB REACHES NOTHING ELSE. Chrome is started with every host but 127.0.0.1 mapped to
// nowhere, so a fallback (nostr.build for an upload, a bootstrap relay) fails instead of
// publishing a test event to the world.

const path = require('node:path');
const { webStep, chromeAbilities, firefoxAbilities } = require('../lib/web');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startSidecarLab({ lab, surface = 'compose', root = process.env.SIDECAR_ROOT, browser = 'chrome' } = {}) {
  if (!root) throw new Error('set SIDECAR_ROOT to a Sidecar checkout');
  root = path.resolve(root);
  process.env.SIDECAR_BROWSER = browser;
  const helper = path.join(root, 'test', 'helpers', 'real-extension.js');
  const { startExtension } = require(helper);
  const x = await startExtension({
    chromeArgs: ['--ignore-certificate-errors', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  const people = { me: x.me, bea: x.bea, cal: x.cal };
  const now = () => Math.floor(Date.now() / 1000);

  // The account's relays are the lab's, and so are everyone else's (NIP-65), and its Blossom
  // server is the lab's (kind 10063). Seeded as if published elsewhere.
  await x.message({ type: 'SIDECAR_SET_RELAYS', relays: { [lab.relay]: { read: true, write: true } } });
  for (const who of ['me', 'bea', 'cal']) {
    lab.seed(x.sign({ kind: 10002, created_at: now(), tags: [['r', lab.relay]], content: '' }, who));
    lab.seed(x.sign({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: who[0].toUpperCase() + who.slice(1) }) }, who));
  }
  lab.seed(x.sign({ kind: 10063, created_at: now(), tags: [['server', lab.blossom]], content: '' }, 'me'));
  // No countdown to wait through; Reply to any event, the dev tool, opens a reply by id.
  await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { noteCountdown: false, devReplyById: true, showClientTag: true } });

  const url = surface === 'panel' ? `chrome-extension://${x.extId}/sidepanel.html` : `chrome-extension://${x.extId}/compose.html`;
  const page = await x.openPage(url);
  // The real system clipboard and the paste shortcut, as editor-matrix's cases use them: a paste
  // event made by a script carries no clipboard data in Firefox.
  Object.assign(page, browser === 'firefox' ? firefoxAbilities(page) : chromeAbilities(page));
  const ED = surface === 'panel' ? '#modal .compose-editor' : '#compose-slot .compose-editor, .compose-sheet .compose-editor';
  const ev = (expr) => page.evaluate(expr);
  const waitFor = async (expr, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await ev(expr)) return true; } catch (_) { /* not yet */ } await sleep(150); }
    throw new Error('timed out waiting for ' + expr);
  };
  const ready = async () => {
    if (surface === 'panel') await waitFor(`!!document.getElementById('compose-fab')`, 20000);
    else await waitFor(`!!document.querySelector('.compose-editor') && !!window.SidecarLongform && !!window.SidecarComposePublish && !document.documentElement.classList.contains('compose-booting')`, 20000);
    await sleep(500);
  };
  await ready();

  const focusEnd = () => ev(`(() => { const ed = document.querySelector(${JSON.stringify(ED)}); ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  const pasteText = (text) => webStep(page, ['paste', { text }]);
  const clickText = (sel, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); })()`);
  const typeInto = (sel, text) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  async function openComposer() {
    if (surface === 'panel') {
      await ev(`document.getElementById('compose-fab').click()`); await sleep(400);
      await ev(`document.getElementById('compose-note-btn').click()`); await sleep(1000);
      await ev(`(() => { const b = [...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Start fresh'); if (b) b.click(); })()`);
      await waitFor(`!!document.querySelector(${JSON.stringify(ED)})`);
    }
    // Empty, whatever an earlier feature left: the greeting a first composer opens with, too.
    await ev(`(() => { const ed = document.querySelector(${JSON.stringify(ED)}); ed.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`);
  }

  // FIREFOX ATTACHES NOTHING. It has no way here to put a file in an input, and no flag that
  // blocks other hosts, so an upload that fell back to nostr.build would really go out. Every
  // other feature publishes only to the relays Sidecar is set to, which are the lab's.
  const abilities = new Set(['note', 'mention', 'quote', 'settings', 'pow', 'reply',
    ...(browser === 'chrome' ? ['attach', 'alt'] : []),
    ...(surface === 'compose' ? ['poll', 'article', 'recipe'] : [])]);

  const steps = {
    async settings(s) {
      const out = {};
      if ('clientTag' in s) out.showClientTag = s.clientTag;
      if ('pow' in s) out.powBy = s.pow ? { [x.me]: s.pow } : {};
      if ('countdown' in s) out.noteCountdown = s.countdown;
      await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: out });
      // The full-size composer reads its settings as it loads.
      await ev('location.reload()'); await sleep(1500); await ready();
    },
    async open(mode) {
      if (surface === 'compose') await clickText('.compose-mode', { note: 'Note', poll: 'Poll', article: 'Article', recipe: 'Recipe' }[mode]);
      await sleep(300);
      if (mode === 'note' || mode === 'poll') await openComposer();
    },
    async reply(name, ctx) {
      if (surface === 'panel') await openComposer();
      else await clickText('.compose-mode', 'Note');
      await waitFor(`!!document.getElementById('compose-dev-reply')`);
      await ev(`(() => { document.getElementById('compose-dev-reply').value = ${JSON.stringify(ctx.refs[name].id)};
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reply to this event').click(); })()`);
      await waitFor(`!!document.querySelector('.reply-target-kind')`, 20000);
      await sleep(400);
      await ev(`(() => { const ed = document.querySelector(${JSON.stringify(ED)}); ed.focus(); document.execCommand('selectAll'); document.execCommand('delete'); })()`);
    },
    async type(text) { await focusEnd(); await page.type(text); await sleep(80); },
    async key(name) { await page.press(name); await sleep(80); },
    async paste(text) { await focusEnd(); await pasteText(text); await sleep(150); },
    async mention(who) {
      const npub = await ev(`window.NostrTools.nip19.npubEncode(${JSON.stringify(people[who])})`);
      await focusEnd(); await pasteText('nostr:' + npub); await sleep(200);
    },
    async quote(name, ctx) {
      const r = ctx.refs[name];
      const code = await ev(`window.NostrTools.nip19.neventEncode({ id: ${JSON.stringify(r.id)}, author: ${JSON.stringify(r.pubkey)} })`);
      await focusEnd(); await pasteText('nostr:' + code); await sleep(400);
    },
    async attach(file) {
      const abs = path.join(__dirname, '..', 'fixtures', file);
      const { result } = await page.cdp('Runtime.evaluate', { expression: `document.querySelector('input[type=file][accept="image/*,video/*"]')` });
      if (!result || !result.objectId) throw new Error('no media input');
      await page.cdp('DOM.setFileInputFiles', { files: [abs], objectId: result.objectId });
      // Uploaded once the attachment shows a URL rather than a progress bar.
      await waitFor(`!document.querySelector('.is-uploading') && !!document.querySelector('.compose-media img, .media-strip img, .compose-thumb img')`, 30000);
      await sleep(400);
    },
    async alt(text) {
      const chips = await ev(`document.querySelectorAll('.compose-thumb-alt').length`);
      if (!chips) throw new Error('no + ALT on the attachment');
      await ev(`[...document.querySelectorAll('.compose-thumb-alt')].pop().click()`);
      await waitFor(`!!document.querySelector('.compose-alt-text')`);
      await ev(`(() => { const f = [...document.querySelectorAll('.compose-alt-text')].pop(); f.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await ev(`[...document.querySelectorAll('.compose-alt-save')].pop().click()`);
      await sleep(300);
    },
    async poll({ options }) {
      await waitFor(`!!document.querySelector('.poll-option-input')`);
      for (let i = 0; i < options.length; i++) {
        if (!(await ev(`document.querySelectorAll('.poll-option-input').length > ${i}`))) await ev(`document.querySelector('.poll-add-option').click()`);
        await sleep(100);
        await ev(`(() => { const e = document.querySelectorAll('.poll-option-input')[${i}]; e.focus(); document.execCommand('insertText', false, ${JSON.stringify(options[i])}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      }
    },
    async article({ title, summary, body, topics = [] }) {
      await typeInto('.lf-article .lf-title', title);
      if (summary) await typeInto('.lf-article .lf-summary', summary);
      await typeInto('.lf-article .lf-body', body);
      for (const tp of topics) {
        await typeInto('.lf-article .lf-chip-input', tp);
        await ev(`document.querySelector('.lf-article .lf-chip-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      }
      await sleep(300);
    },
    async recipe(name, ctx) {
      const c = ctx.recipes.cases.find((k) => k.name === name);
      await ev(`(() => { const L = window.SidecarLongform.state.recipe; const f = ${JSON.stringify(c.fields)};
        for (const k of Object.keys(f)) L[k] = Array.isArray(f[k]) ? f[k].map((v) => (typeof v === 'object' ? { ...v } : v)) : f[k];
        window.SidecarLongform.refresh(); })()`);
      await sleep(300);
    },
    async publish() {
      if (surface === 'panel') {
        await ev(`[...document.querySelectorAll('#modal button.primary')].find((b) => b.textContent === 'Post' || b.textContent === 'Reply').click()`);
        return;
      }
      await waitFor(`!document.getElementById('compose-post').disabled`, 10000);
      await ev(`document.getElementById('compose-post').click()`);
      // Articles and recipes go through a review first, and a taken address asks; a note goes straight out.
      await sleep(600);
      if (await ev(`(() => { const c = document.getElementById('compose-countdown'); return !!c && !c.classList.contains('hidden'); })()`)) {
        await ev(`(() => { const b = [...document.querySelectorAll('#compose-countdown button')].find((b) => b.textContent === 'Publish'); if (b) b.click(); })()`);
        await sleep(600);
      }
      if (await ev(`!!document.querySelector('.lf-confirm') && !document.querySelector('.lf-confirm').classList.contains('hidden')`)) {
        await clickText('.lf-confirm button', 'Publish as a new one');
      }
    },
  };

  return {
    name: 'sidecar/' + surface + '/' + browser,
    pubkey: x.me,
    people,
    abilities,
    sign: (template, who) => x.sign({ created_at: now(), ...template }, who),
    verify: (event) => ev(`window.NostrTools.verifyEvent(${JSON.stringify(event)})`),
    async step([name, arg], ctx) {
      if (!steps[name]) throw new Error('the Sidecar lab adapter has no step ' + name);
      await steps[name](arg, ctx);
    },
    // Between features: a fresh page, so nothing one leaves behind reaches the next.
    async reset() {
      await ev('location.reload()');
      await sleep(1500);
      await ready();
    },
    errors: () => x.errors.slice(),
    close: () => x.close(),
  };
}

module.exports = { startSidecarLab };
