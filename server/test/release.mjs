import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createClient } from '@libsql/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(join(tmpdir(), 'boomzy-release-'));
const url = 'file:' + join(temp, 'qa.db').replaceAll('\\', '/');
const listener = createServer();
await new Promise((done) => listener.listen(0, '127.0.0.1', done));
const port = process.argv.includes('--serve') ? 8993 : listener.address().port;
await new Promise((done) => listener.close(done));
const child = spawn(process.execPath, [join(root, 'server/dist/index.mjs')], {
  cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; child.stdout.on('data', (s) => { logs += s; }); child.stderr.on('data', (s) => { logs += s; });
const base = `http://127.0.0.1:${port}`;
let token = '';
async function request(path, body, auth = true) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let db;
async function cleanup() {
  child.kill(); await new Promise((done) => child.exitCode !== null ? done() : child.once('exit', done));
  db?.close();
  assert(resolve(temp).startsWith(resolve(tmpdir()) + '\\') || resolve(temp).startsWith(resolve(tmpdir()) + '/'));
  await rm(temp, { recursive: true, force: true });
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/api/health')).body.ok) break; } catch {}
    if (i === 99) throw new Error('QA server failed to start: ' + logs);
    await delay(100);
  }
  const reg = await request('/api/auth/register', { username: 'arsenalqa', password: 'local-arsenal-qa-2026' });
  assert.equal(reg.status, 200); token = reg.body.token;
  assert.equal((await request('/api/shop/buy', { itemId: 'voltRepeater' }, false)).status, 401);
  assert.equal((await request('/api/shop/buy', { itemId: 'voltRepeater' })).status, 402);
  assert.equal((await request('/api/equip', { charId: 'toto', slot: 'weapon', itemId: 'voltRepeater' })).status, 403);
  db = createClient({ url }); await db.execute("UPDATE users SET gold = 1200000 WHERE username = 'arsenalqa'");
  const weapons = ['voltRepeater', 'emberScatter', 'cometMortar', 'auroraBow', 'prismRang', 'tidalBubbles', 'sonicCrown', 'novaTalons', 'ionCarbine', 'eclipseLauncher'];
  const prices = [30000, 37000, 44000, 51000, 58000, 65000, 73000, 82000, 91000, 100000];
  let balance = 1200000;
  for (const [i, itemId] of weapons.entries()) {
    const bought = await request('/api/shop/buy', { itemId });
    assert.equal(bought.status, 200); assert.equal(bought.body.gold, balance -= prices[i]);
    assert.equal((await request('/api/shop/buy', { itemId })).status, 409);
    for (const charId of ['toto', 'boogie', 'popo', 'luna', 'kiki', 'mongle', 'leo', 'hoya']) {
      assert.equal((await request('/api/equip', { charId, slot: 'weapon', itemId })).status, 200);
    }
  }
  assert.equal((await request('/api/equip', { charId: 'toto', slot: 'hat', itemId: 'voltRepeater' })).status, 400);
  assert.equal((await request('/api/equip', { charId: 'toto', slot: 'weapon', itemId: null })).status, 200);
  const me = (await request('/api/me')).body;
  assert.equal(me.user.gold, balance); assert.equal(me.inventory.length, 10); assert.equal(me.user.totalSpent, prices.reduce((a, b) => a + b));
  assert.equal(me.equipment.toto?.weapon, undefined); assert.equal(me.equipment.hoya.weapon, 'eclipseLauncher');
  const ledger = await db.execute("SELECT COUNT(*) AS n FROM purchases p JOIN users u ON u.id = p.user_id WHERE u.username = 'arsenalqa'");
  assert.equal(Number(ledger.rows[0].n), 10);
  const maps = ['sunken_harbor', 'ember_forge', 'bamboo_pass', 'neon_junction', 'crystal_cavern', 'sky_gardens'];
  for (const mapId of maps) {
    const result = await request('/api/results', { deviceId: 'release-qa-device-' + mapId, nickname: 'QA', charId: 'toto', mapId, place: 4, kills: 0, assists: 0, damage: 0, score: 0, durationMs: 270000 }, false);
    assert.equal(result.status, 200, mapId + JSON.stringify(result.body));
  }
  const resultBody = { deviceId: 'release-qa-twelve', nickname: 'QA', charId: 'toto', mapId: 'meadow', place: 12, kills: 0, assists: 0, damage: 0, score: 0, durationMs: 270000 };
  for (const place of [9, 10, 11, 12]) {
    const result = await request('/api/results', { ...resultBody, place, deviceId: `release-qa-place-${place}` }, false);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  assert.equal((await request('/api/results', { ...resultBody, deviceId: 'release-qa-eleven-kills', place: 1, kills: 11, damage: 160000, score: 1100 }, false)).status, 200);
  assert.equal((await request('/api/results', { ...resultBody, deviceId: 'release-qa-eleven-assists', place: 1, assists: 11, score: 440 }, false)).status, 200);
  for (const invalid of [{ place: 13 }, { kills: 12 }, { assists: 12 }]) {
    assert.equal((await request('/api/results', { ...resultBody, ...invalid }, false)).status, 400);
  }
  assert.equal((await request('/api/health')).body.playerCount, 12);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /BOOMZY/i);
  console.log('PASS: isolated API checks — shop, 80 equips, six maps, 270s results, ranks 9–12, 11 kills/assists, rejection above 12-player limits.');
  if (process.argv.includes('--serve')) {
    console.log('QA preview: ' + base + ' (local disposable account: arsenalqa)');
    await new Promise((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
  }
} finally { await cleanup(); }
