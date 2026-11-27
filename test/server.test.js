// Starts the real server on a spare port and talks to it over HTTP.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const CODE = 'right-code';
let server, base, dir;

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Starts a server with its own data folder; resolves once it is listening.
async function start(env, dataDir) {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: ['ignore', 'pipe', 'inherit'], // show the server's errors if it fails to start
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: path.join(dataDir, 'wishlists.json'), ...env }
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', d => { if (String(d).includes('running')) resolve(); });
    proc.on('exit', code => reject(new Error('server exited with ' + code)));
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}
const exited = proc => new Promise(resolve => proc.on('exit', code => resolve(code)));

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-test-'));
  ({ proc: server, base } = await start({ FAMILY_CODE: CODE }, dir));
}, { timeout: 5000 });

after(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

// A visitor behind the reverse proxy, as nginx sends them: real address last in X-Forwarded-For.
function getData(code, visitor) {
  return fetch(base + '/api/data', { headers: { 'X-Family-Code': code, 'X-Forwarded-For': visitor } });
}

test('wrong passcodes from one visitor behind the proxy do not lock out the rest of the family', async () => {
  for (let i = 0; i < 10; i++) assert.strictEqual((await getData('guess' + i, '203.0.113.5')).status, 401);
  assert.strictEqual((await getData(CODE, '198.51.100.7')).status, 200);
});

test('a visitor who keeps guessing is still locked out, even with the right code', async () => {
  for (let i = 0; i < 10; i++) await getData('guess' + i, '203.0.113.9');
  assert.strictEqual((await getData(CODE, '203.0.113.9')).status, 429);
});

test('only the address nginx added counts, not one the visitor wrote into the header', async () => {
  // A visitor can send their own X-Forwarded-For; nginx appends the real address after it.
  for (let i = 0; i < 10; i++) await getData('guess' + i, '1.2.3.' + i + ', 203.0.113.20');
  assert.strictEqual((await getData(CODE, '203.0.113.20')).status, 429);
});

test('HEAD requests get the same answer as GET, for uptime monitors', async () => {
  const r = await fetch(base + '/', { method: 'HEAD' });
  assert.strictEqual(r.status, 200);
});

test('fonts are cached by browsers, while the page itself always comes fresh', async () => {
  assert.match((await fetch(base + '/fonts/fraunces-latin.woff2')).headers.get('cache-control'), /max-age=31536000/);
  assert.strictEqual((await fetch(base + '/')).headers.get('cache-control'), 'no-store');
});

test('the icon for phone home screens and browser tabs is served', async () => {
  const r = await fetch(base + '/icon.png');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
});

test('a personal link works once, and asking for it again before then gives the same link', async () => {
  const h = { 'Content-Type': 'application/json', 'X-Family-Code': CODE };
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
  const { id } = await (await post('/api/people', { name: 'Rose' })).json();
  const { link } = await (await post(`/api/people/${id}/link`)).json();
  assert.strictEqual((await (await post(`/api/people/${id}/link`)).json()).link, link);
  assert.ok(!JSON.stringify(await (await fetch(base + '/api/data', { headers: h })).json()).includes(link), 'the secret is not shown to everyone');

  // Opened on a new phone that has no passcode yet: the link alone signs it in, and hands over the passcode.
  const use = () => fetch(base + `/api/links/${link}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const first = await use();
  assert.deepStrictEqual(await first.json(), { personId: id, code: CODE });
  const again = await use();
  assert.strictEqual(again.status, 410);
  assert.ok(!JSON.stringify(await again.json()).includes(CODE), 'a used link gives nothing away');
  assert.notStrictEqual((await (await post(`/api/people/${id}/link`)).json()).link, link, 'a used link is replaced by a new one');
});

test('in production the server refuses to start without a passcode', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-test-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production', FAMILY_CODE: '', PORT: String(await freePort()), DATA_FILE: path.join(d, 'w.json') }
  });
  const code = await Promise.race([exited(proc), new Promise(r => setTimeout(() => { proc.kill(); r('still running'); }, 3000))]);
  fs.rmSync(d, { recursive: true, force: true });
  assert.strictEqual(code, 1);
});

test('stops at once on SIGTERM, so deploys and restarts are quick', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-test-'));
  const s = await start({ FAMILY_CODE: CODE }, d);
  s.proc.kill('SIGTERM');
  const code = await Promise.race([exited(s.proc), new Promise(r => setTimeout(() => { s.proc.kill('SIGKILL'); r('ignored SIGTERM'); }, 2000))]);
  fs.rmSync(d, { recursive: true, force: true });
  assert.strictEqual(code, 0);
});

test('the lists survive a restart, and only the last 14 daily backups are kept', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-test-'));
  fs.writeFileSync(path.join(d, 'wishlists.json'), JSON.stringify({ people: [{ id: 'p1', name: 'Ana', createdAt: 1 }], items: [] }));
  fs.mkdirSync(path.join(d, 'backups'));
  for (let i = 1; i <= 15; i++) fs.writeFileSync(path.join(d, 'backups', `wishlists-2020-01-${String(i).padStart(2, '0')}.json`), '{}');
  const s = await start({ FAMILY_CODE: CODE }, d);
  try {
    const h = { 'Content-Type': 'application/json', 'X-Family-Code': CODE };
    const data = await (await fetch(s.base + '/api/data', { headers: h })).json();
    assert.deepStrictEqual(data.data.people.map(p => p.name), ['Ana']);
    assert.strictEqual((await fetch(s.base + '/api/people', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Ben' }) })).status, 200);
    const left = fs.readdirSync(path.join(d, 'backups'));
    assert.strictEqual(left.length, 14);
    assert.ok(!left.includes('wishlists-2020-01-01.json') && !left.includes('wishlists-2020-01-02.json'), 'the oldest copies go first');
  } finally { s.proc.kill(); fs.rmSync(d, { recursive: true, force: true }); }
});


/* ---------- "Got a gift" checks ---------- */

// The viewer says who they are with X-Viewer, the same id the page keeps as "me".
const as = (viewer) => ({ 'Content-Type': 'application/json', 'X-Family-Code': CODE, 'X-Viewer': viewer || '' });
const dataAs = async (viewer, b = base) => (await (await fetch(b + '/api/data', { headers: as(viewer) })).json()).data;
const gotGift = (viewer, id, value, b = base) => fetch(b + `/api/people/${id}/got-gift`, { method: 'POST', headers: as(viewer), body: JSON.stringify({ value }) });
const addPerson = async (name, b = base) => (await (await fetch(b + '/api/people', { method: 'POST', headers: as(''), body: JSON.stringify({ name }) })).json()).id;

test('a "got a gift" check can be set and unset, and setting it twice keeps one', async () => {
  const ann = await addPerson('Ann'), bob = await addPerson('Bob');
  const r = await gotGift(ann, bob, true);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).data.gotGift, [bob], 'the answer already has the new check');
  await gotGift(ann, bob, true);
  assert.deepStrictEqual((await dataAs(ann)).gotGift, [bob]);
  assert.deepStrictEqual((await (await gotGift(ann, bob, false)).json()).data.gotGift, []);
  assert.deepStrictEqual((await dataAs(ann)).gotGift, []);
});

test('each person only ever sees their own checks', async () => {
  const cat = await addPerson('Cat'), dov = await addPerson('Dov'), eli = await addPerson('Eli');
  await gotGift(cat, dov, true);
  await gotGift(eli, cat, true);
  assert.deepStrictEqual((await dataAs(cat)).gotGift, [dov]);
  assert.deepStrictEqual((await dataAs(dov)).gotGift, [], 'Dov must not learn Cat has a gift for him');
  assert.deepStrictEqual((await dataAs(eli)).gotGift, [cat]);
  assert.deepStrictEqual((await dataAs('')).gotGift, [], 'nobody signed in sees no checks');
  // Answers to other changes are drawn for their sender too.
  const r = await fetch(base + '/api/items', { method: 'POST', headers: as(dov), body: JSON.stringify({ personId: dov, title: 'Kite' }) });
  assert.deepStrictEqual((await r.json()).data.gotGift, []);
});

test('you cannot check yourself, and checks need a real viewer and a real person', async () => {
  const fin = await addPerson('Fin');
  assert.strictEqual((await gotGift(fin, fin, true)).status, 400);
  assert.strictEqual((await gotGift('', fin, true)).status, 404);
  assert.strictEqual((await gotGift('no-such-person', fin, true)).status, 404);
  assert.strictEqual((await gotGift(fin, 'no-such-person', true)).status, 404);
  assert.strictEqual((await gotGift('__proto__', fin, true)).status, 404);
});

test('removing a person removes their own checks and every check on them', async () => {
  const gil = await addPerson('Gil'), hana = await addPerson('Hana'), ida = await addPerson('Ida');
  await gotGift(gil, hana, true); await gotGift(gil, ida, true);
  await gotGift(hana, gil, true);
  await gotGift(ida, hana, true);
  await fetch(base + `/api/people/${hana}`, { method: 'DELETE', headers: as(gil), body: '{}' });
  assert.deepStrictEqual((await dataAs(gil)).gotGift, [ida]);
  assert.deepStrictEqual((await dataAs(ida)).gotGift, []);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'wishlists.json'), 'utf8')).gotGift;
  assert.ok(!(hana in saved), "Hana's own checks are gone from the file");
  assert.ok(!JSON.stringify(saved).includes(hana), 'and nobody has a check on her any more');
});

test('a data file from before checks existed still loads, and checks then work and are saved', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-test-'));
  fs.writeFileSync(path.join(d, 'wishlists.json'), JSON.stringify({ people: [{ id: 'p1', name: 'Ana', createdAt: 1 }, { id: 'p2', name: 'Ben', createdAt: 2 }], items: [] }));
  let s = await start({ FAMILY_CODE: CODE }, d);
  try {
    assert.deepStrictEqual((await dataAs('p1', s.base)).gotGift, []);
    assert.strictEqual((await gotGift('p1', 'p2', true, s.base)).status, 200);
    s.proc.kill(); await exited(s.proc);
    s = await start({ FAMILY_CODE: CODE }, d);
    assert.deepStrictEqual((await dataAs('p1', s.base)).gotGift, ['p2'], 'checks survive a restart');
  } finally { s.proc.kill(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('renaming a person keeps the checks on them and the checks they made', async () => {
  const jo = await addPerson('Jo'), kai = await addPerson('Kai');
  await gotGift(jo, kai, true); await gotGift(kai, jo, true);
  await fetch(base + `/api/people/${kai}`, { method: 'PATCH', headers: as(jo), body: JSON.stringify({ name: 'Kai B' }) });
  assert.deepStrictEqual((await dataAs(jo)).gotGift, [kai]);
  assert.deepStrictEqual((await dataAs(kai)).gotGift, [jo]);
});
