'use strict';

// ZAP COOKING ON THE WEB: the SvelteKit app's dev server (ZAPCOOKING_URL, default
// http://localhost:5173) in a plain headless Chrome (lib/chrome.js), one composer per surface.
//
//   surface  'note'     the note composer (PostComposer, opened as the post modal)
//            'reply'    the reply composer (ReplyComposer), mounted on the page
//            'article'  the long-form editor (TiptapEditor, TipTap), mounted on the page
//            'control'  a bare contenteditable on the same page: no app code on it
//
// read().text is the text the app saves as the note's draft and publishes from: the app's
// own serializer (htmlToPlainText in src/lib/mentionUtils.ts) run on the editor, loaded from
// the dev server so it is the code under test, never innerText.

const { plainText, formattingIn, webStep } = require('../lib/web');
const { startChrome, sleep } = require('../lib/chrome');

const THROWAWAY_PUBKEY = '62c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7';
const NOTE = '.composer-modal .composer-input';

async function startZapCooking({ url = process.env.ZAPCOOKING_URL || 'http://localhost:5173', headless = true } = {}) {
  const chrome = await startChrome({ headless });
  return { chrome, url };
}

async function openNote(tab) {
  // The post modal, opened the way the app's own buttons do.
  await tab.evaluate(`(async () => {
    try { localStorage.removeItem('zapcooking_note_draft'); } catch (_) {}
    const m = await import('/src/lib/postComposerStore.ts');
    m.postComposerOpen.set(true);
  })()`);
  await tab.waitFor(`!!document.querySelector('${NOTE}')`);
}

