'use strict';

// WHAT A TEXT EDITOR MUST DO. One list of cases, written once, run against every editor
// we ship: Sidecar's composers in Chrome and Firefox, and Zap Cooking on the web, iOS and
// Android. Nothing in it names an app, a browser, or a key code. A case is steps a person
// takes and what the editor must hold afterwards; an adapter turns the steps into that
// app's real input (real keys, the real clipboard) and reads back the text the app would
// save or publish.
//
// A CASE
//   id      short, stable, unique: it names the case in reports and in native test runners
//   group   for --only and for the report
//   steps   what a person does, in order (the vocabulary is below)
//   text    the text the editor holds afterwards, as the app would save it. '‸' marks
//           where the caret must be: the runner types '‸' there and compares.
//   empty   optional: whether the editor reads as empty (its placeholder showing)
//   clean   optional: no formatting came in (no bold, links, colors, images, lists)
//   needs   optional: capabilities the driver must have ('paste', 'drop', 'ime');
//           a case whose needs the driver lacks is reported as skipped, not passed
//   why     optional: one line on what the case is guarding, when the name is not enough
//
// THE STEP VOCABULARY
//   ['type', s]               text as a keyboard delivers it
//   ['key', k]                'Enter' | 'ShiftEnter' | 'Backspace' | 'Delete'
//   ['move', d]               caret moves; d is 'left' 'right' 'up' 'down' 'wordLeft'
//                             'wordRight' 'lineStart' 'lineEnd' 'docStart' 'docEnd'
//   ['select', d]             the same, extending the selection (Shift+…)
//   ['selectAll']
//   ['delete', k]             'wordBack' | 'wordForward' | 'lineBack'
//   ['undo'] ['redo']
//   ['copy'] ['cut'] ['paste']           the editor's own clipboard keys
//   ['paste', { text, html }]            put this on the system clipboard, then paste it
//   ['drop', { text, html }]             drag this in from another page and drop it
//   ['dropFile', name]                   drag a file from fixtures/ in from the desktop
//   ['ime', [stages...], final]          an input method: composes the stages, commits final
//
// Platform: the expectations are macOS and iOS editing (Option+arrows end a word, Up on
// the first line goes to its start). A case that only holds on one platform says so in
// `platforms`; an adapter for another platform skips it.

const T = (s) => ['type', s];
const K = (k) => ['key', k];
const M = (d) => ['move', d];
const S = (d) => ['select', d];
const D = (k) => ['delete', k];
const A = ['selectAll'];
const U = ['undo'];
const R = ['redo'];
const P = (text, html) => ['paste', html === undefined ? { text } : { text, html }];
const times = (n, step) => Array.from({ length: n }, () => step);
const lines = (...ls) => ls.flatMap((l, i) => (i ? [K('Enter')] : []).concat(l ? [T(l)] : []));

