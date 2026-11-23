# Composer findings the cases cannot run

What the composers got wrong that a case in `cases.js` cannot check: where the caret is drawn
rather than what the text is, and what a reply publishes rather than how it is typed. Each
finding says what went wrong, the rule that prevents it, and how to check it by hand or in
an app's own tests. A finding that a case can check is a case instead, and is listed here only
to say so.

✅ done · ❌ has the bug · ? not yet checked · — does not apply.

| Finding | Sidecar | Web | iOS | Android |
|---|---|---|---|---|
| [The caret goes back to the first line when everything is deleted](#the-caret-after-deleting-everything) | ✅ | ? | — native placeholder | — native placeholder |
| [Pasted HTML paragraphs keep their blank line](#pasted-html-paragraphs) (case `rich-html-only-paragraphs`) | ✅ | ? | ? | ? |
| [A comment names its root's kind](#a-comments-root-kind) | ✅ | ? | ? | ? |
| [A reply to anything but a note is a comment](#replies-to-articles-and-recipes) (lab `reply-article`) | ✅ | ? | ? | ? |
| [A hashtag is a t tag](#hashtags) (lab `note-hashtag`) | ✅ | ? | ? | ? |
| [A picture's imeta from what the server answered](#a-pictures-imeta) (lab `note-image`, advice) | ◐ only with a description | ? | ? | ? |

## The caret after deleting everything

Type something, delete it all, and the caret must be back on the first line, on the
placeholder's first letter, as in an editor never typed in. In a `contenteditable` it went a
line lower.

**Why.** Deleting everything leaves the `<br>` a browser keeps to hold the emptied line open.
An editor that keeps it (removing it by hand cuts the browser's undo history, so Select All,
Delete, Undo brings nothing back in Firefox) still counts as empty and shows its placeholder.
A placeholder drawn in the flow (`::before { display: block }`) takes the first line itself
and pushes the `<br>`'s line, and the caret on it, below.

**The rule.** The placeholder lies over the first line and takes no room: out of the flow
(`position: absolute`, no `top`, so it stays where it was drawn), with the editor's own
inline padding so it wraps and aligns as the text will.

**Check.** Type a word, delete it, look at the caret. Sidecar's test measures it:
`test/placeholder-caret.browser.test.js`.

## Pasted HTML paragraphs

Two paragraphs pasted from an app that puts only HTML on the clipboard must keep the blank
line between them: `<p>one</p><p>two</p>` is `one\n\ntwo`, as the browser's own plain text of
it reads. A line break inside a paragraph stays one line break. The cases
`rich-html-only-paragraphs` and `rich-html-only-line-break` run it. A bare editor fails the
first too, so this is browser behavior an app has to handle; Sidecar handles it now.

## A comment's root kind

A NIP-22 comment's `K` tag is the kind of its root: `30023` for a comment on an article,
`30023` for a recipe, and only `1` when the root is a note. Sidecar's forced kind 1111 reply
wrote `K` = `1` whatever it answered, so a comment on an article was filed under notes. A
comment on an addressable event (an article, a recipe) should also carry its address: `A`
for the root and `a` for the parent, beside `E` and `e`, which Sidecar adds.

## Replies to articles and recipes

A reply to a kind 1 note is a kind 1 note (NIP-10). A reply to anything else, an article or a
recipe included, is a kind 1111 comment (NIP-22). Sidecar answers only a comment with a
comment and everything else with a kind 1 note, so its reply to a recipe was a note that Zap
Cooking's comments did not show; it now comments, with `A`, `E`, `K` and `P` for the root and
`a`, `e`, `k` and `p` for the parent. The comment form for each kind of root, and what each
app shows under a recipe, should agree.

## Hashtags

`#EditorLab` in a note publishes a `t` tag, lowercase: `["t", "editorlab"]` (NIP-24). Clients
and relays find posts by hashtag through `#t` filters, so a hashtag with no tag is a word
nobody's search finds. Sidecar wrote the hashtag in the text and no tag; it now tags each
once, lowercase, and not a `#` inside a link or code or before a bare number. The lab's
`note-hashtag` runs it.

## A picture's imeta

A Blossom server answers an upload with the file's URL, type and hash, and NIP-92 lets a note
carry them in an `imeta` tag (`url`, `m`, `x`, `dim`), so a reader can size the picture and
check it before fetching. Sidecar writes an `imeta` only when there is a description or a
video's details, so a plain picture publishes as a bare URL. Allowed, not required: the lab
reports it as advice.

