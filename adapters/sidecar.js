'use strict';

// SIDECAR: the real extension in a real browser (Sidecar's own test drivers), one composer
// surface per adapter.
//
//   surface  'compose'  the full-size composer tab (compose.html)
//            'panel'    the composer sheet in the side panel
//            'control'  a bare contenteditable added to compose.html: no Sidecar code on it,
//                       so its failures are the browser's own
//   browser  'chrome' | 'firefox'
//   root     the Sidecar checkout (SIDECAR_ROOT); its test/helpers start the extension

const path = require('node:path');
const { plainText, formattingIn, webStep, chromeAbilities, firefoxAbilities } = require('../lib/web');
const { sleep } = require('../lib/runner');

async function startSidecar({ root = process.env.SIDECAR_ROOT, browser = 'chrome' } = {}) {
  if (!root) throw new Error('set SIDECAR_ROOT to a Sidecar checkout');
  process.env.SIDECAR_BROWSER = browser;
  const helper = path.join(root, 'test', 'helpers', 'real-extension.js');
  delete require.cache[require.resolve(helper)];
  const { startExtension } = require(helper);
  const x = await startExtension();
  await x.reload();
  return x;
}

async function sidecarAdapter(x, { surface = 'compose', browser = 'chrome' } = {}) {
  const page = surface === 'panel' ? 'sidepanel' : 'compose';
  const tab = await x.openPage(`chrome-extension://${x.extId}/${page}.html`);
  Object.assign(tab, browser === 'firefox' ? firefoxAbilities(tab) : chromeAbilities(tab));
  const ED = surface === 'panel' ? '#modal .compose-editor' : surface === 'control' ? '#__control' : '.compose-editor';
  if (surface === 'panel') {
    await tab.viewport({ width: 380, height: 820, scale: 1 });
    for (let i = 0; i < 40 && !(await tab.evaluate(`!!document.getElementById('compose-fab')`)); i++) await sleep(250);
    await sleep(800);
    await tab.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await tab.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
    // A draft left by an earlier surface is offered back first; these cases start fresh.
    await tab.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((b) => b.textContent.trim() === 'Start fresh'); if (b) b.click(); })()`);
    await sleep(600);
  }
  for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('.compose-editor') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
  if (!(await tab.evaluate(`!!document.querySelector('${ED.replace('#__control', '.compose-editor')}')`))) {
    const seen = await tab.evaluate(`(document.getElementById('modal') || document.body).innerText.slice(0, 300)`);
    throw new Error(`no editor at ${ED}; the page shows: ${seen}`);
  }
  if (surface === 'control') {
    await tab.evaluate(`(() => { const d = document.createElement('div'); d.id = '__control'; d.contentEditable = 'true';
      d.style.cssText = 'position:fixed;left:20px;top:20px;width:420px;min-height:200px;background:#fff;color:#000;font:16px sans-serif;z-index:99999;white-space:pre-wrap';
      document.body.appendChild(d); })()`);
  }
  await sleep(600);
  await tab.evaluate(`(() => { window.__plainText = ${plainText.toString()}; window.__formattingIn = ${formattingIn.toString()}; })()`);

  const supports = browser === 'firefox' ? ['paste'] : ['paste', 'drop', 'dropFile', 'ime'];
  const errorsAt = () => x.errors.slice();
  return {
    name: `sidecar/${surface}/${browser}`,
    platform: 'mac',
    supports,
    reset: async () => {
      await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML = ''; ed.focus(); ed.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(80);
    },
    step: (st) => webStep(tab, st, {
      dropPoint: () => tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); const r = document.createRange(); r.selectNodeContents(ed);
        const rects = [...r.getClientRects()]; const box = ed.getBoundingClientRect(); const last = rects[rects.length - 1] || box;
        return { x: Math.min(last.right + 3, box.right - 4), y: last.top + Math.max(last.height, 10) / 2 }; })()`),
    }),
    read: () => tab.evaluate(`(() => { const ed = document.querySelector('${ED}');
      const control = ${surface === 'control'};
      const text = control ? __plainText(ed) : SidecarCore.serializeEditor(ed);
      return { text, empty: control ? !text : ed.classList.contains('is-empty'), focused: document.activeElement === ed,
        formatting: __formattingIn(ed, '[data-bech32]') }; })()`),
    errors: async () => errorsAt(),
    close: () => tab.close(),
  };
}

module.exports = { startSidecar, sidecarAdapter };
