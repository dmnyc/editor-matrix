'use strict';

// What a composer publishes, feature by feature: the steps a person takes, and what the event
// that reaches the relay must say. App-neutral, like cases.js: a step names an intent ("open the
// article form", "attach a picture"), and each app's lab adapter carries it out its own way.
//
// Expectations follow the NIPs and the shared fixtures (recipes/fixtures.json), not what any one
// app does today: a feature an app gets wrong fails here, and stays failing until it is fixed.
//
// A feature:
//   id, group, title     stable id, group for --only, one line for the report
//   needs                abilities the adapter must have (a feature it cannot run is skipped)
//   seed                 events published by other people first: [name, (refs) => template, who]
//   steps                what the person does (vocabulary below)
//   after                steps run once the event is in (putting a setting back), so they cannot cut the publish short
//   kind                 the kind of event to wait for, from the account under test
//   expect(ev, ctx)      checks on that event: [description, passed, detail?]
//
// Steps:
//   ['settings', { clientTag, pow, countdown }]   the app's own settings, as a person would set them
//   ['open', mode]                 'note' | 'poll' | 'article' | 'recipe'
//   ['reply', seedName]            open the composer as a reply to a seeded event
//   ['type', text]                 typed, as a keyboard delivers it
//   ['key', name]                  'Enter' | 'Backspace' …
//   ['paste', text]                plain text on the clipboard, pasted
//   ['mention', who]               a mention of a person, by the app's own mention flow
//   ['quote', seedName]            a seeded note quoted into the text
//   ['attach', fixture]            a file from fixtures/, attached
//   ['alt', text]                  a description for the last attachment
//   ['poll', { options, multi }]   the poll's options (the question is the typed text)
//   ['article', { title, summary, body, topics }]
//   ['recipe', fixtureName]        a recipes/fixtures.json case, its fields filled in
//   ['publish']                    publish, through any review the app shows

const path = require('node:path');
const RECIPES = require(path.join(__dirname, '..', 'recipes', 'fixtures.json'));

const tagsOf = (ev, name) => ev.tags.filter((t) => t[0] === name);
const has = (ev, name, value) => ev.tags.some((t) => t[0] === name && (value === undefined || t[1] === value));
const check = (what, ok, detail) => [what, !!ok, detail];
// Advice: good practice a NIP allows but does not require. Reported, never a failure.
const advise = (what, ok, detail) => [what, !!ok, detail, 'advice'];
const zeroBits = (hex) => { let n = 0; for (const c of hex) { const v = parseInt(c, 16); if (v === 0) { n += 4; continue; } n += Math.clz32(v) - 28; break; } return n; };

// Every event a composer signs, whatever it is.
function basics(ev, ctx) {
  return [
    check('signed by the account under test', ev.pubkey === ctx.pubkey, ev.pubkey),
    check('its id is the hash of its contents (NIP-01)', ev.id === ctx.eventId(ev)),
    check('its signature verifies', ctx.sigOk !== false, ctx.sigOk === null ? 'not checked: no verifier' : undefined),
    check('created now, not in the past or future', Math.abs(ev.created_at - Math.floor(Date.now() / 1000)) < 600, ev.created_at),
  ];
}

