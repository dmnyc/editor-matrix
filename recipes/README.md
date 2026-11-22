# Recipe composers: one behavior in four apps

Four apps publish Zap Cooking recipes: [Sidecar](https://github.com/dmnyc/sidecar)'s full-size
composer, and Zap Cooking's web, iOS and Android apps. A recipe written in any of them must
come out the same, and writing one must work the same way. This folder is how they are kept
from growing apart.

## The rule

1. **This file is the contract.** The table below lists every behavior of a recipe composer,
   with its state in each app. A change to a recipe composer in any of the four repositories
   updates its column here, in an editor-matrix pull request linked from that change, or says
   in the change that no row moved. A difference nobody wrote down is a bug.
2. **Sidecar leads the design.** A new behavior is built and settled in Sidecar first, or
   agreed here first, then added as a row with the other apps marked *planned*. When two apps
   disagree, the Sidecar behavior is the target, unless it is a Zap Cooking convention Sidecar
   got wrong, in which case the row is fixed here and both change.
3. **What is published never differs.** `fixtures.json` holds form fields and the exact event
   (kind, tags, content) they publish as. Every app's recipe builder has a test that produces
   each fixture exactly. A change to the published format is a change to the fixtures first,
   made with Zap Cooking's site, since its reader is what parses recipes.
4. **One list of categories.** `categories.json` is the list every app suggests from, with the
   emoji shown beside each name. Each app ships a copy and a test that compares its copy with
   this one whenever editor-matrix sits beside it. A category is added or an emoji chosen
   here, then copied out.
5. **Behavior, not widgets.** Mobile matches what a person can do, in the platform's own way:
   Cmd+B on a hardware keyboard and the selection menu's formatting on a touch screen, drag to
   reorder as the platform's list reordering, rich paste from `UIPasteboard` or
   `ClipboardManager`'s HTML. A row that cannot apply to a platform says why.
6. **A gap is a to-do, not a difference.** Every *missing* or *planned* cell is an item in
   that app's handoff doc (`docs/handoffs/composer-editor-matrix.md` on the web,
   `docs/composer-editor-matrix.md` on iOS and Android), and comes off when the cell does.

## The table

✅ has it · ◐ partly · ❌ missing · *planned* · ? not yet checked · — does not apply.
Audited 2026-11-22 from the source of each app; a ? is checked before the first change there.

### What is published

| Behavior | Sidecar | Web | iOS | Android |
|---|---|---|---|---|
| Content in Zap Cooking's `createMarkdown` sections, newline for newline (`fixtures.json`) | ✅ | ✅ | ? | ? |
| Tags: `d`, `title`, `r` source, `t` `zapcooking` and `zapcooking-<title>`, `summary`, `image` per photo, `t` per category, `published_at` | ✅ | ✅ | ? | ? |
| A source with a username or password in it is dropped | ✅ | ? | ? | ? |
| Categories filed under their English names whatever the interface language | ✅ | ? | ? | ? |

### Writing one

| Behavior | Sidecar | Web | iOS | Android |
|---|---|---|---|---|
| Preview: the recipe drawn from what will be published | ✅ | ❌ | ❌ | ❌ |
| Edit a list item in place (Enter or leaving keeps it, Escape takes it back, emptied keeps the old text) | ✅ | ✅ | ◐ rows are fields | ◐ rows are fields |
| Reorder list items by dragging | ◐ Move up only | ✅ | ❌ | ❌ |
| A pasted list becomes items, bullets and numbers taken off ("1.5 tsp" and "350:" left alone) | ✅ | ? | ❌ | ❌ |
| Categories suggested from `categories.json`: by season before typing, matches as you type | ✅ | ? | ❌ free text | ❌ free text |
| Each category shown with its emoji | ✅ | ◐ 141 of 162 | ❌ | ❌ |
| Your own category allowed beside the list | ✅ | ✅ | ✅ | ✅ |
| A time that is only a number becomes minutes on leaving the box ("15" → "15 min"); "1 hr", "overnight" and servings are kept as typed | ✅ | ❌ | ? | ? |
| The first photo drawn large as the cover, the rest below; any of them can be made the cover | ✅ | ✅ | ? | ? |
| Videos (MP4) beside the photos | ❌ photos only | ✅ | ? | ? |
| Chef's notes: formatted paste becomes markdown; a pasted heading becomes a bold line | ✅ | ? | ? | ? |
| Chef's notes: Cmd+B, Cmd+I, Cmd+K; Enter continues a list or quote | ✅ | ? | — touch; ? keyboard | — touch; ? keyboard |
| Plain paste (Cmd+Shift+V) | ✅ | ? | — | — |
| Draft kept while writing, and offered back | ✅ | ? | ❌ none | ❌ none |
| Reopening returns to the recipe being written | ✅ | ? | ? | ? |
| What is still needed before publishing, said in one line | ✅ | ? | ◐ categories | ? |
| Asks before replacing a recipe already published at the same address | ✅ | ? | ? | ? |

Sidecar's code for each row: `longform.js` (the form, `markdownField`, `listEditor`,
categories), `longform-events.js` (`recipeMarkdown`, `recipeTemplate`), `composer-core.js`
(`markdownFromHtml`), tests `test/longform-*.browser.test.js`.