async function zapcookingAdapter(z, { surface = 'note' } = {}) {
  // Signed in with a throwaway key (05…05, nobody's account): the note composer only
  // opens for a signed-in reader. Nothing is published; the cases never press Post.
  const tab = await z.chrome.openPage(z.url + '/');
  await tab.waitFor(`document.readyState === 'complete'`, 60000);
  await sleep(1500);
  await tab.evaluate(`localStorage.setItem('nostrcooking_privateKey', '${'05'.repeat(32)}');
    localStorage.setItem('nostrcooking_loggedInPublicKey', '${THROWAWAY_PUBKEY}');
    localStorage.setItem('nostrcooking_authMethod', 'privateKey'); location.href = '/feed';`);
  await sleep(1500);
  await tab.waitFor(`document.readyState === 'complete'`, 60000);
  await sleep(4000);
  await tab.evaluate(`(async () => {
    window.__plainText = ${plainText.toString()};
    window.__formattingIn = ${formattingIn.toString()};
    window.__mu = await import('/src/lib/mentionUtils.ts');
  })()`);

  // Per surface: the editor element, how to empty it, and how to read it.
  let ED;
  let serialize;
  let emptyExpr = null;        // null: the placeholder's ::before decides
  let formattingExpr = `__formattingIn(ed, '[data-mention]')`;
  let resetExpr = `(() => { const ed = document.querySelector(ED); ed.innerHTML = ''; ed.focus();
    ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); })()`;
  if (surface === 'control') {
    await tab.evaluate(`(() => { const d = document.createElement('div'); d.id = '__control'; d.contentEditable = 'true';
      d.style.cssText = 'position:fixed;left:20px;top:20px;width:420px;min-height:200px;background:#fff;color:#000;font:16px sans-serif;z-index:2147483647;white-space:pre-wrap';
      document.body.appendChild(d); })()`);
    ED = '#__control';
    serialize = `__plainText(ed)`;
    emptyExpr = `!text`;
  } else if (surface === 'note') {
    await openNote(tab);
    ED = NOTE;
    serialize = `__mu.htmlToPlainText(ed)`;
  } else if (surface === 'reply') {
    // The real ReplyComposer, mounted on the page with a stand-in parent note (never
    // published: the cases never press Post). Same serializer as the note composer.
    await tab.evaluate(`(async () => {
      const { default: ReplyComposer } = await import('/src/components/comments/ReplyComposer.svelte');
      const host = document.createElement('div');
      host.id = '__reply-host';
      host.style.cssText = 'position:fixed;left:20px;top:20px;width:520px;z-index:2147483647;background:#fff';
      document.body.appendChild(host);
      const parent = { id: 'f'.repeat(64), pubkey: '${THROWAWAY_PUBKEY}', kind: 1, content: 'parent', tags: [], created_at: 1, tagId: () => 'f'.repeat(64), tagReference: () => ['e', 'f'.repeat(64)], encode: () => 'note1x' };
      window.__reply = new ReplyComposer({ target: host, props: { parentEvent: parent, draftKey: '__editor-matrix' } });
    })()`);
    await tab.waitFor(`!!document.querySelector('#__reply-host .reply-composer-input')`);
    ED = '#__reply-host .reply-composer-input';
    serialize = `__mu.htmlToPlainText(ed)`;
  } else if (surface === 'article') {
    // The long-form editor (TiptapEditor), mounted fresh for every case so no undo history
    // carries over. The text is TipTap's own (getText, a block per line); formatting counts
    // only what the article's markdown cannot carry (styles, colors, fonts, tables,
    // pictures that were never uploaded), since bold, links, headings and lists are what
    // this editor is for.
    await tab.evaluate(`(async () => {
      const { default: TiptapEditor } = await import('/src/components/reads/TiptapEditor.svelte');
      const host = document.createElement('div');
      host.id = '__article-host';
      host.style.cssText = 'position:fixed;left:20px;top:20px;width:720px;z-index:2147483647;background:#fff;color:#000';
      document.body.appendChild(host);
      window.__mountArticle = async () => {
        if (window.__article) window.__article.$destroy();
        host.innerHTML = '';
        window.__article = new TiptapEditor({ target: host, props: { content: '' } });
        for (let i = 0; i < 50 && !(window.__article.getEditor && window.__article.getEditor()); i++) await new Promise((r) => setTimeout(r, 20));
      };
      window.__articleFormatting = (root) => {
        const OK = /^(P|BR|STRONG|EM|B|I|A|H1|H2|H3|UL|OL|LI|BLOCKQUOTE|CODE|PRE|S|HR|SPAN)$/;
        const found = [];
        root.querySelectorAll('*').forEach((el) => {
          if (el.closest('[data-type=mention]') && !el.matches('[data-type=mention]')) return;
          const bad = [...el.attributes].map((a) => a.name).filter((n) => n === 'style' || n === 'color' || n === 'face' || n === 'size' || (el.nodeName === 'IMG' && n === 'src'));
          if (!OK.test(el.nodeName) || bad.length || (el.nodeName === 'SPAN' && !el.matches('[data-type=mention]'))) found.push(el.nodeName.toLowerCase() + (bad.length ? '[' + bad.join(',') + ']' : ''));
        });
        return [...new Set(found)];
      };
      await window.__mountArticle();
    })()`);
    await tab.waitFor(`!!document.querySelector('#__article-host .ProseMirror')`);
    ED = '#__article-host .ProseMirror';
    serialize = `__article.getEditor().getText({ blockSeparator: '\\n' })`;
    emptyExpr = `__article.getEditor().isEmpty`;
    formattingExpr = `__articleFormatting(ed)`;
    resetExpr = `(async () => { await __mountArticle(); const ed = document.querySelector(ED); ed.focus(); __article.getEditor().commands.focus('end'); })()`;
  } else {
    throw new Error('unknown surface ' + surface);
  }
  await sleep(500);

  return {
    name: `zapcooking/${surface}/chrome`,
    platform: 'mac',
    supports: ['paste', 'drop', 'dropFile', 'ime'],
    reset: async () => {
      await tab.evaluate(`(() => { const ED = '${ED}'; return ${resetExpr}; })()`);
      await sleep(120);
    },
    step: (st) => webStep(tab, st, {
      dropPoint: () => tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); const r = document.createRange(); r.selectNodeContents(ed);
        const rects = [...r.getClientRects()]; const box = ed.getBoundingClientRect(); const last = rects[rects.length - 1] || box;
        return { x: Math.min(last.right + 3, box.right - 4), y: last.top + Math.max(last.height, 10) / 2 }; })()`),
    }),
    read: () => tab.evaluate(`(() => { const ed = document.querySelector('${ED}');
      const text = ${serialize};
      // The placeholder is CSS on ::before; it shows when that has content.
      const before = getComputedStyle(ed, '::before').content;
      const empty = ${emptyExpr || `(before !== 'none' && before !== 'normal' && before !== '""')`};
      return { text, empty, focused: document.activeElement === ed, formatting: ${formattingExpr} }; })()`),
    errors: async () => tab.errors.slice(),
    close: () => tab.close(),
  };
}

module.exports = { startZapCooking, zapcookingAdapter };
