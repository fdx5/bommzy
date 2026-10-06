import { describe, it, expect } from 'vitest';
import {
  World, buildMeadow, validateData, balanceReport, SUPER_CHARGE_RATE, segCircle, segAABB, emptyInput, BUSH, isVisibleTo,
  clusterBushes, CHARACTERS, type PlayerSlot, type MatchConfig, type BushDef,
} from '../src';

const DT = 1 / 60;

function makeWorld(players: PlayerSlot[], extra: Partial<MatchConfig> = {}) {
  return new World(buildMeadow(), { mode: 'ffa', durationMs: 180000, seed: 3, players, poison: false, mapEvents: false, countdownMs: 0, ...extra });
}
const human = (id: string, charId: PlayerSlot['charId'] = 'toto'): PlayerSlot => ({ id, name: id, charId, isBot: false });

/** Put two fighters on an empty strip of the map facing each other. */
function duel(a: PlayerSlot['charId'], b: PlayerSlot['charId'], gap = 6) {
  const w = makeWorld([human('a', a), human('b', b)]);
  w.map.obstacles.forEach((o) => { o.alive = false; });
  w.bushStates.forEach((s) => { s.alive = false; s.regrowAt = 1e12; });
  const [fa, fb] = w.fighters;
  fa.x = fa.px = 0; fa.y = fa.py = 0; fb.x = fb.px = gap; fb.y = fb.py = 0;
  return { w, fa, fb };
}

describe('data', () => {
  it('passes zod validation', () => { expect(() => validateData()).not.toThrow(); });
  it('keeps TTK in 2.5~4.5s and super in (4~7 attacks) / SUPER_CHARGE_RATE', () => {
    for (const r of balanceReport()) {
      expect(r.ttk).toBeGreaterThanOrEqual(2.5); expect(r.ttk).toBeLessThanOrEqual(4.5);
      expect(r.attacksPerSuper).toBeGreaterThanOrEqual(4 / SUPER_CHARGE_RATE - 0.01); expect(r.attacksPerSuper).toBeLessThanOrEqual(7 / SUPER_CHARGE_RATE + 0.01);
    }
  });
});

describe('geometry', () => {
  it('segment vs circle', () => {
    expect(segCircle(-5, 0, 5, 0, 0, 0, 1)).toBeCloseTo(0.4);
    expect(segCircle(-5, 2, 5, 2, 0, 0, 1)).toBe(-1);
  });
  it('segment vs box', () => {
    expect(segAABB(-5, 0, 5, 0, -1, -1, 1, 1)).toBeCloseTo(0.4);
    expect(segAABB(-5, 3, 5, 3, -1, -1, 1, 1)).toBe(-1);
  });
});

describe('map', () => {
  const m = buildMeadow();
  it('has 8 spawns, 12 crates and a reasonable prop count', () => {
    expect(m.spawns).toHaveLength(8);
    expect(m.obstacles.filter((o) => o.type === 'crate')).toHaveLength(12);
    const trees = m.obstacles.filter((o) => o.type === 'tree').length;
    expect(trees).toBeGreaterThanOrEqual(40); expect(trees).toBeLessThanOrEqual(64);
  });
  it('is mirror symmetric', () => {
    for (const o of m.obstacles) {
      expect(m.obstacles.some((q) => q.type === o.type && Math.abs(q.x + o.x) < 0.01 && Math.abs(q.y - o.y) < 0.01)).toBe(true);
    }
  });
  it('keeps spawn safe zones clear', () => {
    for (const s of m.spawns) for (const o of m.obstacles) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThan(4);
  });
});

describe('movement & collision', () => {
  it('accelerates quickly and stops at rocks', () => {
    const { w, fa: f } = duel('toto', 'boogie', 30);
    const rock = w.map.obstacles.find((o) => o.type === 'rock')!;
    rock.alive = true;
    f.x = rock.x - 3; f.y = rock.y;
    w.setInput('a', { ...emptyInput(), moveX: 1 });
    for (let i = 0; i < 6; i++) w.step(DT);
    expect(Math.hypot(f.vx, f.vy)).toBeGreaterThan(4); // ~0.1s to near top speed
    for (let i = 0; i < 120; i++) w.step(DT);
    expect(Math.hypot(f.x - rock.x, f.y - rock.y)).toBeGreaterThanOrEqual(rock.r + 0.5);
  });
});

