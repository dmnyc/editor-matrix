# Findings

What each run worth keeping found: the app and surface, the count before and after a change,
which cases a fix turned, and what the matrix could not see. Newest first. A finding that
shows a gap in the matrix itself links to its issue; a fix links to the app's pull request.

Each entry names the editor-matrix commit it ran (the case set) and the app commit, so the
numbers can be reproduced.

## 2026-11-21 · Zap Cooking web · note, reply, article · Chrome (headless, macOS)

Cases: 142, editor-matrix `a499dc7`. App: zapcooking/frontend `95c583b9` (unchanged) and the
branch `fix/composer-editor-matrix` on top of it. Adapter: `adapters/zapcooking-web.js`.

| surface | before | after |
|---|---|---|
| control (a bare editor) | 126 / 142 | n/a |
| note (PostComposer) | 123 / 142 | 141 / 142 |
| reply (ReplyComposer) | 123 / 142 | 141 / 142 |
| article (TiptapEditor) | 122 / 142 | not changed yet |

The note and reply composers share one controller (`src/lib/mentionComposer.ts`), so each fix
turned the same cases in both.

### Fixed in the app

- **The placeholder never came back after the box was cleared.** Chrome leaves a `<br>` (or
  `<div><br></div>`) behind when everything is deleted, and the placeholder was CSS `:empty`,
  which that holder defeats. The composer now marks itself empty when it holds no text, no
  mention and at most one line holder, and leaves the holder in place, since clearing the
  editor's HTML would also clear its undo history.
  Cases: `enter-space-bs-bs`, `sel-all-backspace`, `sel-all-multiline-delete`, `bs-all-chars`,
  `bs-to-empty-from-lines`, `word-bs-twice`, `line-bs`, `cut-all-empty`, `emoji-only-bs`.
- **Undo did not undo a paste.** The paste handler built the text by hand
  (`range.insertNode`), which never reaches the browser's undo stack, so Undo after a paste
  undid the typing before it. Paste now goes through `execCommand('insertText')`.
  Cases: `undo-paste`, `redo-paste`, `undo-paste-lines`, and `paste-trailing-newline` with them.
- **A stray `\r` from Windows line endings** came into the note. Cases: `paste-crlf`.
- **A clipboard holding only HTML pasted nothing.** The handler read `text/plain` only; it now
  reads the HTML as text when there is no plain text. Cases: `rich-html-only`.
- **Copying lines with a blank line among them added a trailing newline**, Chrome's own
  plain-text flavor of a multi-block selection. Copy and cut now write the composer's own
  serialization. Cases: `copy-paste-own-blank-lines`.
- **Text dropped in from a page kept its bold, colors and pictures.** There was no drop handler,
  and a drop never reaches the paste handler. Dropped text now goes in as plain text at the
  drop point, as one undoable step. Cases: `drop-rich`, `drop-rich-image`.

### Found by hand, invisible to the matrix

- **After the box was cleared, the caret sat after the placeholder, not before it.** The
  placeholder was inline text on `::before`, laid out on the same line as the leftover `<br>`,
  so the caret was drawn at its end. The text was right throughout, so every case passed. It
  is fixed by floating the placeholder with no height (as TipTap's placeholder does).
  The matrix compares text only and cannot see where the caret is drawn: see
  [#1](https://github.com/dmnyc/editor-matrix/issues/1).

### Still failing

- `undo-twice` (note, reply, control): Chrome folds typing, Enter and more typing into one
  undo step. A bare editor fails it too; fixing it means the composer keeping its own undo
  grouping.

### Article (TipTap): baseline only

122 / 142. Of the 20 failures, these are the editor's:

- **Undo groups by time, not by the kind of edit** (ProseMirror's 500 ms `newGroupDelay`).
  Typed text and a Backspace within half a second are one step, so Undo takes both:
  `undo-backspace`, `undo-word-bs`, `undo-enter`, `undo-select-all-delete`, `undo-paste`,
  `undo-cut`. At a slower pace they pass. `undo-twice` fails here as in every Chrome editor.
  See [#3](https://github.com/dmnyc/editor-matrix/issues/3).
- **A picture in pasted or dropped HTML goes in as an image that was never uploaded**,
  including a broken one (`src=x`): `rich-image-only`, `rich-script`, `drop-rich-image`.
- **Pasted table cells run together** ("ab"): `rich-table`.
- **A whole copied paragraph pasted back starts a new paragraph** instead of joining the line:
  `copy-paste-own`, `copy-paste-own-lines`.
- `enter-over-all`, `only-enters`: Select All + Enter leaves one empty paragraph, and two empty
  paragraphs read as empty.

The rest come from reading a block editor's text as plain lines: TipTap makes a paragraph per
pasted line and drops the blank line between (`paste-paragraphs`, `rich-paragraphs`), and a
pasted list is list items (`rich-list`). Both publish the same markdown as the plain text
would. See [#2](https://github.com/dmnyc/editor-matrix/issues/2).

`bs-at-start` and `emoji-del-fwd` failed once in the full run and pass on their own: a race
between the adapter's reset (a fresh editor, focused at its end) and the first key, not the
editor's.
