/** Score rules (기획서 프롬프트 9 + 11-2). Always computed by the simulation, never by the client UI. */
export const SCORE = {
  kill: 100,
  assist: 40,
  perDamage: 0.05,
  double: 50,
  triple: 100,
  bounty: 150,
};

const PLACEMENT = [0, 300, 200, 120, 80, 60, 40, 20, 10];
export const placementBonus = (place: number) => PLACEMENT[place] ?? 0;

/** Trophy delta per placement (8-player showdown). */
const TROPHIES = [0, 10, 8, 6, 4, 2, 0, -1, -2];
export const trophyDelta = (place: number) => TROPHIES[place] ?? 0;

/** Account XP earned from a match. */
export const xpFor = (place: number, kills: number) => 20 + Math.max(0, 9 - place) * 6 + kills * 10;

export const levelXp = (level: number) => 100 + (level - 1) * 40;
