'use strict';

// Shared by every adapter that drives an editor in a browser page.
//
// A PAGE (from a browser driver) offers
//   evaluate(expr)            run in the page, return a JSON value
//   press(key, {shift, alt, meta, ctrl, commands})   a real key press
//   type(text)                text as a keyboard delivers it
//   setClipboard({text, html})  the system clipboard, as another app would leave it
//   drop({text, html}, x, y)  (optional) a real drag-and-drop at a page point
//   ime(stages, final)        (optional) an input method composing, then committing
//   cdp / browserEval         driver escape hatches, used by the helpers that need them

const { keysFor } = require('./keys-mac');

// A plain-text reading of a contenteditable, as any text editor would save it: a block
// starts a line, a <br> breaks one unless it only holds an empty block open, no-break
// spaces are spaces. Used for the control editor, and by apps that have no reader of
// their own. Stringified into the page, so it must stand alone.
function plainText(root) {
  let out = '';
  let started = false;
  let lineStart = true;
  const BLOCK = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|TR|UL|OL|TABLE)$/;
  const holdsLineOpen = (br) => {
    let n = br.nextSibling;
    while (n && n.nodeType === 3 && !n.textContent) n = n.nextSibling;
    return !n;
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      const s = node.textContent.replace(/​/g, '').replace(/ /g, ' ');
      if (s) { started = true; lineStart = false; }
      out += s;
    } else if (node.nodeName === 'BR') {
      started = true;
      if (!holdsLineOpen(node)) { out += '\n'; lineStart = true; }
    } else if (node.nodeType === 1) {
      const block = BLOCK.test(node.nodeName);
      if (block && started && !lineStart) { out += '\n'; lineStart = true; }
      node.childNodes.forEach(walk);
      if (block) { started = true; lineStart = false; }
    }
  };
  root.childNodes.forEach(walk);
  return out;
}

// What came into the editor that a plain-text editor never makes: tags beyond lines and
// breaks, inline styles, pictures. `allow` is a selector for an app's own elements (a
// mention pill), skipped with everything inside them.
function formattingIn(root, allow) {
  const found = [];
  const PLAIN = /^(DIV|P|BR|SPAN)$/;
  const visit = (el) => {
    for (const c of el.children) {
      if (allow && c.matches(allow)) continue;
      const attrs = [...c.attributes].map((a) => a.name).filter((n) => n !== 'dir');
      if (!PLAIN.test(c.nodeName) || attrs.length) found.push(c.nodeName.toLowerCase() + (attrs.length ? '[' + attrs.join(',') + ']' : ''));
      visit(c);
    }
  };
  visit(root);
  return [...new Set(found)];
}

// One step, as real input on a page.
async function webStep(page, step, { dropPoint } = {}) {
  const [kind, arg, extra] = step;
  if (kind === 'type') return page.type(arg);
  if (kind === 'paste' && arg) {
    await page.setClipboard(arg);
    const k = keysFor(['paste']);
    return page.press(k.key, k);
  }
  if (kind === 'drop') {
    const at = await dropPoint();
    return page.drop(arg, at.x, at.y);
  }
  if (kind === 'dropFile') {
    const at = await dropPoint();
    return page.dropFile(require('node:path').join(__dirname, '..', 'fixtures', arg), at.x, at.y);
  }
  if (kind === 'ime') return page.ime(arg, extra);
  const k = keysFor(step);
  return page.press(k.key, k);
}

// The Chrome versions of the optional page abilities, over the DevTools protocol.
function chromeAbilities(page) {
  return {
    setClipboard: async ({ text, html }) => {
      const items = [];
      if (html !== undefined) items.push(`'text/html': new Blob([${JSON.stringify(html)}], { type: 'text/html' })`);
      if (text !== undefined) items.push(`'text/plain': new Blob([${JSON.stringify(text)}], { type: 'text/plain' })`);
      const r = await page.evaluate(`(async () => { try { await navigator.clipboard.write([new ClipboardItem({ ${items.join(', ')} })]); return 'ok'; } catch (e) { return e.message; } })()`);
      if (r !== 'ok') throw new Error('clipboard write failed: ' + r);
    },
    drop: async ({ text, html }, x, y) => {
      const items = [];
      if (text !== undefined) items.push({ mimeType: 'text/plain', data: text });
      if (html !== undefined) items.push({ mimeType: 'text/html', data: html });
      const data = { items, dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await page.cdp('Input.dispatchDragEvent', { type, x, y, data });
    },
    dropFile: async (file, x, y) => {
      const data = { items: [], files: [file], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await page.cdp('Input.dispatchDragEvent', { type, x, y, data });
    },
    ime: async (stages, final) => {
      for (const s of stages) await page.cdp('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
      if (final) await page.cdp('Input.insertText', { text: final });
      else await page.cdp('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    },
  };
}

// Firefox: the clipboard from the browser window (system access), as another app leaves it.
function firefoxAbilities(page) {
  return {
    setClipboard: async ({ text, html }) => {
      await page.browserEval(`(() => {
        const t = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
        t.init(null);
        const add = (flavor, data) => { t.addDataFlavor(flavor); const s = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString); s.data = data; t.setTransferData(flavor, s); };
        ${html !== undefined ? `add('text/html', ${JSON.stringify(html)});` : ''}
        ${text !== undefined ? `add('text/plain', ${JSON.stringify(text)});` : ''}
        Services.clipboard.setData(t, null, Ci.nsIClipboard.kGlobalClipboard);
        return true;
      })()`);
    },
  };
}

module.exports = { plainText, formattingIn, webStep, chromeAbilities, firefoxAbilities };
