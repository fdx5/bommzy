import { describe, it, expect } from 'vitest';
import { World, RULES, WEAPONS, SHOP_WEAPONS, CHARACTERS, buildMap, emptyInput, MAPS, attackDamage, type Obstacle } from '../src';
import { NavGrid } from '../src/sim/nav';

const obstacle = (type: 'rock' | 'crate', x: number, y: number, r = 1): Obstacle => ({
  id: 0, type, x, y, r, hw: r, hh: r, shape: type === 'crate' ? 'box' : 'circle', variant: 0, rot: 0, scale: 1,
  alive: true, blocksMove: true, blocksShots: true, destructible: true, hp: type === 'crate' ? 2600 : 100, maxHp: 2600, cubes: 1,
});

describe('arsenal', () => {
  it('adds ten bounded upgrades priced from 30,000 through 100,000', () => {
    expect(SHOP_WEAPONS).toHaveLength(10);
    expect(Math.min(...SHOP_WEAPONS.map((w) => w.price!))).toBe(30000);
    expect(Math.max(...SHOP_WEAPONS.map((w) => w.price!))).toBe(100000);
    for (const w of SHOP_WEAPONS) {
      const base = WEAPONS[w.baseWeaponId!];
      expect(attackDamage(w) / attackDamage(base)).toBeGreaterThan(1.05);
      expect(attackDamage(w) / attackDamage(base)).toBeLessThan(1.09);
      expect(w.superChargePerHit).toBe(base.superChargePerHit);
      expect(w.fxColor).toBeTruthy(); expect(w.fxShape).toBeTruthy();
    }
  });
  it.each(CHARACTERS.map((c) => c.id))('lets %s equip and fire all ten weapons', (charId) => {
    for (const gun of SHOP_WEAPONS) {
      const map = buildMap(); map.obstacles = []; map.bushes = [];
      const w = new World(map, { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 11, poison: false, mapEvents: false, countdownMs: 0,
        players: [{ id: 'a', name: 'a', charId, isBot: false, weaponId: gun.id }, { id: 'b', name: 'b', charId: 'boogie', isBot: false }] });
      const [a, b] = w.fighters; a.x = a.y = a.px = a.py = 0; b.x = b.px = gun.range * 0.4; b.y = b.py = 0;
      b.hp = b.maxHp = 100000;
      w.setInput('a', { ...emptyInput(), fire: true, aimX: 1, aimDist: b.x });
      for (let i = 0; i < 120; i++) { w.step(1 / 60); w.drainEvents(); }
      expect(w.weapon(a).id).toBe(gun.id);
      expect(a.damageDealt, gun.id).toBeGreaterThan(0);
    }
  });
  it('keeps character supers independent of an equipped weapon', () => {
    const run = (weaponId?: string) => {
      const map = buildMap(); map.obstacles = []; map.bushes = [];
      const w = new World(map, { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 1, poison: false, mapEvents: false, countdownMs: 0,
        players: [{ id: 'a', name: 'a', charId: 'toto', isBot: false, weaponId }, { id: 'b', name: 'b', charId: 'boogie', isBot: false }] });
      w.fighters[0].superCharge = 1; w.setInput('a', { ...emptyInput(), superFire: true, aimX: 1 }); w.step(1 / 60); w.setInput('a', emptyInput()); w.step(1 / 60);
      return w.projectiles[0].damage;
    };
    expect(run('eclipseLauncher')).toBe(run());
  });
});

