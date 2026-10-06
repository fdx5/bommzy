export type ProjectileType = 'bullet' | 'pellet' | 'arc' | 'arrow' | 'boomerang' | 'bubble';
export type AimShape = 'line' | 'cone' | 'arc';

export interface StatusEffect { type: 'slow'; durationMs: number; amount: number }

export interface WeaponDef {
  id: string;
  name: string;
  nameEn: string;
  desc: string;
  damage: number;            // per projectile
  fireIntervalMs: number;    // minimum gap between attacks
  projectileSpeed: number;   // m/s (arc: horizontal speed used to derive flight time)
  range: number;             // m
  spreadDeg: number;         // total cone for pellets / random jitter for bursts
  pelletCount: number;       // projectiles per shot
  burstCount: number;        // shots per attack (따발총 6연발)
  burstIntervalMs: number;
  ammoMax: number;           // 3칸 탄창
  reloadMs: number;          // per slot, sequential
  projectileType: ProjectileType;
  projectileRadius: number;
  superChargePerHit: number; // % per projectile hit at base damage
  hitRate: number;           // expected accuracy for balance reports
  aim: AimShape;
  splashRadius?: number;
  maxRangeDamageMul?: number; // arrow: damage scales 1 → mul by travelled distance
  statusEffect?: StatusEffect;
}

export type SuperKind = 'gatling' | 'bigbang' | 'megabomb' | 'meteor' | 'tornado' | 'prison';

export interface SuperDef {
  id: string;
  kind: SuperKind;
  name: string;
  nameEn: string;
  desc: string;
  damageMultiplier: number;
  radius: number;
  terrainDamage: number;     // rock hp is 100; >=100 destroys outright
  durationMs: number;
  knockback: number;         // m
  range: number;
  aim: AimShape;
}

export type GadgetKind = 'shield' | 'dash' | 'heal' | 'ink';

export interface GadgetDef {
  id: string;
  kind: GadgetKind;
  name: string;
  nameEn: string;
  desc: string;
  value: number;       // shield: dmg reduction, dash: metres, heal: hp, ink: slow amount
  durationMs: number;
  radius?: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  gatling: {
    id: 'gatling', name: '따발총', nameEn: 'Chatter Gun', desc: '짧은 간격 6연발, 약간의 탄퍼짐',
    damage: 190, fireIntervalMs: 480, projectileSpeed: 34, range: 17, spreadDeg: 6, pelletCount: 1,
    burstCount: 6, burstIntervalMs: 70, ammoMax: 3, reloadMs: 1200, projectileType: 'bullet',
    projectileRadius: 0.16, superChargePerHit: 100 / 30, hitRate: 0.65, aim: 'line',
  },
  shotgun: {
    id: 'shotgun', name: '샷건', nameEn: 'Shotgun', desc: '부채꼴 5펠릿, 근거리 고데미지',
    damage: 262, fireIntervalMs: 650, projectileSpeed: 30, range: 9.5, spreadDeg: 34, pelletCount: 5,
    burstCount: 1, burstIntervalMs: 0, ammoMax: 3, reloadMs: 1600, projectileType: 'pellet',
    projectileRadius: 0.2, superChargePerHit: 100 / 25, hitRate: 0.55, aim: 'cone',
  },
  grenade: {
    id: 'grenade', name: '수류탄', nameEn: 'Grenade', desc: '포물선 투척, 벽 너머 범위 피해',
    damage: 1080, fireIntervalMs: 650, projectileSpeed: 15, range: 13, spreadDeg: 0, pelletCount: 1,
    burstCount: 1, burstIntervalMs: 0, ammoMax: 3, reloadMs: 1700, projectileType: 'arc',
    projectileRadius: 0.3, superChargePerHit: 20, hitRate: 0.6, aim: 'arc', splashRadius: 2.1,
  },
  crossbow: {
    id: 'crossbow', name: '석궁 저격', nameEn: 'Star Crossbow', desc: '긴 사거리 단발, 멀수록 강해짐',
    damage: 950, fireIntervalMs: 550, projectileSpeed: 36, range: 25, spreadDeg: 0, pelletCount: 1,
    burstCount: 1, burstIntervalMs: 0, ammoMax: 3, reloadMs: 1800, projectileType: 'arrow',
    projectileRadius: 0.22, superChargePerHit: 20, hitRate: 0.55, aim: 'line', maxRangeDamageMul: 1.6,
  },
  boomerang: {
    id: 'boomerang', name: '부메랑', nameEn: 'Boomerang', desc: '되돌아오며 왕복 2회 판정, 관통',
    damage: 560, fireIntervalMs: 550, projectileSpeed: 19, range: 12, spreadDeg: 0, pelletCount: 1,
    burstCount: 1, burstIntervalMs: 0, ammoMax: 3, reloadMs: 1600, projectileType: 'boomerang',
    projectileRadius: 0.45, superChargePerHit: 10, hitRate: 0.7, aim: 'line',
  },
  bubble: {
    id: 'bubble', name: '버블건', nameEn: 'Bubble Gun', desc: '느린 버블 3발, 적중 시 둔화',
    damage: 470, fireIntervalMs: 600, projectileSpeed: 12.5, range: 14, spreadDeg: 22, pelletCount: 3,
    burstCount: 1, burstIntervalMs: 0, ammoMax: 3, reloadMs: 1600, projectileType: 'bubble',
    projectileRadius: 0.38, superChargePerHit: 100 / 15, hitRate: 0.55, aim: 'cone',
    statusEffect: { type: 'slow', durationMs: 800, amount: 0.35 },
  },
};

