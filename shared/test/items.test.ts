import { describe, it, expect } from 'vitest';
import { ITEMS, ITEM_BY_ID, ITEM_KINDS, SLOT_OF, goldReward } from '../src';

describe('shop catalogue', () => {
  it('has 10 items per kind (8 kinds = 80) with unique ids', () => {
    expect(ITEMS).toHaveLength(80);
    for (const k of ITEM_KINDS) expect(ITEMS.filter((i) => i.kind === k)).toHaveLength(10);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(80);
  });
  it('prices range from 1,000 to 100,000 gold and slots match kinds', () => {
    expect(Math.min(...ITEMS.map((i) => i.price))).toBe(1000);
    expect(Math.max(...ITEMS.map((i) => i.price))).toBe(100000);
    for (const i of ITEMS) { expect(i.price).toBeGreaterThanOrEqual(1000); expect(i.price).toBeLessThanOrEqual(100000); expect(i.slot).toBe(SLOT_OF[i.kind]); }
    expect(ITEM_BY_ID.glasses_round.slot).toBe(ITEM_BY_ID.sunglasses_black.slot); // eyewear shares one slot
  });
  it('rewards top 3 with their score in gold', () => {
    expect(goldReward(1, 1234)).toBe(1234);
    expect(goldReward(3, 500)).toBe(500);
    expect(goldReward(4, 900)).toBe(0);
  });
});
