# Writing an adapter

An adapter connects the cases to one editor in one app. It opens the editor, performs each
step as real input, and reads back what the app would save or publish.

## The contract

```js
{
  name: 'app/surface/browser',   // shown in reports
  platform: 'mac',               // 'mac' | 'ios' | 'android' | 'windows' | 'linux'
  supports: ['paste', 'drop', 'dropFile', 'ime'],   // what the driver can really do
  reset(),        // an empty editor, focused, caret in it
  step(step),     // one step (vocabulary below), as real input
  read(),         // { text, empty, focused, formatting: [descriptions] }
  errors(),       // optional: page or app errors so far
  close(),
}
```

`read().text` is **the text the app would publish or save as a draft**, not the DOM's
`innerText`: for a note, the event content; for a markdown editor (articles, recipes), the
markdown it writes. That is what the cases compare against, so a screen that shows one thing
and publishes another fails.

`empty` is whether the editor reads as empty (placeholder showing, Post disabled).
`formatting` lists anything a plain-text editor never makes: bold, links, colors, images,
lists. An editor that is meant to format (a rich long-form editor) reports only formatting
that would not survive into what it publishes.

A case whose `needs` the adapter does not list in `supports` is reported as skipped. Never
fake a capability: a synthetic paste event does not run the browser's own paste.

## The steps

| step | meaning |
|---|---|
| `['type', s]` | text as a keyboard delivers it |
| `['key', k]` | `Enter`, `ShiftEnter`, `Backspace`, `Delete` |
| `['move', d]` | `left right up down wordLeft wordRight lineStart lineEnd docStart docEnd` |
| `['select', d]` | the same, extending the selection |
| `['selectAll']` | |
| `['delete', k]` | `wordBack`, `wordForward`, `lineBack` |
| `['undo']`, `['redo']` | |
| `['copy']`, `['cut']`, `['paste']` | the editor's own clipboard keys |
| `['paste', { text, html }]` | put this on the system clipboard as another app would, then paste |
| `['drop', { text, html }]` | drag this in from another page, drop it at the end of the text |
| `['dropFile', name]` | drag a file from `fixtures/` in |
| `['ime', [stages], final]` | an input method composing each stage, then committing `final` (`''` cancels) |

On macOS, `lib/keys-mac.js` gives the key and modifiers for each step. Chrome over DevTools
also needs the editing command name (a key event there carries no meaning on a Mac by itself);
Firefox and native platforms map modifiers themselves.

## Web apps

`lib/web.js` has everything a browser adapter shares: `webStep` (steps as real input on a
page), the clipboard, drag and drop and input methods for Chrome (`chromeAbilities`) and the
clipboard for Firefox (`firefoxAbilities`), a plain-text reader for a `contenteditable`
(`plainText`), and `formattingIn`. `adapters/sidecar.js` is a complete example.

A page object needs `evaluate(expr)`, `press(key, { shift, alt, meta, ctrl, commands })` and
`type(text)` with real input (Chrome: `Input.dispatchKeyEvent` / `Input.insertText`;
Firefox: WebDriver BiDi `input.performActions`), plus `cdp(method, params)` in Chrome or
`browserEval(expr)` in Firefox for the clipboard, drop and input methods.

For a SvelteKit app, start the dev server, open the composer's route in a fresh profile
signed in with a throwaway key, and read the text from the same function that builds the
event (or from the editor's own serializer, such as TipTap's `getText` or the markdown
writer), never from `innerText`.

## Native apps (iOS, Android)

Native runners read `cases.json` and run each case by id.

**iOS (XCUITest).** Run in the simulator with the hardware keyboard connected, so modifier
keys reach the text view: `typeText` for `type`, `typeKey(.leftArrow, modifierFlags:
.option)` and friends for moves and deletes, `UIPasteboard.general.setItems([[
"public.html": html, "public.utf8-plain-text": text ]])` and then Cmd+V for `paste`. Read
the text through a debug-only accessibility value or launch argument that exposes what the
view model would publish, not the text view's displayed string.

**Android (Compose UI tests or instrumentation).** `performTextInput` for `type`,
`performKeyInput { withKeyDown(Key.CtrlLeft) { pressKey(Key.DirectionLeft) } }` for word
moves, `ClipboardManager.setPrimaryClip(ClipData.newHtmlText(...))` and then paste for
`paste`. Android word movement differs from the Mac (Ctrl+Right stops at the start of the next
word): report `platform: 'android'` and list case ids whose expectation differs in the runner,
with the reason, rather than editing the shared expectation.

Report results in the same shape (`{ id, group, status: 'pass' | 'fail' | 'skip', note }`)
so runs on every platform can be compared side by side.
