import { z } from 'zod';
import { CHARACTERS, weaponOf, type CharacterDef } from './characters';
import { WEAPONS, SUPERS, GADGETS, type WeaponDef } from './weapons';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const WeaponSchema = z.object({
  id: z.string(), damage: z.number().positive(), fireIntervalMs: z.number().min(100),
  projectileSpeed: z.number().positive(), range: z.number().min(3).max(40), spreadDeg: z.number().min(0).max(90),
  pelletCount: z.number().int().min(1), burstCount: z.number().int().min(1), ammoMax: z.literal(3),
  reloadMs: z.number().min(500), superChargePerHit: z.number().positive().max(100),
  projectileType: z.enum(['bullet', 'pellet', 'arc', 'arrow', 'boomerang', 'bubble']),
}).passthrough();

export const SuperSchema = z.object({
  id: z.string(), damageMultiplier: z.number().positive(), radius: z.number().min(0),
  terrainDamage: z.number().positive(), durationMs: z.number().min(0), knockback: z.number().min(0),
}).passthrough();

export const CharacterSchema = z.object({
  id: z.string(), displayName: z.string(), hp: z.number().min(1500).max(6000),
  moveSpeed: z.number().min(3).max(7), hitboxRadius: z.number().min(0.3).max(1),
  weaponId: z.string().refine((id) => id in WEAPONS, 'unknown weapon'),
  superId: z.string().refine((id) => id in SUPERS, 'unknown super'),
  gadgetId: z.string().refine((id) => id in GADGETS, 'unknown gadget'),
  colorPalette: z.array(hex).min(3).max(4),
}).passthrough();

export function validateData() {
  Object.values(WEAPONS).forEach((w) => WeaponSchema.parse(w));
  Object.values(SUPERS).forEach((s) => SuperSchema.parse(s));
  CHARACTERS.forEach((c) => CharacterSchema.parse(c));
}

/** Damage of one full attack if every projectile lands (arrow at mid range). */
export function attackDamage(w: WeaponDef) {
  let per = w.damage;
  if (w.maxRangeDamageMul) per *= (1 + w.maxRangeDamageMul) / 2;
  const passes = w.projectileType === 'boomerang' ? 2 : 1;
  return per * w.pelletCount * w.burstCount * passes;
}

/**
 * Time to kill `targetHp` with expected accuracy `hitRate`, starting with a full magazine.
 * Simulates the 3-slot sequential reload in 10ms steps.
 */
export function timeToKill(w: WeaponDef, targetHp: number, hitRate = w.hitRate) {
  const perAttack = attackDamage(w) * hitRate;
  let hp = targetHp, t = 0, ammo = w.ammoMax, reload = 0, cd = 0;
  const step = 10;
  while (hp > 0 && t < 60000) {
    if (cd <= 0 && ammo >= 1) {
      ammo -= 1; cd = w.fireIntervalMs;
      hp -= perAttack;
      if (hp <= 0) break;
    }
    t += step; cd -= step;
    if (ammo < w.ammoMax) { reload += step; if (reload >= w.reloadMs) { reload = 0; ammo += 1; } }
  }
  // attacks are not instantaneous: add flight time to mid range
  return (t + ((w.range * 0.6) / w.projectileSpeed) * 1000) / 1000;
}

/** Sustained DPS once the magazine is empty (reload-bound), with perfect accuracy. */
export function sustainedDps(w: WeaponDef) {
  return attackDamage(w) / (Math.max(w.reloadMs, w.fireIntervalMs) / 1000);
}

export function attacksPerSuper(w: WeaponDef) {
  const projectiles = w.pelletCount * w.burstCount * (w.projectileType === 'boomerang' ? 2 : 1);
  return 100 / (w.superChargePerHit * projectiles);
}

export function averageHp() {
  return CHARACTERS.reduce((s, c) => s + c.hp, 0) / CHARACTERS.length;
}

export interface BalanceRow { id: string; name: string; hp: number; dps: number; ttk: number; attacksPerSuper: number }

export function balanceReport(): BalanceRow[] {
  const hp = averageHp();
  return CHARACTERS.map((c: CharacterDef) => {
    const w = weaponOf(c);
    return {
      id: c.id, name: c.displayName, hp: c.hp,
      dps: Math.round(sustainedDps(w)),
      ttk: +timeToKill(w, hp).toFixed(2),
      attacksPerSuper: +attacksPerSuper(w).toFixed(2),
    };
  });
}

/** Radar-chart stats normalised 0..1 for the character select screen. */
export function radarStats(c: CharacterDef) {
  const w = weaponOf(c);
  return {
    hp: (c.hp - 2000) / 2400,
    damage: Math.min(1, attackDamage(w) / 3000),
    range: Math.min(1, w.range / 25),
    speed: (c.moveSpeed - 4) / 1.7,
    control: ({ arc: 0.8, bubble: 1, boomerang: 0.7, pellet: 0.5, bullet: 0.4, arrow: 0.3 } as const)[w.projectileType],
  };
}
