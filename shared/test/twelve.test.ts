import { describe, expect, it } from 'vitest';
import { MATCH_PLAYER_COUNT, RULES, CHARACTERS, buildMap, World, placementBonus, trophyDelta, xpFor, type PlayerSlot } from '../src';

describe('12-player showdown', () => {
  it('uses the same capacity for simulation and map spawns', () => {
    expect(MATCH_PLAYER_COUNT).toBe(12); expect(RULES.playerCount).toBe(12);
    const map = buildMap();
    const players: PlayerSlot[] = Array.from({ length: MATCH_PLAYER_COUNT }, (_, i) => ({ id: `p${i}`, name: `p${i}`, charId: CHARACTERS[i % CHARACTERS.length].id, isBot: i !== 0 }));
    const w = new World(map, { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 1, players, poison: false, mapEvents: false, countdownMs: 0 });
    expect(w.fighters).toHaveLength(12); expect(w.bots.size).toBe(11); expect(w.aliveCount).toBe(12);
    for (const [i, f] of w.fighters.entries()) {
      expect({ x: f.x, y: f.y }).toEqual(map.spawns[i]);
      for (const other of w.fighters.slice(i + 1)) expect(Math.hypot(f.x - other.x, f.y - other.y)).toBeGreaterThan(15);
    }
  });
  it('awards defined and decreasing placement points and XP through rank 12', () => {
    for (let place = 1; place <= MATCH_PLAYER_COUNT; place++) {
      expect(placementBonus(place)).toBeGreaterThan(0);
      expect(xpFor(place, 0)).toBeGreaterThanOrEqual(20);
      if (place > 1) {
        expect(placementBonus(place)).toBeLessThan(placementBonus(place - 1));
        expect(xpFor(place, 0)).toBeLessThan(xpFor(place - 1, 0));
        expect(trophyDelta(place)).toBeLessThanOrEqual(trophyDelta(place - 1));
      }
    }
    expect(trophyDelta(9)).toBe(-3); expect(trophyDelta(12)).toBe(-6);
  });
});