describe('weapons', () => {
  it('3-slot magazine reloads one slot at a time', () => {
    const { w, fa } = duel('luna', 'boogie', 20);
    for (let i = 0; i < 3; i++) {
      w.setInput('a', { ...emptyInput(), aimX: 0, aimY: 1, fire: true });
      for (let k = 0; k < 40; k++) { w.step(DT); w.setInput('a', { ...emptyInput(), aimX: 0, aimY: 1 }); }
    }
    expect(fa.ammo).toBeLessThan(1.01);
    const reload = 1800;
    for (let k = 0; k < Math.ceil(reload / 1000 / DT) + 2; k++) w.step(DT);
    expect(fa.ammo).toBeGreaterThanOrEqual(1);
    expect(fa.ammo).toBeLessThan(3);
  });

  it('shotgun hits hard up close and charges super', () => {
    const { w, fa, fb } = duel('boogie', 'toto', 2);
    w.setInput('a', { ...emptyInput(), aimX: 1, aimY: 0, fire: true });
    for (let i = 0; i < 30; i++) { w.step(DT); w.setInput('a', { ...emptyInput(), aimX: 1 }); }
    expect(fb.hp).toBeLessThan(fb.maxHp - 1000);
    expect(fa.superCharge).toBeGreaterThan(0.15);
  });

  it('normal attacks never break rocks; supers do', () => {
    const { w, fa, fb } = duel('popo', 'toto', 30);
    const rock = w.map.obstacles.find((o) => o.type === 'rock')!;
    rock.alive = true; fa.x = rock.x - 6; fa.y = rock.y; fb.x = rock.x + 30 > 38 ? rock.x - 30 : rock.x + 30;
    w.setInput('a', { ...emptyInput(), aimX: 1, aimDist: 6, fire: true });
    for (let i = 0; i < 90; i++) { w.step(DT); w.setInput('a', { ...emptyInput(), aimX: 1, aimDist: 6 }); }
    expect(rock.alive).toBe(true);
    fa.superCharge = 1;
    w.setInput('a', { ...emptyInput(), aimX: 1, aimDist: 6, superFire: true });
    for (let i = 0; i < 90; i++) { w.step(DT); w.setInput('a', { ...emptyInput() }); }
    expect(rock.alive).toBe(false);
  });

  it('every character super can destroy a rock', () => {
    for (const c of CHARACTERS) {
      const { w, fa, fb } = duel(c.id, 'toto', 30);
      const rock = w.map.obstacles.find((o) => o.type === 'rock')!;
      const gap = c.id === 'kiki' ? 2.2 : 4.5;
      rock.alive = true; fa.x = rock.x - gap; fa.y = rock.y; fb.x = fa.x > 0 ? -35 : 35; fb.y = -35;
      fa.superCharge = 1;
      w.setInput('a', { ...emptyInput(), aimX: 1, aimDist: gap, superFire: true });
      for (let i = 0; i < 240; i++) { w.step(DT); w.setInput('a', { ...emptyInput(), aimX: 1, aimDist: gap }); }
      expect(rock.alive, `${c.id} super should break rocks`).toBe(false);
    }
  });

  it('boomerang hits on the way out and back', () => {
    const { w, fb } = duel('kiki', 'boogie', 5);
    w.setInput('a', { ...emptyInput(), aimX: 1, fire: true });
    for (let i = 0; i < 150; i++) { w.step(DT); w.setInput('a', { ...emptyInput(), aimX: 1 }); }
    expect(fb.maxHp - fb.hp).toBeGreaterThanOrEqual(480 * 2 - 1);
  });

  it('HP regenerates after 3s out of combat', () => {
    const { w, fb } = duel('toto', 'boogie', 30);
    fb.hp = 1000; fb.lastCombatAt = w.time;
    for (let i = 0; i < 60 * 2.5; i++) w.step(DT);
    expect(fb.hp).toBe(1000);
    for (let i = 0; i < 60 * 1.5; i++) w.step(DT);
    expect(fb.hp).toBeGreaterThan(1000);
  });

  it('retires at 0 HP and absorbs power cubes', () => {
    const { w, fa, fb } = duel('boogie', 'luna', 2);
    fb.cubes = 2; fb.hp = 300;
    w.setInput('a', { ...emptyInput(), aimX: 1, fire: true });
    for (let i = 0; i < 20; i++) { w.step(DT); w.setInput('a', { ...emptyInput(), aimX: 1 }); }
    expect(fb.alive).toBe(false);
    expect(fa.kills).toBe(1);
    expect(fa.cubes).toBe(2);
    expect(w.phase).toBe('ended');
    expect(w.winnerId).toBe('a');
  });
});

