# The composer component

One composer, built once, used by Sidecar, Zap Cooking (web, iOS, Android) and any other Nostr
client. Every feature Sidecar's composer has is in it, each one an option an app turns on or
off. editor-matrix is its conformance suite: the editing cases every build passes, and feature
cases that run only when the feature is on.

Status: design. The code that becomes the component is Sidecar's composer today
(`composer-core.js`, with `compose.js` and the side panel's sheet as its two hosts).

## Layers

1. **The model** (no DOM, no network): the draft (text, the media strip, a quote, a poll,
   reply target, kind), the plain-text serializer, the event builder (content and tags), URL
   rules (media detection, tracking parameters, boundaries), draft summaries. Plain JavaScript
   that runs in Node, so it can be tested without a browser, and the reference a native port
   is checked against.
2. **The editor** (web): the `contenteditable` with mention pills, plain-text paste and drop,
   copy that writes plain text, the empty state, the caret rules around pills. Native apps
   build their own editor against the same model contract and the same cases.
3. **Features**: each an option, each with its own UI and its own cases (list below).
4. **Host services**, supplied by the app: everything that touches keys, relays, storage or
   the network. The component never signs, stores or fetches on its own.

## Host services

| service | used by |
|---|---|
| `signEvent(template)` | publishing; relay drafts; NIP-98 upload auth |
| `encrypt` / `decrypt` (NIP-44, own key) | relay drafts |
| `publish(event, relays)` → per-relay results | publishing, the relay report |
| `query(filter, relays)` | quotes, mentions, link lookups, relay drafts |
| `profiles.search(text)`, `profiles.get(pubkey)` | mention suggestions, pill names |
| `uploader` (Blossom server list, fallback) | media upload |
| `storage.get/set` | local drafts, settings the composer reads |
| `fetchPreview(url)` | link cards (optional; off sends nothing to the link's site) |
| `t()`, number and date formatting | every string (keys are the English text) |
| `theme` (CSS custom properties) | look; no app styles are baked in |
| `onPublished`, `onError`, `toast` | the app's own receipts and messages |

## Features (options)

Each line is an option, default in brackets for a plain note composer. Sidecar turns them all
on; an app turns on what fits its use.

**Text**
- `mentions` [on]: @ suggestions, pills, `nostr:` references in content, `p` tags.
- `bareRefs` [on]: a pasted `npub…`/`note1…` becomes a `nostr:` reference.
- `codeBlocks` [on]: fenced code shown as a block, copyable.
- `emoji` [on]: the emoji picker (searchable, skin tones).
- `gif` [off]: GIF search (needs a GIF provider).
- `counter` [on]: the length meter.
- `trackingTags` [on]: offers to strip tracking parameters from pasted links, never does it
  unasked; the known-host list is shared data.

**Media**
- `media` [on]: attach images and video from files, paste or drop.
- `mediaPipeline` [on]: what happens before upload: EXIF and location stripped, orientation
  corrected, HEIC refused with a reason, HDR handled (a pasted HDR image toned to standard
  range), recompressed when large, video type, size and cover read.
- `upload` [on]: Blossom first (the user's own servers), then the fallback, per-file timeouts
  by size, the fallback announced, never silent.
- `imeta` [on]: NIP-92 tags (dimensions, type, size), alt text.
- `altText` [on]: the alt-text editor per attachment.
- `strip` [on]: attachments shown as a strip beside the text, not in it; **the strip is the
  order** they are published in; drag to reorder; pictures and quotes in their own blocks.
- `urlDrawer` [on]: each attachment's link, copyable with a check, under the strip.
- `attachOffer` [on]: a media URL pasted on its own line is offered as an attachment (cut from
  the text only when it sits on a boundary); never done unasked.
- `lightbox` [on]: attachments open full size.

**Notes inside notes**
- `quotes` [on]: a pasted note reference becomes a quote block under the text, looked up and
  shown; a quote not found goes back to the text with a reason; quote placement in the strip.
- `linkCards` [off]: previews of pasted links (fetches the page).

**Kinds and modes**
- `replies` [on]: reply threading tags (NIP-10 for notes, NIP-22 for comments).
- `polls` [off]: poll editor and tags.
- `longform` [off]: articles (kind 30023) with Write and Preview. A picture pasted, dropped or
  picked goes into the body as GitHub does: an `![Uploading name…]()` line while it uploads,
  replaced by `![](url)` when it lands, in a paragraph of its own (blank lines around it), and
  taken out again if the upload fails. Every picture's alt text can be set from the Preview.
  Publishing always goes through a review of the whole piece (the button says Review), with
  Publish or Back to editor and no timer; `sendDelay` does not apply.
- `recipes` [off]: the Zap Cooking recipe form and its markdown sections and tags.

**Before and after sending**
- `drafts` [on]: autosave locally; reopen exactly as written; a set-aside note when a quote
  interrupts; the saved-drafts list.
- `relayDrafts` [off]: NIP-37 drafts on the user's private relays, explicit, never automatic.
- `pow` [off]: proof of work, cancellable.
- `sendDelay` [on]: the review countdown before an irreversible publish (notes; articles and
  recipes always review without one).
- `duplicateGuard` [on]: the same note twice in a row is caught.
- `relayReport` [on]: which relays took the note, which refused, and why, in words.
- `clientTag` [option]: the app's own `client` tag, off when the user says so.

## Conformance

editor-matrix grows in three ways to cover this:

1. **Cases name the features they need** (`features: ['attachOffer']`), as they name driver
   capabilities today; an adapter lists the features its build turns on, and the rest skip.
2. **`read()` returns the draft, not only the text**: `{ text, media: [...], quote, offers,
   tags }`, so a case can say "pasting this URL offers an attachment", "dragging the second
   picture first reorders the strip", "copying a URL from the drawer puts exactly it on the
   clipboard".
3. **A publish check**: for a sample of cases, the signed event's content and tags, compared
   with what the draft showed.

The model layer gets its own unit tests in the component's repository; the cases test the
whole thing through real input.

## Getting there from Sidecar

In place first, then out:

1. Draw the service boundary inside Sidecar: `installComposer(deps)` already takes most of
   the services above (`NT`, `call`, profile lookups, relay pool, upload notices); make it
   the only way the composer reaches the extension.
2. Turn each feature into an option read from one config, with Sidecar passing everything on.
   Sidecar keeps working and its tests keep passing at every step.
3. Lift the model and the editor into the component's own repository; Sidecar depends on it.
4. Wrap it for the web as a custom element (`<nostr-composer>`) with an ESM API, so a Svelte
   app (zap.cooking) or anything else mounts it without a framework adapter.
5. Mobile: native editors against the model's contract, checked by the same cases.
