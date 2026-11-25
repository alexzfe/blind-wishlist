// End-to-end: real server, real browser, the family's main journeys. Run with: npm run test:e2e
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { chromium } = require('playwright');

const CODE = 'maple-sled-cocoa-42';
let server, base, dir, browser;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-e2e-'));
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: path.join(dir, 'wishlists.json'), FAMILY_CODE: CODE }
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => { if (String(d).includes('running')) resolve(); });
    server.on('exit', code => reject(new Error('server exited with ' + code)));
  });
  const executablePath = process.env.CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath });
}, { timeout: 30000 });

after(async () => {
  if (browser) await browser.close();
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

// A family member's device. With a passcode already entered unless told otherwise.
async function device({ code = CODE, me } = {}) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([c, m]) => {
    if (sessionStorage.getItem('seeded')) return; // only before the first load, so reloads keep what the page saved
    sessionStorage.setItem('seeded', '1');
    if (c) localStorage.setItem('wishlist.code', c);
    if (m !== undefined) { localStorage.setItem('wishlist.me', m); localStorage.setItem('wishlist.asked', '1'); }
  }, [code, me]);
  const page = await ctx.newPage();
  await page.goto(base);
  return page;
}

// Sets up lists straight through the API, so each test starts from its own data.
async function api(method, p, body) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Family-Code': CODE }, body: body && JSON.stringify(body) });
  return r.json();
}
async function person(name, wishes = []) {
  const { id } = await api('POST', '/api/people', { name });
  for (const title of wishes) await api('POST', '/api/items', { personId: id, title });
  return id;
}

const card = (page, name) => page.locator('section.card').filter({ has: page.locator('h2', { hasText: new RegExp('^' + name + '( \\(you\\))?$') }) });
const wish = (page, owner, title) => card(page, owner).locator('li.item').filter({ hasText: title });

test('the passcode keeps the lists locked until the right one is entered, then the first person can start', async () => {
  const page = await device({ code: '' });
  const dlg = page.getByRole('dialog', { name: 'Family passcode' });
  await dlg.getByLabel('Passcode').fill('wrong');
  await dlg.getByRole('button', { name: 'Open the lists' }).click();
  await dlg.getByText("That passcode didn't work").waitFor();

  await dlg.getByLabel('Passcode').fill(CODE);
  await dlg.getByRole('button', { name: 'Open the lists' }).click();
  await page.getByRole('button', { name: 'Add the first person' }).click();
  const add = page.getByRole('dialog', { name: 'Add a person' });
  await add.getByLabel('Name').fill('Ana');
  await add.getByRole('button', { name: 'Save' }).click();

  // The first person added on a device becomes "me" there.
  await card(page, 'Ana').getByText("This is your list, so we're keeping purchases a surprise.").waitFor();
  await page.context().close();
});

test('a wish with a link can be added to your own list', async () => {
  const me = await person('Carla');
  const page = await device({ me });
  await card(page, 'Carla').getByRole('button', { name: '+ Add a wish' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add a wish' });
  await dlg.getByLabel('What is it?').fill('Wool socks');
  await dlg.getByLabel('Link (optional)').fill('example.com/socks');
  await dlg.getByRole('button', { name: 'Save' }).click();
  const link = wish(page, 'Carla', 'Wool socks').getByRole('link', { name: 'Wool socks' });
  assert.strictEqual(await link.getAttribute('href'), 'https://example.com/socks');
  await page.context().close();
});

test('marking a gift bought shows to the family but stays a surprise for its owner, and can be undone', async () => {
  const dan = await person('Dan', ['Sled']);
  const eve = await person('Eve');
  const evePage = await device({ me: eve });
  const danPage = await device({ me: dan });

  await wish(evePage, 'Dan', 'Sled').getByRole('button', { name: 'I bought this' }).click();
  await evePage.getByRole('dialog', { name: 'Mark as bought?' }).getByRole('button', { name: 'Yes, I bought it' }).click();
  await wish(evePage, 'Dan', 'Sled').getByText("Someone's got this").waitFor();

  await danPage.reload();
  await wish(danPage, 'Dan', 'Sled').getByRole('button', { name: 'Edit' }).waitFor();
  assert.strictEqual(await wish(danPage, 'Dan', 'Sled').getByText("Someone's got this").count(), 0);

  await wish(evePage, 'Dan', 'Sled').getByRole('button', { name: 'Undo' }).click();
  await evePage.getByRole('dialog', { name: 'Undo this purchase mark?' }).getByRole('button', { name: 'Undo' }).click();
  await wish(evePage, 'Dan', 'Sled').getByRole('button', { name: 'I bought this' }).waitFor();
  await evePage.context().close(); await danPage.context().close();
});

test('a link that is not a web address stops Save and keeps the old link', async () => {
  const fay = await person('Fay');
  await api('POST', '/api/items', { personId: fay, title: 'Scarf', url: 'https://example.com/scarf' });
  const page = await device({ me: fay });
  await wish(page, 'Fay', 'Scarf').getByRole('button', { name: 'Edit' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit wish' });
  await dlg.getByLabel('Link (optional)').fill('not a link');
  await dlg.getByRole('button', { name: 'Save' }).click();
  assert.ok(await dlg.isVisible(), 'dialog should stay open');
  assert.match(await dlg.getByLabel('Link (optional)').evaluate(i => i.validationMessage), /web address/);
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  const saved = (await api('GET', '/api/data')).data.items.find(i => i.title === 'Scarf');
  assert.strictEqual(saved.url, 'https://example.com/scarf');
  await page.context().close();
});

test('a wish can be edited and removed, and a person renamed', async () => {
  const hal = await person('Hal', ['Gloves']);
  const page = await device({ me: hal });
  await wish(page, 'Hal', 'Gloves').getByRole('button', { name: 'Edit' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit wish' });
  await dlg.getByLabel('What is it?').fill('Warm gloves');
  await dlg.getByLabel('Link (optional)').fill('example.com/gloves');
  await dlg.getByRole('button', { name: 'Save' }).click();
  const link = wish(page, 'Hal', 'Warm gloves').getByRole('link', { name: 'Warm gloves' });
  assert.strictEqual(await link.getAttribute('href'), 'https://example.com/gloves');

  await wish(page, 'Hal', 'Warm gloves').getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove this wish?' }).getByRole('button', { name: 'Remove' }).click();
  await card(page, 'Hal').getByText("Add a few things you'd love.").waitFor();

  await card(page, 'Hal').getByRole('button', { name: 'Rename Hal' }).click();
  const ren = page.getByRole('dialog', { name: 'Rename' });
  await ren.getByLabel('Name').fill('Hallie');
  await ren.getByRole('button', { name: 'Save' }).click();
  await card(page, 'Hallie').waitFor();
  const saved = (await api('GET', '/api/data')).data;
  assert.ok(saved.people.some(p => p.name === 'Hallie') && !saved.items.some(i => i.personId === hal));
  await page.context().close();
});

test('removing a person removes their list for everyone', async () => {
  await person('Gus', ['Kite']);
  const page = await device({ me: '' });
  await card(page, 'Gus').getByRole('button', { name: 'Remove Gus' }).click();
  await page.getByRole('dialog', { name: 'Remove Gus?' }).getByRole('button', { name: 'Remove' }).click();
  await card(page, 'Gus').waitFor({ state: 'detached' });
  assert.ok(!(await api('GET', '/api/data')).data.people.some(p => p.name === 'Gus'));
  await page.context().close();
});