const FEATURES = [
  // ---- notes ----
  { id: 'note-plain', group: 'note', title: 'A plain note', steps: [['open', 'note'], ['type', 'Hello from the editor lab'], ['publish']], kind: 1,
    expect: (ev) => [check('the text is what was typed', ev.content === 'Hello from the editor lab', ev.content),
      check('no e tag: it answers nothing', !has(ev, 'e'))] },
  { id: 'note-paragraphs', group: 'note', title: 'Two paragraphs with a blank line between them',
    steps: [['open', 'note'], ['type', 'First paragraph.'], ['key', 'Enter'], ['key', 'Enter'], ['type', 'Second paragraph.'], ['publish']], kind: 1,
    expect: (ev) => [check('the blank line is kept', ev.content === 'First paragraph.\n\nSecond paragraph.', JSON.stringify(ev.content))] },
  { id: 'note-emoji-lines', group: 'note', title: 'Emoji at the end of a line, then a blank line',
    steps: [['open', 'note'], ['type', 'Cheers to you. 🍻🫂'], ['key', 'Enter'], ['key', 'Enter'], ['type', 'Next line.'], ['publish']], kind: 1,
    expect: (ev) => [check('the blank line after the emoji is kept', ev.content === 'Cheers to you. 🍻🫂\n\nNext line.', JSON.stringify(ev.content))] },
  { id: 'note-hashtag', group: 'note', title: 'A hashtag becomes a t tag', steps: [['open', 'note'], ['type', 'Testing the #EditorLab today'], ['publish']], kind: 1,
    expect: (ev) => [check('a t tag, lowercase (NIP-24)', has(ev, 't', 'editorlab'), JSON.stringify(tagsOf(ev, 't'))),
      check('the text keeps the hashtag as typed', ev.content.includes('#EditorLab'))] },
  { id: 'note-link', group: 'note', title: 'A link is kept exactly', steps: [['open', 'note'], ['type', 'Read https://example.com/a?b=1 later'], ['publish']], kind: 1,
    expect: (ev) => [check('the link is in the text unchanged', ev.content.includes('https://example.com/a?b=1'), ev.content)] },
  { id: 'note-mention', group: 'note', title: 'A mention tags the person', needs: ['mention'], steps: [['open', 'note'], ['type', 'Hello '], ['mention', 'bea'], ['type', 'how are you'], ['publish']], kind: 1,
    expect: (ev, ctx) => [check('the text carries nostr:npub… (NIP-27)', /nostr:npub1[0-9a-z]{58}/.test(ev.content), ev.content),
      check('a p tag for the person mentioned', has(ev, 'p', ctx.people.bea)),
      check('the word after the mention is not part of it', /nostr:npub1[0-9a-z]{58} how are you/.test(ev.content), ev.content)] },
  { id: 'note-quote', group: 'note', title: 'A quoted note', needs: ['quote'], seed: [['note', () => ({ kind: 1, tags: [], content: 'A note to be quoted' }), 'bea']],
    steps: [['open', 'note'], ['type', 'Look at this '], ['quote', 'note'], ['publish']], kind: 1,
    expect: (ev, ctx) => [check('the text carries nostr:nevent1… or note1…', /nostr:(nevent1|note1)[0-9a-z]+/.test(ev.content), ev.content),
      check('a q tag for the quoted note (NIP-18)', has(ev, 'q', ctx.refs.note.id), JSON.stringify(tagsOf(ev, 'q')))] },
  { id: 'note-image', group: 'note', title: 'A picture, uploaded to Blossom', needs: ['attach'], steps: [['open', 'note'], ['type', 'A picture'], ['attach', 'orange.png'], ['publish']], kind: 1,
    expect: (ev, ctx) => {
      const up = ctx.uploads[ctx.uploads.length - 1];
      const imeta = tagsOf(ev, 'imeta')[0] || [];
      const field = (k) => (imeta.find((x) => typeof x === 'string' && x.startsWith(k + ' ')) || '').slice(k.length + 1);
      return [check('uploaded to the account\'s Blossom server (BUD-02)', !!up, up && up.url),
        check('the upload was authorized by the account (kind 24242)', up && up.auth && up.auth.kind === 24242 && up.auth.pubkey === ctx.pubkey),
        check('the picture\'s URL is in the text', up && ev.content.includes(up.url), ev.content),
        advise('an imeta tag for it (NIP-92), from what the server answered', up && field('url') === up.url, JSON.stringify(imeta)),
        advise('imeta names its type', field('m') === 'image/png', field('m')),
        advise('imeta carries its hash', up && field('x') === up.sha256, field('x'))];
    } },
  { id: 'note-image-alt', group: 'note', title: 'A picture with a description', needs: ['attach', 'alt'],
    steps: [['open', 'note'], ['type', 'Described'], ['attach', 'orange.png'], ['alt', 'An orange square'], ['publish']], kind: 1,
    expect: (ev, ctx) => {
      const up = ctx.uploads[ctx.uploads.length - 1];
      const imeta = tagsOf(ev, 'imeta')[0] || [];
      const field = (k) => (imeta.find((x) => typeof x === 'string' && x.startsWith(k + ' ')) || '').slice(k.length + 1);
      return [check('an imeta tag for the picture (NIP-92)', up && field('url') === up.url, JSON.stringify(imeta)),
        check('the description, as alt', field('alt') === 'An orange square', field('alt'))];
    } },
  { id: 'note-client-tag', group: 'note', title: 'The client tag, on by default', steps: [['open', 'note'], ['type', 'With the client tag'], ['publish']], kind: 1,
    expect: (ev) => [check('a client tag names the app', tagsOf(ev, 'client').length === 1, JSON.stringify(tagsOf(ev, 'client')))] },
  { id: 'note-no-client-tag', group: 'note', title: 'The client tag, turned off', needs: ['settings'], steps: [['settings', { clientTag: false }], ['open', 'note'], ['type', 'Without the client tag'], ['publish']], after: [['settings', { clientTag: true }]], kind: 1,
    expect: (ev) => [check('no client tag', !has(ev, 'client'), JSON.stringify(tagsOf(ev, 'client')))] },
  { id: 'note-pow', group: 'note', title: 'Proof of work (NIP-13)', needs: ['pow'], steps: [['settings', { pow: 16 }], ['open', 'note'], ['type', 'Worked for'], ['publish']], after: [['settings', { pow: 0 }]], kind: 1,
    expect: (ev) => {
      const n = tagsOf(ev, 'nonce')[0];
      return [check('a nonce tag with its target', n && n[2] === '16', JSON.stringify(n)),
        check('the id has at least that many leading zero bits', zeroBits(ev.id) >= 16, zeroBits(ev.id) + ' bits')];
    } },

  // ---- replies ----
  { id: 'reply-note', group: 'reply', title: 'A reply to a note (NIP-10)', needs: ['reply'], seed: [['note', () => ({ kind: 1, tags: [], content: 'A note to answer' }), 'bea']],
    steps: [['reply', 'note'], ['type', 'A reply'], ['publish']], kind: 1,
    expect: (ev, ctx) => [check('kind 1, as the note it answers', ev.kind === 1),
      check('an e tag for the note, marked root', ev.tags.some((t) => t[0] === 'e' && t[1] === ctx.refs.note.id && t[3] === 'root'), JSON.stringify(tagsOf(ev, 'e'))),
      check('a p tag for its author', has(ev, 'p', ctx.people.bea))] },
  { id: 'reply-nested', group: 'reply', title: 'A reply to a reply keeps the thread\'s root', needs: ['reply'],
    seed: [['root', () => ({ kind: 1, tags: [], content: 'The thread starts here' }), 'bea'],
      ['mid', (r) => ({ kind: 1, tags: [['e', r.root.id, '', 'root'], ['p', r.root.pubkey]], content: 'A reply in the thread' }), 'cal']],
    steps: [['reply', 'mid'], ['type', 'Deeper'], ['publish']], kind: 1,
    expect: (ev, ctx) => [check('root marked root', ev.tags.some((t) => t[0] === 'e' && t[1] === ctx.refs.root.id && t[3] === 'root'), JSON.stringify(tagsOf(ev, 'e'))),
      check('parent marked reply', ev.tags.some((t) => t[0] === 'e' && t[1] === ctx.refs.mid.id && t[3] === 'reply')),
      check('both authors tagged', has(ev, 'p', ctx.people.bea) && has(ev, 'p', ctx.people.cal))] },
  { id: 'reply-comment', group: 'reply', title: 'A reply to a comment is a comment (NIP-22)', needs: ['reply'],
    seed: [['article', () => ({ kind: 30023, tags: [['d', 'lab-essay'], ['title', 'An essay']], content: 'Long form.' }), 'bea'],
      ['comment', (r) => ({ kind: 1111, tags: [['A', `30023:${r.article.pubkey}:lab-essay`], ['E', r.article.id, '', r.article.pubkey], ['K', '30023'], ['P', r.article.pubkey],
        ['a', `30023:${r.article.pubkey}:lab-essay`], ['e', r.article.id, '', r.article.pubkey], ['k', '30023'], ['p', r.article.pubkey]], content: 'A comment' }), 'cal']],
    steps: [['reply', 'comment'], ['type', 'Answering the comment'], ['publish']], kind: 1111,
    expect: (ev, ctx) => [check('kind 1111', ev.kind === 1111),
      check('the root scope kept: K 30023', has(ev, 'K', '30023'), JSON.stringify(tagsOf(ev, 'K'))),
      check('the parent: e is the comment, k 1111', has(ev, 'e', ctx.refs.comment.id) && has(ev, 'k', '1111'), JSON.stringify(ev.tags)),
      check('the commenter in p', has(ev, 'p', ctx.people.cal))] },
  { id: 'reply-article', group: 'reply', title: 'A reply to an article is a comment (NIP-22)', needs: ['reply'],
    seed: [['article', () => ({ kind: 30023, tags: [['d', 'lab-essay-2'], ['title', 'Another essay']], content: 'Long form.' }), 'bea']],
    steps: [['reply', 'article'], ['type', 'Commenting on the essay'], ['publish']], kind: null,
    expect: (ev, ctx) => [check('kind 1111: a reply to anything but a note is a comment', ev.kind === 1111, 'kind ' + ev.kind),
      check('K names the root\'s kind, 30023', has(ev, 'K', '30023'), JSON.stringify(tagsOf(ev, 'K'))),
      check('A names the article\'s address', has(ev, 'A', `30023:${ctx.refs.article.pubkey}:lab-essay-2`), JSON.stringify(tagsOf(ev, 'A')))] },

  // ---- polls ----
  { id: 'poll', group: 'poll', title: 'A poll (NIP-88)', needs: ['poll'], steps: [['open', 'poll'], ['type', 'Tea or coffee?'], ['poll', { options: ['Tea', 'Coffee'] }], ['publish']], kind: 1068,
    expect: (ev) => {
      const opts = tagsOf(ev, 'option');
      return [check('the question is the text', ev.content === 'Tea or coffee?', ev.content),
        check('one option tag per choice, in order', opts.map((o) => o[2]).join('|') === 'Tea|Coffee', JSON.stringify(opts)),
        check('each option has its own id', new Set(opts.map((o) => o[1])).size === opts.length)];
    } },

  // ---- articles ----
  { id: 'article', group: 'article', title: 'A long-form article (NIP-23)', needs: ['article'],
    steps: [['open', 'article'], ['article', { title: 'Lab Article', summary: 'What the lab checks', body: '## Part one\n\nSome **bold** words.', topics: ['Nostr'] }], ['publish']], kind: 30023,
    expect: (ev) => [check('a d tag', !!tagsOf(ev, 'd')[0]),
      check('the title', has(ev, 'title', 'Lab Article'), JSON.stringify(tagsOf(ev, 'title'))),
      check('the summary', has(ev, 'summary', 'What the lab checks')),
      check('published_at', !!tagsOf(ev, 'published_at')[0]),
      check('the topic as a t tag', has(ev, 't', 'nostr'), JSON.stringify(tagsOf(ev, 't'))),
      check('the body is the markdown written', ev.content === '## Part one\n\nSome **bold** words.', JSON.stringify(ev.content))] },

  // ---- recipes: the shared fixtures, published for real ----
  ...RECIPES.cases.map((c, i) => ({
    id: 'recipe-' + (i + 1), group: 'recipe', title: 'Recipe: ' + c.name, needs: ['recipe'],
    steps: [['open', 'recipe'], ['recipe', c.name], ['publish']], kind: c.expect.kind,
    expect: (ev) => {
      // App-specific tags (client, imeta) and the two times are left out, as the fixtures say.
      const drop = new Set(['client', 'imeta']);
      const norm = (tags) => tags.filter((t) => !drop.has(t[0])).map((t) => (t[0] === 'published_at' ? ['published_at'] : t));
      const want = norm(c.expect.tags);
      const got = norm(ev.tags);
      return [check('the content, newline for newline', ev.content === c.expect.content, JSON.stringify(ev.content).slice(0, 200)),
        check('the tags, in order', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))];
    },
  })),
];

module.exports = { FEATURES, basics, tagsOf, has, zeroBits, check, advise };
