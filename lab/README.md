# The editor lab

`cases.js` checks what an editor holds as you type. The lab checks what a composer **signs**:
it drives each app through every feature (a note, a mention, a quote, a picture, a reply, a
poll, an article, a recipe…), takes the event that reaches the relay, and checks it against
the NIPs and the shared recipe fixtures. Every run writes down exactly what was signed.

    SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --surface compose
    SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --surface panel
    SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --browser firefox --only note,reply
    SIDECAR_ROOT=/path/to/sidecar node lab/run.js sidecar --ids note-image,reply-article

Options: `--surface` (the adapter's surfaces), `--browser chrome|firefox`, `--only` groups
(`note reply poll article recipe`), `--ids` feature ids, `--out` a report folder (default
`lab/reports/`, which git ignores). The exit code is 1 when any feature fails.

## What it is made of

- **`server.js`, the lab's own network.** One TLS port on 127.0.0.1 that is both a Nostr relay
  (NIP-01, NIP-11) and a Blossom server (BUD-01/02), recording every event and every upload,
  with the upload's signed authorization. TLS because composers refuse a Blossom server that
  is not `https://`; the certificate is made for the run and thrown away. It checks each
  event's id and keeps nothing between runs.
- **`features.js`, the list.** Each feature is app-neutral steps (open the article form, type,
  attach a picture, publish) and checks on the signed event. Expectations follow the NIPs and
  `recipes/fixtures.json`, not what an app does today, so a gap fails until it is fixed. A
  check marked advice (good practice a NIP allows but does not require) is reported with ⚠
  and never fails a feature.
- **`run.js`, the runner.** Seeds what each feature needs from other people (a note to answer,
  an article to comment on), resets the app, runs the steps, waits for the event, checks its
  id and signature and everything the feature expects, and writes
  `reports/<app>-<surface>-<browser>-<time>.json` and `.md`: a table of every feature and
  every signed event in full.
- **`adapters/<app>-lab.js`, one per app.** Starts the app against the lab, says which features
  it can run (`abilities`), and carries out each step its own way.

## Nothing leaves the machine

Every account's relays (NIP-65) and Blossom server (kind 10063) are the lab's. Chrome is also
started with every host but 127.0.0.1 mapped to nowhere, so a fallback (an upload sent to a
public host, a bootstrap relay) fails instead of publishing a test event. Firefox has no such
flag, so the Sidecar adapter runs no upload in Firefox.

## Adapters

### Sidecar (`adapters/sidecar-lab.js`)

The real extension, through Sidecar's own `test/helpers/real-extension.js`. Surfaces:
`compose` (the full-size composer: every feature) and `panel` (the side panel's composer:
notes and replies). Replies are opened with Sidecar's dev tool, Reply to any event; pastes
go through the real system clipboard; files through the DevTools protocol (Chrome only).

### Zap Cooking web (next)

The plan for `adapters/zapcooking-lab.js`: run the frontend's dev server; open it in Chrome
with Sidecar loaded as its NIP-07 signer (the Sidecar adapter's start-up, reused), so signing
is real and the account's keys never leave the extension; point the app's relays and Blossom
server at the lab, through the same NIP-65 and kind 10063 events if it reads them, or a
dev-only setting if it does not; and carry out the steps in its own forms. The recipe features
already compare against `recipes/fixtures.json`, which is the parity Zap Cooking and Sidecar
both owe.

### iOS and Android

The step vocabulary is app-neutral on purpose: a native runner (XCUITest, Android
instrumentation) can read `features.js`'s steps and expectations the way it reads
`cases.json`, publish to a lab started on the host, and report the same way.

## Adding a feature

Add it to `features.js` with the steps a person takes and what the event must say, and run it
against every adapter. A step no adapter knows yet goes in the vocabulary at the top of the
file and in each adapter. Write the expectation from the NIP or the fixture, not from what
an app happens to publish.
