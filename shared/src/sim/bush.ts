import type { BushDef, BushState, Fighter } from './types';

/** Bush stealth rules (기획서 4-1). */
export const BUSH = {
  linkGap: 1.0,             // bushes whose edges are within 1m join one cluster
  coverMul: 0.7,            // damage taken while hidden, shot from outside the cluster
  rangeLossPerMeter: 0.05,  // fraction of max range lost per metre travelled inside bushes
  revealAfterAttackMs: 1000,
  revealAfterHitMs: 800,
  revealDistance: 2.5,
  ambushAfterMs: 500,
  ambushMul: 1.15,
  speedMul: 0.9,
  regrowMs: 20000,
  growDurationMs: 2000,
};

/** Union-Find clustering; writes `cluster` on each bush and returns the cluster count. */
export function clusterBushes(bushes: BushDef[]): number {
  const parent = bushes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < bushes.length; i++) {
    for (let j = i + 1; j < bushes.length; j++) {
      const a = bushes[i], b = bushes[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r + BUSH.linkGap) parent[find(i)] = find(j);
    }
  }
  const ids = new Map<number, number>();
  bushes.forEach((b, i) => {
    const root = find(i);
    if (!ids.has(root)) ids.set(root, ids.size);
    b.cluster = ids.get(root)!;
  });
  return ids.size;
}

/** A bush can hide someone only when fully grown and not withered by the poison. */
export function bushHides(s: BushState, now: number) {
  return s.alive && !s.withered && now >= s.regrowAt + BUSH.growDurationMs;
}

export function isRevealed(f: Fighter, now: number) {
  return now < f.revealedUntil;
}

/** Can `viewer` see `target`? Used for rendering, auto-aim, bots and network interest filtering. */
export function isVisibleTo(viewer: Fighter | null, target: Fighter, now: number): boolean {
  if (!target.alive) return false;
  if (!viewer || viewer.id === target.id) return true;
  if (target.inBush < 0) return true;
  if (isRevealed(target, now)) return true;
  if (viewer.inBush >= 0 && viewer.inBush === target.inBush) return true;
  return Math.hypot(viewer.x - target.x, viewer.y - target.y) <= BUSH.revealDistance;
}

/** Damage multiplier from bush cover. `originCluster` = cluster the shot was fired from (-1 outside). */
export function coverMultiplier(target: Fighter, originCluster: number) {
  if (target.inBush < 0) return 1;
  return originCluster === target.inBush ? 1 : BUSH.coverMul;
}

export function canAmbush(f: Fighter, now: number) {
  return f.inBush >= 0 && now - f.hiddenSince >= BUSH.ambushAfterMs && now - f.lastAttackAt >= BUSH.revealAfterAttackMs + BUSH.ambushAfterMs;
}
