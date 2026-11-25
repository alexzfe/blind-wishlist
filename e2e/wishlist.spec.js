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

// Phones and tablets the family uses, held both ways. Touch screens, so nothing can rely on hovering.
const SCREENS = [
  { name: 'small phone', viewport: { width: 320, height: 568 }, isMobile: true },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true },
  { name: 'tablet upright', viewport: { width: 820, height: 1180 }, isMobile: true },
  { name: 'tablet sideways', viewport: { width: 1180, height: 820 }, isMobile: true }
];

// A family member's device. With a passcode already entered unless told otherwise. Without `me` it doesn't know who it is yet.
// Pass a screen from SCREENS to make it a touch phone or tablet; otherwise it's a desktop browser.
async function device({ code = CODE, me, screen } = {}) {
  const ctx = await browser.newContext(screen ? { viewport: screen.viewport, isMobile: screen.isMobile, hasTouch: true } : {});
  await ctx.addInitScript(([c, m]) => {
    if (sessionStorage.getItem('seeded')) return; // only before the first load, so reloads keep what the page saved
    sessionStorage.setItem('seeded', '1');
    if (c) localStorage.setItem('wishlist.code', c);
    if (m) localStorage.setItem('wishlist.me', m);
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
  const who = page.getByRole('dialog', { name: 'Who are you?' });
  await who.getByLabel('Write your name to start the family lists').fill('Ana');
  await who.getByRole('button', { name: 'Join' }).click();
  await who.getByText('Join as Ana?').waitFor();
  await who.getByRole('button', { name: "Yes, that's me" }).click();

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
  const page = await device({ me: await person('Gwen') });
  await card(page, 'Gus').getByRole('button', { name: 'Remove Gus' }).click();
  await page.getByRole('dialog', { name: 'Remove Gus?' }).getByRole('button', { name: 'Remove' }).click();
  await card(page, 'Gus').waitFor({ state: 'detached' });
  assert.ok(!(await api('GET', '/api/data')).data.people.some(p => p.name === 'Gus'));
  await page.context().close();
});

for (const screen of SCREENS) {
  test(`on a ${screen.name}, the lists fit the screen and every control is big enough to tap`, async () => {
    const me = await person(`Ivy ${screen.name}`, ['Mittens']);
    await person(`Uncle Bartholomew-Fitzgerald ${screen.name}`);
    await api('POST', '/api/items', { personId: me, title: 'A very long wish for a cast iron skillet with a lid and a matching trivet', url: 'https://www.example-store-with-a-very-long-domain-name.com/products/skillet?ref=abcdefghijklmnopqrstuvwxyz0123456789', notes: 'Any colour except orange' });
    const page = await device({ me, screen });
    await card(page, `Ivy ${screen.name}`).waitFor();

    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.strictEqual(sideways, false, 'the page should not scroll sideways');

    // Links inside a wish's title are text, so they're exempt; every other control needs a 40px finger target.
    const tooSmall = await page.locator('button, .it-act a').evaluateAll(els => els
      .filter(e => e.offsetParent)
      .map(e => ({ what: (e.getAttribute('aria-label') || e.textContent).trim(), ...e.getBoundingClientRect().toJSON() }))
      .filter(r => r.height < 40 || r.width < 40)
      .map(r => `${r.what} (${Math.round(r.width)}x${Math.round(r.height)})`));
    assert.deepStrictEqual(tooSmall, []);

    // There's no hover on a touch screen, so rename and remove must already be showing.
    const tools = card(page, `Ivy ${screen.name}`).getByRole('button', { name: `Rename Ivy ${screen.name}` });
    assert.strictEqual(await tools.evaluate(e => getComputedStyle(e.parentElement).opacity), '1');

    // Phones zoom the page into any field whose text is under 16px, which leaves people stuck zoomed in.
    await card(page, `Ivy ${screen.name}`).getByRole('button', { name: '+ Add a wish' }).tap();
    const sizes = await page.getByRole('dialog', { name: 'Add a wish' }).locator('input').evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(sizes.every(s => s >= 16), `form fields should be at least 16px, got ${sizes}`);
    await page.context().close();
  });

  test(`on a ${screen.name}, a wish can be added and a gift marked bought by tapping`, async () => {
    const me = await person(`Jo ${screen.name}`);
    await person(`Kit ${screen.name}`, ['Board game']);
    const page = await device({ me, screen });

    await card(page, `Jo ${screen.name}`).getByRole('button', { name: '+ Add a wish' }).tap();
    const dlg = page.getByRole('dialog', { name: 'Add a wish' });
    await dlg.getByLabel('What is it?').fill('Puzzle');
    await dlg.getByRole('button', { name: 'Save' }).tap();
    await wish(page, `Jo ${screen.name}`, 'Puzzle').waitFor();

    await wish(page, `Kit ${screen.name}`, 'Board game').getByRole('button', { name: 'I bought this' }).tap();
    await page.getByRole('dialog', { name: 'Mark as bought?' }).getByRole('button', { name: 'Yes, I bought it' }).tap();
    await wish(page, `Kit ${screen.name}`, 'Board game').getByText("Someone's got this").waitFor();
    await page.context().close();
  });
}

// A centred dialog would sit under the on-screen keyboard and hide Save, so on phones dialogs sit at the top.
// Phones too short to fit Save above the keyboard rely on Go saving instead (tested below).
for (const screen of SCREENS.filter(s => s.viewport.width < 600)) {
  test(`on a ${screen.name}, dialogs sit at the top of the screen, with Save above the keyboard where it fits`, async () => {
    const me = await person(`Lu ${screen.name}`);
    const page = await device({ me, screen });
    await card(page, `Lu ${screen.name}`).getByRole('button', { name: '+ Add a wish' }).tap();
    const dlg = page.getByRole('dialog', { name: 'Add a wish' });
    const box = await dlg.boundingBox(), save = await dlg.getByRole('button', { name: 'Save' }).boundingBox();
    await page.context().close();
    assert.ok(box.y <= 24, `dialog starts ${Math.round(box.y)}px down`);
    // A phone keyboard is about 300px tall. On the smallest phones nothing fits above it, so Go on the keyboard has to save (tested below).
    if (screen.viewport.height >= 800) assert.ok(save.y + save.height < screen.viewport.height - 300, `Save ends at ${Math.round(save.y + save.height)}px of ${screen.viewport.height}px`);
  });
}

test('pressing Go on a phone keyboard saves the wish instead of throwing it away', async () => {
  const me = await person('Max');
  const page = await device({ me, screen: SCREENS[0] });
  await card(page, 'Max').getByRole('button', { name: '+ Add a wish' }).tap();
  const field = page.getByRole('dialog', { name: 'Add a wish' }).getByLabel('What is it?');
  await field.fill('Snow boots');
  await field.press('Enter');
  await wish(page, 'Max', 'Snow boots').waitFor();
  await page.context().close();
});

test('Cancel closes a form without saving', async () => {
  const me = await person('Nia');
  const page = await device({ me, screen: SCREENS[1] });
  await card(page, 'Nia').getByRole('button', { name: '+ Add a wish' }).tap();
  const dlg = page.getByRole('dialog', { name: 'Add a wish' });
  await dlg.getByLabel('What is it?').fill('Not this one');
  await dlg.getByRole('button', { name: 'Cancel' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.body.classList.contains('busy'));
  assert.ok(!(await api('GET', '/api/data')).data.items.some(i => i.title === 'Not this one'));
  await page.context().close();
});

const who = page => page.getByRole('dialog', { name: 'Who are you?' });
const banner = page => page.locator('#meBar');

test('a new device must say who it is on a screen that covers everything, and confirm it', async () => {
  await person('Opal'); await person('Olly');
  const page = await device({ screen: SCREENS[1] });
  const box = await who(page).boundingBox();
  assert.deepStrictEqual([box.width, box.height], [SCREENS[1].viewport.width, SCREENS[1].viewport.height]);
  assert.strictEqual(await page.getByText('Just browsing').count(), 0);

  // Escape (even twice) doesn't skip it.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('dlgWho').open);
  assert.ok(await who(page).isVisible());

  // A wrong tap can be taken back.
  await who(page).getByRole('button', { name: 'Olly', exact: true }).tap();
  await who(page).getByText("You're Olly?").waitFor();
  await who(page).getByRole('button', { name: 'No, go back' }).tap();
  await who(page).getByRole('button', { name: 'Opal', exact: true }).tap();
  await who(page).getByRole('button', { name: "Yes, that's me" }).tap();
  await who(page).waitFor({ state: 'hidden' });
  assert.strictEqual(await banner(page).locator('strong').textContent(), 'Opal');
  await card(page, 'Opal').getByText("This is your list, so we're keeping purchases a surprise.").waitFor();
  await page.context().close();
});

test('writing a name that is already on the list picks that person instead of adding a twin', async () => {
  await person('Pia');
  const page = await device();
  await who(page).getByLabel('Not on the list? Write your name').fill(' pia ');
  await who(page).getByRole('button', { name: 'Join' }).click();
  await who(page).getByText("You're Pia?").waitFor();
  await who(page).getByRole('button', { name: "Yes, that's me" }).click();
  await who(page).waitFor({ state: 'hidden' });
  assert.strictEqual((await api('GET', '/api/data')).data.people.filter(p => p.name.toLowerCase() === 'pia').length, 1);
  await page.context().close();
});

test('"Not you?" lets someone switch, or go back to who they were', async () => {
  const sam = await person('Sam'); await person('Tess');
  const page = await device({ me: sam });
  await banner(page).getByRole('button', { name: 'Not Sam?' }).click();
  await who(page).getByRole('button', { name: "Go back, I'm Sam" }).click();
  await who(page).waitFor({ state: 'hidden' });
  await banner(page).getByRole('button', { name: 'Not Sam?' }).click();
  await who(page).getByRole('button', { name: 'Tess', exact: true }).click();
  await who(page).getByRole('button', { name: "Yes, that's me" }).click();
  await banner(page).getByText('Tess', { exact: true }).waitFor();
  await page.context().close();
});

async function linkFor(id) { return (await api('POST', `/api/people/${id}/link`)).link; }

test('a personal link signs its person in once, and a forwarded copy no longer works', async () => {
  const quinn = await person('Quinn'); const rex = await person('Rex');
  const link = await linkFor(quinn);

  // Opened by mistake on a device that already knows who it is: nothing changes, and the link isn't used up.
  const rexPage = await device({ me: rex });
  await rexPage.goto(base + '/?link=' + link);
  await rexPage.getByText('already signed in as Rex').waitFor();
  assert.strictEqual(await banner(rexPage).locator('strong').textContent(), 'Rex');

  // Quinn's new phone doesn't have the passcode: the link signs it in anyway, without asking.
  const page = await device({ code: '' });
  await page.goto(base + '/?link=' + link);
  await banner(page).getByText('Quinn', { exact: true }).waitFor();
  assert.ok(await page.getByRole('dialog', { name: 'Family passcode' }).isHidden());
  assert.ok(await who(page).isHidden());
  assert.strictEqual(new URL(page.url()).search, '', 'the link is tidied out of the address bar');
  await page.reload(); // the phone remembers the passcode, so it stays signed in
  await banner(page).getByText('Quinn', { exact: true }).waitFor();

  // The same link opened on someone else's new device signs nobody in.
  const other = await device();
  await other.goto(base + '/?link=' + link);
  await who(other).getByText('That personal link was already used').waitFor();

  // And a forwarded copy on a phone without the passcode still has to ask for it.
  const stranger = await device({ code: '' });
  await stranger.goto(base + '/?link=' + link);
  const code = stranger.getByRole('dialog', { name: 'Family passcode' });
  await code.getByLabel('Passcode').fill(CODE);
  await code.getByRole('button', { name: 'Open the lists' }).click();
  await who(stranger).getByText('That personal link was already used').waitFor();
  for (const p of [page, other, rexPage, stranger]) await p.context().close();
});

test("a card's personal link stays the same until it is used", async () => {
  const sol = await person('Sol');
  const page = await device({ me: sol });
  const open = async () => {
    await card(page, 'Sol').getByRole('button', { name: 'Personal link for Sol' }).click();
    const dlg = page.getByRole('dialog', { name: "Sol's personal link" });
    const url = await dlg.getByLabel('Link').inputValue();
    await dlg.getByRole('button', { name: 'Close' }).click();
    return url;
  };
  const first = await open();
  assert.match(first, /\/\?link=[\w-]{20,}$/);
  assert.strictEqual(await open(), first);
  await page.context().close();
});

test('a made-up link signs nobody in', async () => {
  const page = await device();
  await page.goto(base + '/?link=made-up');
  await who(page).getByText('That personal link was already used').waitFor();
  assert.ok(await banner(page).isHidden());
  await page.context().close();
});

test('holding Enter in the name box stops at the question, and pressing Yes twice adds the person once', async () => {
  const page = await device();
  const name = who(page).getByLabel(/Write your name/);
  await name.fill('Vera Twice');
  await name.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await who(page).getByText('Join as Vera Twice?').waitFor();
  assert.ok(await who(page).isVisible(), 'still asking');

  const yes = who(page).getByRole('button', { name: "Yes, that's me" });
  await yes.focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await who(page).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.body.classList.contains('busy'));
  assert.strictEqual((await api('GET', '/api/data')).data.people.filter(p => p.name === 'Vera Twice').length, 1);
  await page.context().close();
});
