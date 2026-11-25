// Family Christmas Wishlists — a small self-hosted server.
// No packages to install: needs only Node.js 22 or newer.
//
// Settings (environment variables, all optional):
//   PORT         Port to listen on. Default 3000.
//   HOST         Address to listen on. Default 0.0.0.0 (all).
//   DATA_FILE    Where the lists are saved. Default ./data/wishlists.json
//                A daily copy goes in a "backups" folder next to it (last 14 days kept).
//   FAMILY_CODE  A shared passcode. If set, the page asks for it once per device
//                and nothing can be read or changed without it.
//   NODE_ENV     "production" refuses to start without FAMILY_CODE (the Docker image sets it).

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'data', 'wishlists.json'));
const FAMILY_CODE = (process.env.FAMILY_CODE || '').trim();
if (process.env.NODE_ENV === 'production' && !FAMILY_CODE) {
  console.error('FAMILY_CODE is not set. Refusing to start in production, or anyone with the address could open the lists.');
  process.exit(1);
}
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- storage ---------- */

let db = { people: [], items: [] };

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.people = Array.isArray(parsed.people) ? parsed.people : [];
    db.items = Array.isArray(parsed.items) ? parsed.items : [];
    console.log(`Loaded ${db.people.length} people and ${db.items.length} wishes from ${DATA_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') { console.error(`Could not read ${DATA_FILE}:`, e.message); process.exit(1); }
    console.log(`Starting with empty lists. Data will be saved to ${DATA_FILE}`);
  }
}

// Before the first change of each day, copy the lists into backups/ and keep the last 14 copies.
const BACKUP_DIR = path.join(path.dirname(DATA_FILE), 'backups');
const KEEP_BACKUPS = 14;
function backup() {
  if (!fs.existsSync(DATA_FILE)) return;
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const base = path.basename(DATA_FILE, '.json');
  const target = path.join(BACKUP_DIR, `${base}-${day}.json`);
  if (fs.existsSync(target)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(DATA_FILE, target);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(base + '-') && f.endsWith('.json')).sort();
    for (const f of old.slice(0, -KEEP_BACKUPS)) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (e) {
    console.error('Could not make a backup:', e.message); // never block saving the lists
  }
}

// Write to a temp file then rename, so a crash mid-write never corrupts the lists.
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  backup();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function snapshot() {
  return {
    people: db.people.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
    items: db.items.map(i => ({ id: i.id, personId: i.personId, title: i.title, url: i.url, notes: i.notes, purchased: !!i.purchased, createdAt: i.createdAt }))
  };
}

/* ---------- validation ---------- */

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function cleanUrl(u) {
  u = clean(u, 1000);
  if (!u) return '';
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  if (!/^[a-z]+:/i.test(u)) u = 'https://' + u;
  return /^https:\/\/\S+$/i.test(u) ? u : '';
}
function needPerson(id) {
  const p = db.people.find(x => x.id === id);
  if (!p) throw new HttpError(404, 'That person no longer exists. The page will refresh.');
  return p;
}
function needItem(id) {
  const i = db.items.find(x => x.id === id);
  if (!i) throw new HttpError(404, 'That wish no longer exists. The page will refresh.');
  return i;
}
function itemFields(b) {
  const title = clean(b.title, 120);
  if (!title) throw new HttpError(400, 'Please say what the wish is.');
  return { title, url: cleanUrl(b.url), notes: clean(b.notes, 200) };
}

/* ---------- API ---------- */

const LINK_USE = /^\/api\/links\/([\w-]+)$/;

const routes = [
  ['GET', /^\/api\/data$/, () => ({ data: snapshot() })],

  ['POST', /^\/api\/people$/, (b) => {
    const name = clean(b.name, 40);
    if (!name) throw new HttpError(400, 'Please enter a name.');
    if (db.people.length >= 200) throw new HttpError(400, 'That is a lot of people! Remove some before adding more.');
    const id = crypto.randomUUID();
    db.people.push({ id, name, createdAt: Date.now() });
    save();
    return { data: snapshot(), id };
  }],

  ['PATCH', /^\/api\/people\/([\w-]+)$/, (b, id) => {
    const name = clean(b.name, 40);
    if (!name) throw new HttpError(400, 'Please enter a name.');
    needPerson(id).name = name;
    save();
    return { data: snapshot() };
  }],

  ['DELETE', /^\/api\/people\/([\w-]+)$/, (b, id) => {
    db.items = db.items.filter(i => i.personId !== id);
    db.people = db.people.filter(p => p.id !== id);
    save();
    return { data: snapshot() };
  }],

  ['POST', /^\/api\/items$/, (b) => {
    needPerson(String(b.personId || ''));
    if (db.items.length >= 5000) throw new HttpError(400, 'The lists are full. Remove some old wishes first.');
    db.items.push({ id: crypto.randomUUID(), personId: String(b.personId), ...itemFields(b), purchased: false, createdAt: Date.now() });
    save();
    return { data: snapshot() };
  }],

  ['PATCH', /^\/api\/items\/([\w-]+)$/, (b, id) => {
    Object.assign(needItem(id), itemFields(b));
    save();
    return { data: snapshot() };
  }],

  ['DELETE', /^\/api\/items\/([\w-]+)$/, (b, id) => {
    db.items = db.items.filter(i => i.id !== id);
    save();
    return { data: snapshot() };
  }],

  // A personal link signs one device in as this person, once. Until it's used, asking again gives the same link,
  // so sending it twice doesn't break the first copy. The secret is never in /api/data.
  ['POST', /^\/api\/people\/([\w-]+)\/link$/, (b, id) => {
    const p = needPerson(id);
    if (!p.link) { p.link = crypto.randomBytes(18).toString('base64url'); save(); }
    return { link: p.link };
  }],

  // Using a link needs no passcode: the link stands in for it, and hands it over so this device keeps it.
  ['POST', LINK_USE, (b, token) => {
    const p = db.people.find(x => x.link && x.link === token);
    if (!p) throw new HttpError(410, 'This link has already been used.');
    delete p.link;
    save();
    return { personId: p.id, code: FAMILY_CODE };
  }],

  // Marks bought / not bought. Nothing about who did it is stored.
  ['POST', /^\/api\/items\/([\w-]+)\/purchased$/, (b, id) => {
    const it = needItem(id);
    const value = b.value === true;
    if (value && it.purchased) return { data: snapshot(), already: true };
    it.purchased = value;
    save();
    return { data: snapshot(), already: false };
  }]
];

/* ---------- passcode ---------- */

// Behind a reverse proxy every request comes from the proxy, so use the visitor's address it adds
// at the end of X-Forwarded-For. Only trust that header from this machine or a private network.
const PROXY = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$/;
function clientIp(req) {
  const ip = req.socket.remoteAddress || '?';
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return PROXY.test(ip) && fwd ? fwd : ip;
}

const failures = new Map(); // ip -> {count, until}
function checkCode(req) {
  if (!FAMILY_CODE) return;
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && f.count >= 10 && Date.now() < f.until) throw new HttpError(429, 'Too many wrong passcodes. Try again in a few minutes.');
  const given = Buffer.from(String(req.headers['x-family-code'] || ''));
  const want = Buffer.from(FAMILY_CODE);
  const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!ok) {
    if (given.length) {
      if (failures.size > 1000) for (const [k, v] of failures) if (Date.now() >= v.until) failures.delete(k);
      const n = f && Date.now() < f.until ? f.count + 1 : 1;
      failures.set(ip, { count: n, until: Date.now() + 10 * 60 * 1000 });
    }
    throw new HttpError(401, 'Please enter the family passcode.');
  }
  failures.delete(ip);
}

/* ---------- HTTP ---------- */

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/icon.png': ['icon.png', 'image/png'],
  '/fonts/fraunces-latin.woff2': ['fonts/fraunces-latin.woff2', 'font/woff2'],
  '/fonts/fraunces-latin-ext.woff2': ['fonts/fraunces-latin-ext.woff2', 'font/woff2'],
  '/fonts/fraunces-italic-latin.woff2': ['fonts/fraunces-italic-latin.woff2', 'font/woff2']
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

function send(res, status, body, type = 'application/json; charset=utf-8', cache = 'no-store') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': cache });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 16 * 1024) { reject(new HttpError(413, 'That was too much text.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(b && typeof b === 'object' && !Array.isArray(b) ? b : {});
      } catch { reject(new HttpError(400, 'Bad request.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC[p]) {
      const [file, type] = STATIC[p];
      // Fonts never change, so browsers may keep them; the page and app.js always come fresh after a deploy.
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, file)), type, p.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-store');
    }
    if (req.method === 'GET' && p === '/api/config') return send(res, 200, { needsCode: !!FAMILY_CODE });

    if (p.startsWith('/api/')) {
      // Only accept JSON writes from this page (blocks cross-site form posts).
      if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Bad request.');
      if (!(req.method === 'POST' && LINK_USE.test(p))) checkCode(req);
      for (const [method, re, handler] of routes) {
        const m = p.match(re);
        if (m && req.method === method) {
          const body = method === 'GET' ? {} : await readBody(req);
          return send(res, 200, handler(body, m[1]));
        }
      }
      throw new HttpError(404, 'Not found.');
    }
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on the server.' });
  }
});

// Docker stops containers with SIGTERM, which Node ignores as PID 1. Saves are synchronous, so exiting now is safe.
process.on('SIGTERM', () => process.exit(0));

load();
server.listen(PORT, HOST, () => {
  console.log(`Wishlists running at http://localhost:${PORT}` + (FAMILY_CODE ? ' (family passcode on)' : ' (no passcode: anyone with the address can edit)'));
});
