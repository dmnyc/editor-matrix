# editor-matrix

What a text editor must do, written down once and run against every composer we ship.

Every composer bug that reached users so far was ordinary text editing that nobody had
checked: a space typed into an empty note vanished, a word typed against a mention joined
the mention, Delete in front of a mention did nothing, rich text dragged in from a web page
kept its fonts and colors. A person expects any text box to behave the way TextEdit or Notes
does. This repository is that expectation, as cases a machine can run.

It is used by:

- **[Sidecar](https://github.com/dmnyc/sidecar)**: the note composers (full-size tab and side panel), in Chrome and Firefox.
- **Zap Cooking**: web ([zapcooking/frontend](https://github.com/zapcooking/frontend)),
  iOS ([zapcooking/zapcooking_ios](https://github.com/zapcooking/zapcooking_ios)) and
  Android ([zapcooking/zap_cooking_android](https://github.com/zapcooking/zap_cooking_android)):
  short notes, replies, long-form articles and recipes.
- The standalone composer component and its mobile versions, as they are built: the cases
  are its conformance spec.

## How it works

- **`cases.js`** is the list. A case is steps a person takes and the text the editor must
  hold afterwards, with `‸` where the caret must be (the runner types `‸` and compares). It
  names no app, browser or key code. Case ids are stable: reports, bug reports and native
  runners refer to them.
- **`cases.json`** is the same list for runners that are not JavaScript (XCUITest, Android
  instrumentation). Regenerate it with `node cases.js` after changing `cases.js`, and commit
  both.
- **Adapters** (`adapters/`) turn steps into one app's real input and read back the text the
  app would save or publish. Real keys, the real system clipboard, real drag and drop, never
  a synthetic event: a synthetic paste event skips the browser's own paste, so an app that
  forgot to handle paste would pass.
- **The control.** Every web run also drives a bare `contenteditable` in the same browser. A
  failure marked `[a bare editor fails too]` is browser behavior the app left unhandled
  (rich text dropped in keeps its formatting); `[app only]` is the app's own bug.

## Running

Node 22 or later, Chrome and/or Firefox installed. No dependencies.

    # Sidecar (a Sidecar checkout whose test/helpers include the real-extension drivers)
    SIDECAR_ROOT=../sidecar node run.js sidecar --browser chrome
    SIDECAR_ROOT=../sidecar node run.js sidecar --browser firefox --surface panel --only rich,paste
    SIDECAR_ROOT=../sidecar node run.js sidecar --ids enter-first,undo-paste --json results/out.json

`--only` takes groups (`whitespace caret select delete undo paste rich drop chars`), `--ids`
takes case ids, `--no-control` skips the bare editor. The exit code is 1 when any app case
fails.

Firefox has no WebDriver support for drag and drop or input methods; those cases report as
skipped, never as passed.

## When a case fails

1. Check the control column first. `[app only]` is a bug in the app. `[a bare editor fails
   too]` is the browser's default behavior, which the app must still handle when it is
   wrong for a composer (formatting dropped in, a stray `\r`).
2. Fix the app, and add a regression test in the app's own repository if the case is not
   already run there.
3. If the expectation itself is wrong, fix the case and say why in its `why` field. Platform
   behavior is the reference: macOS and iOS editing for now (Option+arrows stop at word
   ends; an undone delete comes back selected).

## Adding cases

Add a case whenever a composer bug is found that no case caught, before fixing it, so the
case is seen to fail first. Keep cases app-neutral; behavior only one app has (mention
pills, attachment offers) belongs in that app's own tests. See
[docs/writing-an-adapter.md](docs/writing-an-adapter.md) for the step vocabulary and for
adding an app, including native runners.

## Recipe composers

The four apps that publish Zap Cooking recipes keep their recipe composers in step through
[recipes/](recipes/README.md): the rule they follow, a table of every recipe-composer behavior
with its state in each app, the exact events a recipe's fields must publish as
(`recipes/fixtures.json`), and the one list of categories with their emoji
(`recipes/categories.json`).
