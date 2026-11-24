'use strict';

// A plain Chrome for web apps: headless, a fresh profile in a temp directory, driven over
// --remote-debugging-pipe. `openPage(url)` gives a page object with everything lib/web.js
// asks for (evaluate, press, type, cdp, and the Chrome abilities: clipboard, drop, input
// methods). The clipboard is granted to the page's origin, as a person allowing it would.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromeAbilities } = require('./web');

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startChrome({ headless = true, args = [] } = {}) {
  if (!CHROME) throw new Error('no Chrome found (set CHROME_PATH)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-matrix-'));
  const proc = spawn(CHROME, [
    ...(headless ? ['--headless=new'] : []), '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(dir, 'profile')}`, '--remote-debugging-pipe', ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];
  let n = 0;
  const pending = new Map();
  const listeners = [];
  let buf = '';
  fromChrome.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      } else listeners.forEach((f) => f(msg));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++n;
    pending.set(id, { res, rej });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  await sleep(1000);

  const KEYS = { Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, Enter: 13, Tab: 9, Escape: 27, a: 65, c: 67, v: 86, x: 88, z: 90 };

  async function openPage(url, { width = 1280, height = 900 } = {}) {
    const origin = new URL(url).origin;
    await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    listeners.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errors.push(((d.exception && d.exception.description) || d.text).split('\n')[0]);
      }
    });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    // A focused page: the clipboard API refuses an unfocused document.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
    await send('Page.navigate', { url }, sessionId);

    const cdp = (method, params) => send(method, params, sessionId);
    const page = {
      errors,
      cdp,
      evaluate: async (expression) => {
        const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (r.exceptionDetails) throw new Error('page threw: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
        return r.result.value;
      },
      waitFor: async (expression, ms = 30000) => {
        const end = Date.now() + ms;
        let last;
        while (Date.now() < end) {
          try { last = await page.evaluate(expression); } catch (_) { last = undefined; }
          if (last) return last;
          await sleep(150);
        }
        throw new Error('timed out waiting for: ' + expression);
      },
      press: async (key, { shift = false, alt = false, ctrl = false, meta = false, commands } = {}) => {
        const code = KEYS[key];
        const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
        const base = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
        await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, ...(commands ? { commands } : {}) });
        if (key === 'Enter' && !(alt || ctrl || meta)) await cdp('Input.dispatchKeyEvent', { type: 'char', text: '\r', key, modifiers });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      },
      type: (text) => cdp('Input.insertText', { text }),
      clickAt: async (x, y) => {
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
        }
      },
      screenshot: async (file) => {
        const shot = await cdp('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      },
      close: () => send('Target.closeTarget', { targetId }),
    };
    Object.assign(page, chromeAbilities(page));
    return page;
  }

  return {
    openPage,
    send,
    close: () => {
      try { proc.kill('SIGKILL'); } catch (_) { /* gone */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    },
  };
}

module.exports = { startChrome, CHROME, sleep };
