'use strict';

// The editor lab's local network: one TLS port that is both a Nostr relay (NIP-01) and a
// Blossom server (BUD-01/02), recording everything an app publishes or uploads.
//
// TLS because composers refuse a Blossom server that is not https://, and a relay reached
// from an https page has to be wss://. The certificate is made for the run (openssl) and
// thrown away; the browser is told to accept it (see the adapters). Nothing here reaches the
// internet, and the adapters block every other host, so a lab run cannot publish anywhere.
//
//   const lab = await startLab();
//   lab.relay      'wss://127.0.0.1:PORT'
//   lab.blossom    'https://127.0.0.1:PORT'
//   lab.events     every event received, in order (seeded ones too, flagged `seeded`)
//   lab.uploads    every upload: { sha256, size, type, url, auth }
//   lab.seed(ev)   store an event as if another client had published it
//   lab.close()

const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-lab-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
  const out = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

// The id an event must have: sha256 of its serialization (NIP-01). The signature is checked
// by the runner with the adapter's verifier, since node has no BIP-340 of its own.
function eventId(ev) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))
    .digest('hex');
}

function matches(ev, f) {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.since && ev.created_at < f.since) return false;
  if (f.until && ev.created_at > f.until) return false;
  for (const k of Object.keys(f)) {
    if (k[0] !== '#') continue;
    const name = k.slice(1);
    if (!ev.tags.some((t) => t[0] === name && f[k].includes(t[1]))) return false;
  }
  return true;
}

// ---- a minimal WebSocket: text frames, ping, close; client frames are masked ----
function frame(text) {
  const p = Buffer.from(text);
  let head;
  if (p.length < 126) head = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) head = Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([head, p]);
}
function reader(onText, onClose, onPing) {
  let buf = Buffer.alloc(0);
  let parts = [];
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const masked = buf[1] & 0x80;
      const need = at + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let data = buf.subarray(at + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(at, at + 4);
        data = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
      }
      buf = buf.subarray(need);
      if (op === 0x8) { onClose(); return; }
      if (op === 0x9) { onPing(data); continue; }
      if (op === 0x1 || op === 0x0) {
        parts.push(data);
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; onText(text); }
      }
    }
  };
}

async function startLab({ log = null } = {}) {
  const events = [];
  const uploads = [];
  const blobs = new Map(); // sha256 -> { body, type }
  const live = new Set();
  const note = (line) => { if (log) log(line); };

  const store = (ev, seeded = false) => {
    if (events.some((e) => e.id === ev.id)) return false;
    events.push(seeded ? Object.assign(ev, { seeded: true }) : ev);
    for (const sub of live) if (sub.filters.some((f) => matches(ev, f))) sub.send(['EVENT', sub.id, ev]);
    return true;
  };

  const server = https.createServer(makeCert(), (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SHA-256, X-Content-Type, X-Content-Length',
      'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS, DELETE',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method === 'PUT' && (req.url === '/upload' || req.url === '/media')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const sha256 = crypto.createHash('sha256').update(body).digest('hex');
        // BUD-02: the Authorization header is a kind 24242 event, base64, signed by the uploader.
        let auth = null;
        const h = req.headers.authorization || '';
        if (h.startsWith('Nostr ')) { try { auth = JSON.parse(Buffer.from(h.slice(6), 'base64').toString('utf8')); } catch (_) { auth = null; } }
        const type = req.headers['content-type'] || 'application/octet-stream';
        const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4' }[type] || '';
        blobs.set(sha256, { body, type });
        const url = `https://127.0.0.1:${server.address().port}/${sha256}${ext}`;
        uploads.push({ sha256, size: body.length, type, url, auth });
        note(`upload ${sha256.slice(0, 12)}… ${type} ${body.length} bytes`);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url, sha256, size: body.length, type, uploaded: Math.floor(Date.now() / 1000) }));
      });
      return;
    }
    const m = /^\/([0-9a-f]{64})(\.\w+)?$/.exec(req.url || '');
    if ((req.method === 'GET' || req.method === 'HEAD') && m && blobs.has(m[1])) {
      const b = blobs.get(m[1]);
      res.writeHead(200, { ...cors, 'Content-Type': b.type, 'Content-Length': b.body.length });
      res.end(req.method === 'HEAD' ? undefined : b.body);
      return;
    }
    // NIP-11, so a client that asks what this relay is gets an answer.
    if (req.headers.accept === 'application/nostr+json') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/nostr+json' });
      res.end(JSON.stringify({ name: 'editor lab', software: 'editor-matrix/lab', supported_nips: [1, 11] }));
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  const sockets = new Set();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('secureConnection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (msg) => { try { socket.write(frame(JSON.stringify(msg))); } catch (_) { /* gone */ } };
    const subs = new Map();
    socket.on('data', reader((text) => {
      let msg;
      try { msg = JSON.parse(text); } catch (_) { return; }
      if (msg[0] === 'EVENT' && msg[1]) {
        const ev = msg[1];
        const ok = ev.id === eventId(ev);
        if (ok) { store(ev); note(`event kind ${ev.kind} ${ev.id.slice(0, 12)}…`); }
        send(['OK', ev.id, ok, ok ? '' : 'invalid: id does not match the event']);
      } else if (msg[0] === 'REQ') {
        const [, id, ...filters] = msg;
        const sub = { id, filters, send };
        subs.set(id, sub);
        live.add(sub);
        const seen = new Set();
        for (const f of filters) {
          let hits = events.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at);
          if (f.limit) hits = hits.slice(0, f.limit);
          for (const e of hits) if (!seen.has(e.id)) { seen.add(e.id); send(['EVENT', id, e]); }
        }
        send(['EOSE', id]);
      } else if (msg[0] === 'CLOSE') {
        const sub = subs.get(msg[1]);
        if (sub) { live.delete(sub); subs.delete(msg[1]); }
      }
    }, () => { for (const s of subs.values()) live.delete(s); socket.end(); },
    (data) => { try { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch (_) { /* gone */ } }));
    socket.on('close', () => { for (const s of subs.values()) live.delete(s); });
    socket.on('error', () => {});
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    relay: `wss://127.0.0.1:${port}`,
    blossom: `https://127.0.0.1:${port}`,
    port, events, uploads,
    seed: (ev) => store(ev, true),
    eventId,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

module.exports = { startLab, eventId, matches };