describe('bush stealth (4-1)', () => {
  const setup = () => {
    const { w, fa, fb } = duel('luna', 'toto', 10);
    const i = 0;
    w.bushStates[i].alive = true; w.bushStates[i].regrowAt = -1e9;
    const b = w.map.bushes[i];
    fb.x = b.x; fb.y = b.y; fa.x = b.x - 10; fa.y = b.y;
    w.step(DT);
    return { w, fa, fb, b };
  };
  it('hides a fighter inside a bush, reveals within 2.5m', () => {
    const { w, fa, fb, b } = setup();
    expect(fb.inBush).toBeGreaterThanOrEqual(0);
    expect(isVisibleTo(fa, fb, w.time)).toBe(false);
    fa.x = b.x - 2; w.step(DT);
    expect(isVisibleTo(fa, fb, w.time)).toBe(true);
  });
  it('reveals for 1s after attacking and 0.8s after being hit', () => {
    const { w, fa, fb } = setup();
    w.setInput('b', { ...emptyInput(), aimX: 0, aimY: 1, fire: true });
    w.step(DT); w.setInput('b', emptyInput());
    expect(isVisibleTo(fa, fb, w.time)).toBe(true);
    for (let i = 0; i < 70; i++) w.step(DT);
    expect(isVisibleTo(fa, fb, w.time)).toBe(false);
    w.damageFighter(fb, fa, 10, { x: fa.x, y: fa.y, originCluster: -1, isSuper: false, kind: 'test' });
    expect(isVisibleTo(fa, fb, w.time)).toBe(true);
    for (let i = 0; i < 55; i++) w.step(DT);
    expect(isVisibleTo(fa, fb, w.time)).toBe(false);
  });
  it('reduces damage from outside by 30%', () => {
    const { w, fa, fb } = setup();
    const hp = fb.hp;
    w.damageFighter(fb, fa, 1000, { x: fa.x, y: fa.y, originCluster: -1, isSuper: false, kind: 'test' });
    expect(hp - fb.hp).toBe(Math.round(1000 * BUSH.coverMul));
    const hp2 = fb.hp;
    w.damageFighter(fb, fa, 1000, { x: fa.x, y: fa.y, originCluster: fb.inBush, isSuper: false, kind: 'test' });
    expect(hp2 - fb.hp).toBe(1000);
  });
  it('clusters touching bushes', () => {
    const bs: BushDef[] = [
      { id: 0, x: 0, y: 0, r: 1, cluster: -1 }, { id: 1, x: 2.5, y: 0, r: 1, cluster: -1 }, { id: 2, x: 20, y: 0, r: 1, cluster: -1 },
    ];
    expect(clusterBushes(bs)).toBe(2);
    expect(bs[0].cluster).toBe(bs[1].cluster);
    expect(bs[2].cluster).not.toBe(bs[0].cluster);
  });
  it('destroyed bushes regrow after 20s and cannot hide while growing', () => {
    const { w, fb } = setup();
    const s = w.bushStates[0];
    s.alive = false; s.destroyedAt = w.time; s.regrowAt = w.time + BUSH.regrowMs;
    w.step(DT);
    expect(fb.inBush).toBe(-1);
    for (let i = 0; i < 60 * 20.5; i++) w.step(DT);
    expect(s.alive).toBe(true);
    expect(fb.inBush).toBe(-1); // still growing
    for (let i = 0; i < 60 * 2.2; i++) w.step(DT);
    expect(fb.inBush).toBeGreaterThanOrEqual(0);
  });
});

describe('full bot match', () => {
  it('8 bots finish a match with poison in reasonable time', () => {
    const players: PlayerSlot[] = CHARACTERS.concat(CHARACTERS.slice(0, 2)).map((c, i) => ({ id: 'b' + i, name: 'Bot' + i, charId: c.id, isBot: true, difficulty: 1 }));
    const w = new World(buildMeadow(), { mode: 'ffa', durationMs: 180000, seed: 11, players, poison: true, mapEvents: true, countdownMs: 0 });
    let steps = 0;
    while (w.phase !== 'ended' && steps < 60 * 200) { w.step(DT); w.drainEvents(); steps++; }
    expect(w.phase).toBe('ended');
    expect(w.ranking.map((r) => r.place).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(w.stats.kills).toBeGreaterThanOrEqual(3);
    expect(w.stats.superUses).toBeGreaterThan(0);
  });
});