describe('navigation regressions', () => {
  it('ends outside an obstructed crate goal and keeps every path segment walkable', () => {
    const o = obstacle('crate', 0, 0), nav = new NavGrid(40, [o]);
    const from = { x: -7, y: 0 }, route = nav.findPath(from, { x: 0, y: 0 })!;
    expect(route).not.toBeNull(); expect(nav.canStandAt(route.at(-1)!)).toBe(true);
    let last = from; for (const p of route) { expect(nav.canWalkSegment(last, p)).toBe(true); last = p; }
  });
  it('retains the bend around a rock instead of cutting through its last corner', () => {
    const nav = new NavGrid(40, [obstacle('rock', 0, 0, 3)]), from = { x: -6, y: 0 }, to = { x: 6, y: 0 };
    const route = nav.findPath(from, to)!; expect(route.length).toBeGreaterThan(1);
    let last = from; for (const p of route) { expect(nav.canWalkSegment(last, p)).toBe(true); last = p; }
  });
  it.each((['toto', 'boogie', 'kiki'] as const).flatMap((charId) => [0, -5].map((y) => ({ charId, y }))))('$charId shoots a crate from y=$y without treating the crate itself as occluding cover', ({ charId, y }) => {
    const map = buildMap(); map.obstacles = [obstacle('crate', 0, 0)]; map.bushes = [];
    const w = new World(map, { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 8, poison: false, mapEvents: false, countdownMs: 0,
      players: [{ id: 'a', name: 'a', charId, isBot: true, difficulty: 1 }, { id: 'b', name: 'b', charId: 'toto', isBot: false }, { id: 'c', name: 'c', charId: 'toto', isBot: false }, { id: 'd', name: 'd', charId: 'toto', isBot: false }] });
    Object.assign(w.fighters[0], { x: -5, px: -5, y, py: y }); Object.assign(w.fighters[1], { x: 34, px: 34, y: 34, py: 34 });
    for (let i = 0; i < 20 * 12; i++) { w.step(1 / 20); w.drainEvents(); }
    expect(map.obstacles[0].alive).toBe(false);
  });
  it('updates paths after terrain destruction', () => {
    const o = obstacle('rock', 0, 0, 3), nav = new NavGrid(40, [o]);
    expect(nav.canWalkSegment({ x: -5, y: 0 }, { x: 5, y: 0 })).toBe(false);
    o.alive = false; nav.onObstacleRemoved(o);
    expect(nav.canWalkSegment({ x: -5, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });
  it('finishes a search safely when the last-known enemy position is inside cover', () => {
    const map = buildMap(); map.obstacles = [obstacle('rock', 0, 0, 3)]; map.bushes = [];
    const w = new World(map, { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 8, poison: false, mapEvents: false, countdownMs: 0,
      players: [{ id: 'a', name: 'a', charId: 'toto', isBot: true }, { id: 'b', name: 'b', charId: 'toto', isBot: false }] });
    const bot = w.bots.get('a')!;
    const endpoint = w.nav.findPath({ x: -8, y: 0 }, { x: 0, y: 0 })!.at(-1)!;
    Object.assign(w.fighters[0], { x: endpoint.x, px: endpoint.x, y: endpoint.y, py: endpoint.y });
    Object.assign(w.fighters[1], { x: 34, y: 34, px: 34, py: 34 });
    Object.assign(bot, { state: 'hunt', lastSeen: { x: 0, y: 0, t: 0 }, senseAt: 100000 });
    expect(() => w.step(1 / 20)).not.toThrow();
    for (let i = 0; i < 40; i++) { w.step(1 / 20); w.drainEvents(); }
    expect(Math.hypot(w.fighters[0].x - endpoint.x, w.fighters[0].y - endpoint.y)).toBeGreaterThan(1);
  });
  it('walks out of a narrow gap after knockback instead of waiting for a failed grid route', () => {
    const w = new World(buildMap('starlight'), { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 5006, poison: false, mapEvents: false, countdownMs: 0,
      players: [{ id: 'a', name: 'a', charId: 'kiki', isBot: true }, { id: 'b', name: 'b', charId: 'luna', isBot: false }] });
    const [a, b] = w.fighters;
    Object.assign(a, { x: 0.6197428938, px: 0.6197428938, y: -12.9685958, py: -12.9685958 });
    Object.assign(b, { x: -1.66548023, px: -1.66548023, y: -18.95648213, py: -18.95648213, hp: 100000, maxHp: 100000 });
    const start = { x: a.x, y: a.y };
    for (let i = 0; i < 80; i++) { w.step(1 / 20); w.drainEvents(); }
    expect(Math.hypot(a.x - start.x, a.y - start.y)).toBeGreaterThan(2);
  });
});

describe('arena expansion and time', () => {
  it('contains 13 different layouts and authored paths', () => {
    expect(MAPS).toHaveLength(13);
    const signatures = MAPS.map((m) => JSON.stringify(buildMap(m.id).obstacles.map((o) => [o.type, o.x, o.y])));
    expect(new Set(signatures).size).toBe(13);
    for (const m of MAPS) expect(buildMap(m.id).paths!.length).toBeGreaterThan(0);
  });
  it('runs for 270 seconds with the cloud beginning 30 seconds later', () => {
    expect(RULES.matchDurationMs).toBe(270000); expect(RULES.poisonStartMs).toBe(120000);
    const w = new World(buildMap(), { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 2, poison: false, mapEvents: false, countdownMs: 0,
      players: [{ id: 'a', name: 'a', charId: 'toto', isBot: false }, { id: 'b', name: 'b', charId: 'kiki', isBot: false }] });
    for (let i = 0; i < 240; i++) w.step(1);
    expect(w.phase).toBe('playing'); for (let i = 0; i < 30; i++) w.step(1); expect(w.phase).toBe('ended');
  });
});