export const SUPERS: Record<string, SuperDef> = {
  honeyGatling: {
    id: 'honeyGatling', kind: 'gatling', name: '허니 개틀링', nameEn: 'Honey Gatling',
    desc: '2초간 20연발! 탄당 데미지 +60%, 돌을 깎아냄',
    damageMultiplier: 1.6, radius: 0, terrainDamage: 34, durationMs: 2000, knockback: 0.35, range: 19, aim: 'line',
  },
  bigBang: {
    id: 'bigBang', kind: 'bigbang', name: '빅뱅 샷', nameEn: 'Big Bang Shot',
    desc: '광역 산탄 + 넉백 3m, 부채꼴 범위 돌 즉시 파괴',
    damageMultiplier: 1.5, radius: 0, terrainDamage: 999, durationMs: 0, knockback: 3, range: 9, aim: 'cone',
  },
  megaBomb: {
    id: 'megaBomb', kind: 'megabomb', name: '메가 펭귄 폭탄', nameEn: 'Mega Penguin Bomb',
    desc: '반경 4m 대폭발, 데미지 2.5배, 돌·수풀 파괴',
    damageMultiplier: 2.5, radius: 4, terrainDamage: 999, durationMs: 0, knockback: 1.5, range: 14, aim: 'arc',
  },
  meteorArrow: {
    id: 'meteorArrow', kind: 'meteor', name: '유성 관통 화살', nameEn: 'Meteor Arrow',
    desc: '맵 끝까지 꿰뚫는 별빛 화살, 경로의 돌 전부 파괴',
    damageMultiplier: 1.9, radius: 0.5, terrainDamage: 999, durationMs: 0, knockback: 0.8, range: 120, aim: 'line',
  },
  tornado: {
    id: 'tornado', kind: 'tornado', name: '회오리 부메랑', nameEn: 'Tornado Rang',
    desc: '거대 부메랑이 3초간 주위를 회전, 수풀·돌 제거',
    damageMultiplier: 0.75, radius: 3.2, terrainDamage: 999, durationMs: 3000, knockback: 0.6, range: 0, aim: 'line',
  },
  bubblePrison: {
    id: 'bubblePrison', kind: 'prison', name: '버블 감옥', nameEn: 'Bubble Prison',
    desc: '범위 내 적을 1.5초 가둔 뒤 펑! 주변 돌 파괴',
    damageMultiplier: 2.8, radius: 3.4, terrainDamage: 999, durationMs: 1500, knockback: 1, range: 13, aim: 'arc',
  },
};

export const GADGETS: Record<string, GadgetDef> = {
  honeyShield: { id: 'honeyShield', kind: 'shield', name: '꿀 방패', nameEn: 'Honey Shield', desc: '2.5초간 받는 피해 50% 감소', value: 0.5, durationMs: 2500 },
  bullRush: { id: 'bullRush', kind: 'dash', name: '불도저 돌진', nameEn: 'Bull Rush', desc: '이동 방향으로 5m 돌진', value: 5, durationMs: 220 },
  iceSlide: { id: 'iceSlide', kind: 'dash', name: '얼음 미끄럼', nameEn: 'Ice Slide', desc: '배로 미끄러지며 6m 이동', value: 6, durationMs: 300 },
  starDash: { id: 'starDash', kind: 'dash', name: '순간 대시', nameEn: 'Star Dash', desc: '별빛과 함께 5m 순간 이동', value: 5, durationMs: 120 },
  bananaSnack: { id: 'bananaSnack', kind: 'heal', name: '바나나 간식', nameEn: 'Banana Snack', desc: '즉시 체력 1100 회복', value: 1100, durationMs: 0 },
  inkCloud: { id: 'inkCloud', kind: 'ink', name: '먹물 구름', nameEn: 'Ink Cloud', desc: '주변 4m 적을 2초간 둔화', value: 0.45, durationMs: 2000, radius: 4 },
};
