import { describe, it, expect } from 'vitest';
import { MAPS, buildMap, World, CHARACTERS, emptyInput, type PlayerSlot } from '../src';
import { NavGrid } from '../src/sim/nav';

describe.each(MAPS.map((m) => [m.id]))('map %s', (id) => {
  const m = buildMap(id);
  it('has 8 spawns, 12 crates, bushes and cover', () => {
    expect(m.spawns).toHaveLength(8);
    expect(m.obstacles.filter((o) => o.type === 'crate')).toHaveLength(12);
    expect(m.bushes.length).toBeGreaterThan(20);
    expect(m.obstacles.filter((o) => o.type === 'rock').length).toBeGreaterThan(16);
    expect(m.theme).toBeTruthy();
  });
  it('is mirror symmetric', () => {
    for (const o of m.obstacles) expect(m.obstacles.some((q) => q.type === o.type && Math.abs(q.x + o.x) < 0.01 && Math.abs(q.y - o.y) < 0.01)).toBe(true);
    for (const b of m.bushes) expect(m.bushes.some((q) => Math.abs(q.x - b.y) < 0.01 && Math.abs(q.y - b.x) < 0.01)).toBe(true);
  });
  it('keeps spawn safe zones clear', () => {
    for (const s of m.spawns) for (const o of m.obstacles) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThan(4);
  });
  it('has no overlapping solid props', () => {
    const solid = m.obstacles;
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      const ra = a.shape === 'box' ? a.hw : a.r, rb = b.shape === 'box' ? b.hw : b.r;
      if (a.type === b.type && (a.type === 'rock' || a.type === 'water')) continue; // walls / lagoon chains touch on purpose
      expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.type}#${a.id} vs ${b.type}#${b.id}`).toBeGreaterThan((ra + rb) * 0.75);
    }
  });
  it('every spawn can walk to the centre and to its neighbour', () => {
    const nav = new NavGrid(m.half, m.obstacles);
    for (let i = 0; i < 8; i++) {
      const s = m.spawns[i];
      expect(nav.findPath(s, { x: 0.5, y: 6.5 }, 20000), `spawn ${i} → centre`).not.toBeNull();
      expect(nav.findPath(s, m.spawns[(i + 1) % 8], 20000), `spawn ${i} → ${i + 1}`).not.toBeNull();
    }
  });
  it('plays a full 8-bot match to the end', () => {
    const players: PlayerSlot[] = CHARACTERS.concat(CHARACTERS.slice(0, 2)).map((c, i) => ({ id: 'b' + i, name: 'b' + i, charId: c.id, isBot: true, difficulty: 1 }));
    const w = new World(buildMap(id), { mode: 'ffa', durationMs: 240000, seed: 5, players, poison: true, mapEvents: true, countdownMs: 0 });
    let steps = 0;
    while (w.phase !== 'ended' && steps < 20 * 260) { w.step(1 / 20); w.drainEvents(); steps++; }
    expect(w.phase).toBe('ended');
  });
});

describe('ice', () => {
  it('slides: keeps moving after input stops', () => {
    const m = buildMap('glacier');
    const w = new World(m, { mode: 'ffa', durationMs: 240000, seed: 1, players: [{ id: 'a', name: 'a', charId: 'toto', isBot: false }, { id: 'z', name: 'z', charId: 'luna', isBot: false }], poison: false, mapEvents: false, countdownMs: 0 });
    m.obstacles.forEach((o) => { o.alive = false; });
    const f = w.fighters[0];
    f.x = f.px = -5; f.y = f.py = 0; // central ice lake
    w.setInput('a', { ...emptyInput(), moveX: 1 });
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    w.setInput('a', emptyInput());
    const x0 = f.x;
    for (let i = 0; i < 20; i++) w.step(1 / 60);
    expect(f.x - x0).toBeGreaterThan(0.8); // grass would stop within ~0.15m
  });
});