const CASES = [
  // ---- typing and whitespace ----
  { id: 'type-word', group: 'whitespace', steps: [T('hello')], text: 'hello‸' },
  { id: 'lead-space', group: 'whitespace', steps: [T(' '), T('hello')], text: ' hello‸' },
  { id: 'lone-space', group: 'whitespace', steps: [T(' ')], text: ' ‸', empty: false },
  { id: 'double-space', group: 'whitespace', steps: [T('a'), T(' '), T(' '), T('b')], text: 'a  b‸' },
  { id: 'trail-spaces', group: 'whitespace', steps: [T('hi'), T(' '), T(' ')], text: 'hi  ‸' },
  { id: 'enter-first', group: 'whitespace', steps: [K('Enter'), T('hi')], text: '\nhi‸' },
  { id: 'enter-mid', group: 'whitespace', steps: [T('ab'), M('left'), K('Enter')], text: 'a\n‸b' },
  { id: 'enter-end', group: 'whitespace', steps: [T('ab'), K('Enter')], text: 'ab\n‸' },
  { id: 'enter-twice-end', group: 'whitespace', steps: [T('ab'), K('Enter'), K('Enter'), T('c')], text: 'ab\n\nc‸' },
  { id: 'shift-enter-mid', group: 'whitespace', steps: [T('ab'), M('left'), K('ShiftEnter')], text: 'a\n‸b' },
  { id: 'shift-enter-end', group: 'whitespace', steps: [T('ab'), K('ShiftEnter'), T('c')], text: 'ab\nc‸' },
  { id: 'shift-enter-first', group: 'whitespace', steps: [K('ShiftEnter'), T('hi')], text: '\nhi‸' },
  { id: 'paragraphs', group: 'whitespace', steps: lines('one', '', 'two'), text: 'one\n\ntwo‸' },
  { id: 'many-blank-lines', group: 'whitespace', steps: lines('a', '', '', '', 'b'), text: 'a\n\n\n\nb‸' },
  { id: 'only-spaces', group: 'whitespace', steps: [T('   ')], text: '   ‸', empty: false },
  { id: 'only-enters', group: 'whitespace', steps: [K('Enter'), K('Enter')], text: '\n\n‸', empty: false },
  { id: 'space-after-enter', group: 'whitespace', steps: [K('Enter'), T(' a')], text: '\n a‸' },
  { id: 'indent-line-two', group: 'whitespace', steps: [T('a'), K('Enter'), T('  b')], text: 'a\n  b‸' },
  { id: 'enter-space-bs-bs', group: 'whitespace', steps: [K('Enter'), T(' '), K('Backspace'), K('Backspace')], text: '‸', empty: true },
  { id: 'blank-line-then-delete-it', group: 'whitespace', steps: [T('a'), K('Enter'), K('Enter'), K('Backspace'), T('b')], text: 'a\nb‸' },
  { id: 'type-over-all', group: 'whitespace', steps: [T('hello'), A, T('x')], text: 'x‸' },
  { id: 'enter-over-all', group: 'whitespace', steps: [T('hello'), A, K('Enter')], text: '\n‸', empty: false },
  { id: 'literal-markup', group: 'whitespace', steps: [T('<b>x</b> &amp;')], text: '<b>x</b> &amp;‸', clean: true, why: 'typed markup is text' },

  // ---- moving the caret ----
  { id: 'left-twice', group: 'caret', steps: [T('abc'), M('left'), M('left')], text: 'a‸bc' },
  { id: 'left-past-start', group: 'caret', steps: [T('abc'), ...times(4, M('left'))], text: '‸abc' },
  { id: 'right-past-end', group: 'caret', steps: [T('abc'), M('right')], text: 'abc‸' },
  { id: 'word-left', group: 'caret', steps: [T('hello world'), M('wordLeft')], text: 'hello ‸world' },
  { id: 'word-left-twice', group: 'caret', steps: [T('hello world'), M('wordLeft'), M('wordLeft')], text: '‸hello world' },
  { id: 'word-right', group: 'caret', steps: [T('hello world'), M('docStart'), M('wordRight')], text: 'hello‸ world' },
  { id: 'line-start', group: 'caret', steps: [T('hello world'), M('lineStart')], text: '‸hello world' },
  { id: 'line-end', group: 'caret', steps: [T('hello world'), M('lineStart'), M('lineEnd')], text: 'hello world‸' },
  { id: 'line-start-line-two', group: 'caret', steps: [...lines('ab', 'cd'), M('lineStart')], text: 'ab\n‸cd' },
  { id: 'line-end-line-one', group: 'caret', steps: [...lines('ab', 'cd'), M('docStart'), M('lineEnd')], text: 'ab‸\ncd' },
  { id: 'doc-start', group: 'caret', steps: [...lines('ab', 'cd'), M('docStart')], text: '‸ab\ncd' },
  { id: 'doc-end', group: 'caret', steps: [...lines('ab', 'cd'), M('docStart'), M('docEnd')], text: 'ab\ncd‸' },
  { id: 'up', group: 'caret', steps: [...lines('abc', 'de'), M('up')], text: 'ab‸c\nde' },
  { id: 'up-down', group: 'caret', steps: [...lines('abc', 'de'), M('up'), M('down')], text: 'abc\nde‸' },
  { id: 'up-to-blank', group: 'caret', steps: [...lines('ab', '', 'cd'), M('up')], text: 'ab\n‸\ncd' },
  { id: 'up-over-blank', group: 'caret', steps: [...lines('ab', '', 'cd'), M('up'), M('up')], text: 'ab‸\n\ncd', why: 'the column is remembered across a blank line' },
  { id: 'down-over-blank', group: 'caret', steps: [...lines('ab', '', 'cd'), M('docStart'), M('right'), M('down'), M('down')], text: 'ab\n\nc‸d' },
  { id: 'up-first-line', group: 'caret', steps: [T('abc'), M('left'), M('up')], text: '‸abc' },
  { id: 'down-last-line', group: 'caret', steps: [T('abc'), M('docStart'), M('down')], text: 'abc‸' },
  { id: 'left-over-break', group: 'caret', steps: [...lines('ab', 'cd'), M('lineStart'), M('left')], text: 'ab‸\ncd' },
  { id: 'right-over-break', group: 'caret', steps: [...lines('ab', 'cd'), M('docStart'), ...times(3, M('right'))], text: 'ab\n‸cd' },
  { id: 'left-to-leading-blank', group: 'caret', steps: [K('Enter'), T('a'), M('left'), M('left')], text: '‸\na' },
  { id: 'up-to-leading-blank', group: 'caret', steps: [K('Enter'), T('a'), M('up')], text: '‸\na' },
  { id: 'right-out-of-trailing-blank', group: 'caret', steps: [T('a'), K('Enter'), M('docStart'), M('right'), M('right')], text: 'a\n‸' },

  // ---- selecting ----
  { id: 'sel-left-type', group: 'select', steps: [T('abc'), S('left'), S('left'), T('X')], text: 'aX‸' },
  { id: 'sel-word-left', group: 'select', steps: [T('hello world'), S('wordLeft'), T('X')], text: 'hello X‸' },
  { id: 'sel-line-start', group: 'select', steps: [T('hello world'), S('lineStart'), T('X')], text: 'X‸' },
  { id: 'sel-doc-start', group: 'select', steps: [...lines('ab', 'cd'), S('docStart'), T('X')], text: 'X‸' },
  { id: 'sel-up', group: 'select', steps: [...lines('ab', 'cd'), S('up'), T('X')], text: 'abX‸' },
  { id: 'sel-down', group: 'select', steps: [...lines('ab', 'cd'), M('docStart'), S('down'), T('X')], text: 'X‸cd' },
  { id: 'sel-shrink', group: 'select', steps: [T('abc'), M('docStart'), S('right'), S('right'), S('left'), T('X')], text: 'X‸bc' },
  { id: 'sel-all-right', group: 'select', steps: [T('abc'), A, M('right')], text: 'abc‸' },
  { id: 'sel-all-right-enter', group: 'select', steps: [...lines('ab', '', 'cd'), A, M('right'), K('Enter'), T('x')], text: 'ab\n\ncd\nx‸', why: 'the caret after Select All and Right is on the last line, not between lines' },
  { id: 'sel-all-left', group: 'select', steps: [T('abc'), A, M('left')], text: '‸abc' },
  { id: 'sel-all-backspace', group: 'select', steps: [T('hello'), A, K('Backspace')], text: '‸', empty: true },
  { id: 'sel-all-multiline-delete', group: 'select', steps: [...lines('ab', '', 'cd'), A, K('Delete')], text: '‸', empty: true },
  { id: 'sel-over-break-backspace', group: 'select', steps: [...lines('ab', 'cd'), M('left'), S('up'), K('Backspace')], text: 'a‸d' },
  { id: 'sel-blank-line-type', group: 'select', steps: [...lines('ab', '', 'cd'), M('lineStart'), S('left'), S('left'), T('X')], text: 'abX‸cd' },

  // ---- deleting ----
  { id: 'bs-at-start', group: 'delete', steps: [T('abc'), M('docStart'), K('Backspace')], text: '‸abc' },
  { id: 'del-at-end', group: 'delete', steps: [T('abc'), K('Delete')], text: 'abc‸' },
  { id: 'del-mid', group: 'delete', steps: [T('abc'), M('left'), M('left'), K('Delete')], text: 'a‸c' },
  { id: 'bs-joins-lines', group: 'delete', steps: [...lines('ab', 'cd'), M('lineStart'), K('Backspace')], text: 'ab‸cd' },
  { id: 'del-joins-lines', group: 'delete', steps: [...lines('ab', 'cd'), M('docStart'), M('lineEnd'), K('Delete')], text: 'ab‸cd' },
  { id: 'bs-blank-line', group: 'delete', steps: [...lines('ab', '', 'cd'), M('lineStart'), K('Backspace')], text: 'ab\n‸cd' },
  { id: 'del-blank-line', group: 'delete', steps: [...lines('ab', '', 'cd'), M('docStart'), M('lineEnd'), K('Delete')], text: 'ab‸\ncd' },
  { id: 'bs-leading-blank', group: 'delete', steps: [K('Enter'), T('a'), M('lineStart'), K('Backspace')], text: '‸a' },
  { id: 'bs-all-chars', group: 'delete', steps: [T('ab'), K('Backspace'), K('Backspace')], text: '‸', empty: true },
  { id: 'bs-to-empty-from-lines', group: 'delete', steps: [K('Enter'), T('a'), K('Backspace'), K('Backspace')], text: '‸', empty: true },
  { id: 'word-bs', group: 'delete', steps: [T('hello world'), D('wordBack')], text: 'hello ‸' },
  { id: 'word-bs-twice', group: 'delete', steps: [T('hello world'), D('wordBack'), D('wordBack')], text: '‸', empty: true },
  { id: 'word-del-fwd', group: 'delete', steps: [T('hello world'), M('docStart'), D('wordForward')], text: '‸ world' },
  { id: 'word-bs-at-line-start', group: 'delete', steps: [...lines('ab', 'cd'), M('lineStart'), D('wordBack')], text: 'ab‸cd' },
  { id: 'line-bs', group: 'delete', steps: [T('hello world'), D('lineBack')], text: '‸', empty: true },
  { id: 'line-bs-line-two', group: 'delete', steps: [...lines('ab', 'cd'), D('lineBack')], text: 'ab\n‸' },
  { id: 'line-bs-mid', group: 'delete', steps: [T('hello world'), M('wordLeft'), D('lineBack')], text: '‸world' },

  // ---- undo and redo ----
  { id: 'undo-typing', group: 'undo', steps: [T('hello'), U], text: '‸', empty: true },
  { id: 'undo-redo-typing', group: 'undo', steps: [T('hello'), U, R], text: 'hello‸' },
  { id: 'undo-backspace', group: 'undo', steps: [T('hello'), K('Backspace'), U], text: 'hello', why: 'an undone delete comes back selected, as on a Mac' },
  { id: 'undo-word-bs', group: 'undo', steps: [T('hello world'), D('wordBack'), U], text: 'hello world' },
  { id: 'undo-enter', group: 'undo', steps: [T('ab'), K('Enter'), U], text: 'ab‸' },
  { id: 'undo-enter-first', group: 'undo', steps: [K('Enter'), U], text: '‸', empty: true },
  { id: 'undo-select-all-delete', group: 'undo', steps: [T('hello'), A, K('Delete'), U], text: 'hello', why: 'the caret may sit at either end of the restored text, as long as nothing is lost' },
  { id: 'undo-paste', group: 'undo', needs: ['paste'], steps: [T('a '), P('pasted'), U], text: 'a ‸' },
  { id: 'redo-paste', group: 'undo', needs: ['paste'], steps: [T('a '), P('pasted'), U, R], text: 'a pasted‸' },
  { id: 'undo-paste-lines', group: 'undo', needs: ['paste'], steps: [P('one\ntwo'), U], text: '‸', empty: true },
  { id: 'undo-cut', group: 'undo', needs: ['paste'], steps: [T('hello world'), S('wordLeft'), ['cut'], U], text: 'hello world' },
  { id: 'undo-twice', group: 'undo', steps: [T('one'), K('Enter'), T('two'), U, U], text: 'one‸', why: 'each undo takes one step back, not the whole note' },

  // ---- the clipboard: plain text ----
  { id: 'paste-word', group: 'paste', needs: ['paste'], steps: [P('pasted')], text: 'pasted‸' },
  { id: 'paste-lines', group: 'paste', needs: ['paste'], steps: [P('one\ntwo')], text: 'one\ntwo‸' },
  { id: 'paste-paragraphs', group: 'paste', needs: ['paste'], steps: [P('one\n\ntwo')], text: 'one\n\ntwo‸' },
  { id: 'paste-trailing-newline', group: 'paste', needs: ['paste'], steps: [P('one\n')], text: 'one\n‸' },
  { id: 'paste-leading-newline', group: 'paste', needs: ['paste'], steps: [T('a'), P('\nb')], text: 'a\nb‸' },
  { id: 'paste-leading-spaces', group: 'paste', needs: ['paste'], steps: [P('  indented')], text: '  indented‸' },
  { id: 'paste-mid', group: 'paste', needs: ['paste'], steps: [T('ac'), M('left'), P('b')], text: 'ab‸c' },
  { id: 'paste-lines-mid', group: 'paste', needs: ['paste'], steps: [T('ad'), M('left'), P('b\nc')], text: 'ab\nc‸d' },
  { id: 'paste-over-selection', group: 'paste', needs: ['paste'], steps: [T('hello'), A, P('bye')], text: 'bye‸' },
  { id: 'paste-crlf', group: 'paste', needs: ['paste'], steps: [P('one\r\ntwo')], text: 'one\ntwo‸' },
  { id: 'paste-tab', group: 'paste', needs: ['paste'], steps: [P('a\tb')], text: 'a\tb‸' },
  { id: 'paste-double-space', group: 'paste', needs: ['paste'], steps: [P('a  b')], text: 'a  b‸' },
  { id: 'paste-at-line-two-start', group: 'paste', needs: ['paste'], steps: [...lines('ab', 'cd'), M('lineStart'), P('X')], text: 'ab\nX‸cd' },
  { id: 'copy-paste-own', group: 'paste', needs: ['paste'], steps: [T('hello'), A, ['copy'], M('right'), ['paste']], text: 'hellohello‸' },
  { id: 'copy-paste-own-lines', group: 'paste', needs: ['paste'], steps: [...lines('ab', 'cd'), A, ['copy'], M('right'), ['paste']], text: 'ab\ncdab\ncd‸' },
  { id: 'copy-paste-own-blank-lines', group: 'paste', needs: ['paste'], steps: [...lines('ab', '', 'cd'), A, ['copy'], M('right'), K('Enter'), ['paste']], text: 'ab\n\ncd\nab\n\ncd‸' },
  { id: 'cut-paste', group: 'paste', needs: ['paste'], steps: [T('hello world'), S('wordLeft'), ['cut'], M('docStart'), ['paste']], text: 'world‸hello ' },
  { id: 'cut-all-empty', group: 'paste', needs: ['paste'], steps: [T('hello'), A, ['cut']], text: '‸', empty: true },

  // ---- the clipboard: rich text from another page must come in as plain text ----
  { id: 'rich-bold', group: 'rich', needs: ['paste'], clean: true, steps: [P('bold and italic', '<b>bold</b> and <i>italic</i>')], text: 'bold and italic‸' },
  { id: 'rich-link', group: 'rich', needs: ['paste'], clean: true, steps: [P('a link', '<a href="https://example.com/">a link</a>')], text: 'a link‸' },
  { id: 'rich-color', group: 'rich', needs: ['paste'], clean: true, steps: [P('red text', '<span style="color:red;font-family:Comic Sans MS;font-size:30px">red text</span>')], text: 'red text‸' },
  { id: 'rich-paragraphs', group: 'rich', needs: ['paste'], clean: true, steps: [P('one\n\ntwo', '<p>one</p><p>two</p>')], text: 'one\n\ntwo‸' },
  { id: 'rich-list', group: 'rich', needs: ['paste'], clean: true, steps: [P('a\nb', '<ul><li>a</li><li>b</li></ul>')], text: 'a\nb‸' },
  { id: 'rich-heading', group: 'rich', needs: ['paste'], clean: true, steps: [P('Title\nbody', '<h1>Title</h1><p>body</p>')], text: 'Title\nbody‸' },
  { id: 'rich-table', group: 'rich', needs: ['paste'], clean: true, steps: [P('a\tb', '<table><tr><td>a</td><td>b</td></tr></table>')], text: 'a\tb‸' },
  { id: 'rich-image-only', group: 'rich', needs: ['paste'], clean: true, steps: [T('x'), P('', '<img src="https://example.com/x.png" width="400" height="300">')], text: 'x‸', why: 'a picture in copied HTML is not uploaded, so it must not sit in the note' },
  { id: 'rich-docs', group: 'rich', needs: ['paste'], clean: true, why: 'what a word processor puts on the clipboard',
    steps: [P('from a doc', '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;">from a doc</span></b>')], text: 'from a doc‸' },
  { id: 'rich-html-only', group: 'rich', needs: ['paste'], clean: true, steps: [P(undefined, '<b>only html</b>')], text: 'only html‸', why: 'some apps put only HTML on the clipboard' },
  { id: 'rich-html-only-paragraphs', group: 'rich', needs: ['paste'], clean: true, steps: [P(undefined, '<p>one</p><p>two</p>')], text: 'one\n\ntwo‸', why: 'two paragraphs are two paragraphs: a blank line between them, as the browser\'s own plain text of them reads' },
  { id: 'rich-html-only-line-break', group: 'rich', needs: ['paste'], clean: true, steps: [P(undefined, '<p>one<br>two</p>')], text: 'one\ntwo‸', why: 'a line break inside a paragraph is one line break, not a paragraph' },
  { id: 'rich-mid-line', group: 'rich', needs: ['paste'], clean: true, steps: [T('ac'), M('left'), P('b', '<strong style="color:blue">b</strong>'), T('!')], text: 'ab!‸c', why: 'text typed after a rich paste is not bold or blue either' },
  { id: 'rich-script', group: 'rich', needs: ['paste'], clean: true, steps: [P('safe', '<img src=x onerror="window.__pwned=1"><span>safe</span>')], text: 'safe‸' },

  // ---- dragging text in from another page ----
  { id: 'drop-plain', group: 'drop', needs: ['drop'], steps: [T('a '), ['drop', { text: 'dropped' }]], text: 'a dropped' },
  { id: 'drop-rich', group: 'drop', needs: ['drop'], clean: true, steps: [T('a '), ['drop', { text: 'bold', html: '<b style="color:red">bold</b>' }]], text: 'a bold' },
  { id: 'drop-image-file', group: 'drop', needs: ['dropFile'], clean: true, steps: [T('a'), ['dropFile', 'orange.png']], text: 'a', why: 'a picture dragged from the desktop is an attachment, never an inline image' },
  { id: 'drop-rich-image', group: 'drop', needs: ['drop'], clean: true, steps: [T('a'), ['drop', { text: '', html: '<img src="https://example.com/x.png">' }]], text: 'a' },

  // ---- other characters ----
  { id: 'emoji-bs', group: 'chars', steps: [T('a😀'), K('Backspace')], text: 'a‸' },
  { id: 'emoji-only-bs', group: 'chars', steps: [T('😀'), K('Backspace')], text: '‸', empty: true },
  { id: 'emoji-zwj-bs', group: 'chars', steps: [T('a👨‍👩‍👧'), K('Backspace')], text: 'a‸', why: 'a family emoji is one character to a person' },
  { id: 'emoji-flag-bs', group: 'chars', steps: [T('a🇺🇸'), K('Backspace')], text: 'a‸' },
  { id: 'emoji-skin-bs', group: 'chars', steps: [T('a👍🏽'), K('Backspace')], text: 'a‸' },
  { id: 'emoji-left', group: 'chars', steps: [T('a😀b'), M('left'), M('left')], text: 'a‸😀b' },
  { id: 'emoji-zwj-left', group: 'chars', steps: [T('a👨‍👩‍👧b'), M('left'), M('left')], text: 'a‸👨‍👩‍👧b' },
  { id: 'emoji-del-fwd', group: 'chars', steps: [T('😀b'), M('docStart'), K('Delete')], text: '‸b' },
  { id: 'emoji-sel-left', group: 'chars', steps: [T('a🇺🇸'), S('left'), T('X')], text: 'aX‸' },
  { id: 'accented', group: 'chars', steps: [T('café naïve'), M('wordLeft')], text: 'café ‸naïve' },
  { id: 'cyrillic-word', group: 'chars', steps: [T('привет мир'), D('wordBack')], text: 'привет ‸' },
  { id: 'arabic', group: 'chars', steps: [T('مرحبا بالعالم')], text: 'مرحبا بالعالم‸' },
  { id: 'hebrew-mixed', group: 'chars', steps: [T('שלום hello')], text: 'שלום hello‸' },
  { id: 'cjk', group: 'chars', steps: [T('日本語のテキスト')], text: '日本語のテキスト‸' },
  { id: 'ime-commit', group: 'chars', needs: ['ime'], steps: [['ime', ['に', 'にほ', 'にほん'], '日本']], text: '日本‸' },
  { id: 'ime-after-text', group: 'chars', needs: ['ime'], steps: [T('a '), ['ime', ['に', 'にほ', 'にほん'], '日本'], T('!')], text: 'a 日本!‸' },
  { id: 'ime-after-enter', group: 'chars', needs: ['ime'], steps: [K('Enter'), ['ime', ['か', 'かん'], '漢'], T('字')], text: '\n漢字‸' },
  { id: 'ime-cancel', group: 'chars', needs: ['ime'], steps: [T('a'), ['ime', ['に', 'にほ'], '']], text: 'a‸' },
  { id: 'paste-emoji-lines', group: 'chars', needs: ['paste'], steps: [P('🎉 one\n🎉 two')], text: '🎉 one\n🎉 two‸' },
];

module.exports = { CASES };

// `node cases.js` writes cases.json, for runners that are not JavaScript (XCUITest, Android
// instrumentation): the same list, the same ids.
if (require.main === module) {
  const out = require('node:path').join(__dirname, 'cases.json');
  require('node:fs').writeFileSync(out, JSON.stringify(CASES, null, 1) + '\n');
  console.log(`${CASES.length} cases → ${out}`);
}
