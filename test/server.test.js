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

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: ['ignore', 'pipe', 'inherit'], // show the server's errors if it fails to start
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: path.join(dir, 'wishlists.json'), FAMILY_CODE: CODE }
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => { if (String(d).includes('running')) resolve(); });
    server.on('exit', code => reject(new Error('server exited with ' + code)));
  });
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
