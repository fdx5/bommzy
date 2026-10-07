import type { Vec2 } from '../math';
import type { CharacterId } from '../data/characters';
import type { ProjectileType, StatusEffect, SuperKind } from '../data/weapons';

export type ObstacleType = 'tree' | 'rock' | 'crate' | 'water';

export interface Obstacle {
  id: number;
  type: ObstacleType;
  variant: number;
  x: number; y: number;
  rot: number;
  scale: number;
  shape: 'circle' | 'box';
  r: number;          // circle radius
  hw: number; hh: number; // box half extents
  blocksMove: boolean;
  blocksShots: boolean;
  destructible: boolean;
  hp: number;
  maxHp: number;
  alive: boolean;
  cubes: number;      // crates: cubes dropped
}

export interface BushDef { id: number; x: number; y: number; r: number; cluster: number }

/** Slippery ice: movement keeps momentum (slow to accelerate and to stop). */
export interface SlipZone { x: number; y: number; r: number }

export interface MapData {
  id: string;
  name: string;
  theme: string;
  slipZones: SlipZone[];
  half: number;
  spawns: Vec2[];
  obstacles: Obstacle[];
  bushes: BushDef[];
}

export interface PlayerInput {
  moveX: number; moveY: number;
  aimX: number; aimY: number;   // aim direction
  aimDist: number;              // for arc weapons (m); <=0 → max range
  fire: boolean;
  superFire: boolean;
  gadget: boolean;
  autoAim: boolean;             // tap-to-fire: the sim picks the target
  seq: number;
}

export const emptyInput = (): PlayerInput => ({
  moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimDist: 0, fire: false, superFire: false, gadget: false, autoAim: false, seq: 0,
});

export interface PlayerSlot {
  id: string;
  name: string;
  charId: CharacterId;
  skin?: string;
  isBot: boolean;
  difficulty?: 0 | 1 | 2;
  passive?: boolean; // tutorial dummy
}

export interface Fighter {
  id: string;
  slot: number;
  name: string;
  charId: CharacterId;
  skin: string;
  isBot: boolean;
  x: number; y: number; px: number; py: number;
  vx: number; vy: number;
  kbx: number; kby: number;
  aimAngle: number;
  moveAngle: number;
  hp: number; baseHp: number; maxHp: number;
  alive: boolean;
  retiredAt: number;
  killedBy: string | null;
  place: number;
  // weapon
  ammo: number;
  reloadT: number;
  fireCd: number;
  fireBufferUntil: number;
  burstLeft: number;
  burstT: number;
  burstAngle: number;
  lastAttackAt: number;
  superCharge: number;     // 0..1
  superStock: number;      // extra supers banked from super pickups (on top of a full gauge)
  superUntil: number;      // gatling / tornado active window
  superNextShot: number;
  superKind: SuperKind | null;
  tornadoHits: Record<string, number>;
  // gadget
  gadgetUses: number;
  gadgetCd: number;
  /** ms of progress toward the next gadget charge */
  gadgetRecharge: number;
  shieldUntil: number;
  dashUntil: number; dashVx: number; dashVy: number;
  /** tiger pounce: lands (and slams) at this time; 0 = not pouncing */
  pounceAt: number; pounceDmg: number; pounceX: number; pounceY: number;
  // status
  slowUntil: number; slowAmount: number;
  stunUntil: number;
  lastCombatAt: number;
  lastHitAt: number;
  attackers: Record<string, number>;
  // bush
  inBush: number;          // cluster id or -1
  hiddenSince: number;
  revealedUntil: number;
  // progression
  cubes: number;
  kills: number;
  assists: number;
  damageDealt: number;
  bonusScore: number;
  streak: number;
  score: number;
  poisonAcc: number;
  poisonTick: number;
  superUses: number;
  bushKills: number;
  emote: number; emoteAt: number;
}

export interface Projectile {
  id: number;
  ownerId: string;
  kind: ProjectileType | 'meteor';
  x: number; y: number; px: number; py: number; z: number;
  vx: number; vy: number;
  damage: number;
  radius: number;
  rangeLeft: number;
  maxRange: number;
  traveled: number;
  isSuper: boolean;
  superKind: SuperKind | null;
  terrainDamage: number;
  knockback: number;
  pierce: boolean;
  hit: string[];
  hitBack: string[];
  originCluster: number;
  ambush: boolean;
  dead: boolean;
  status?: StatusEffect;
  rangeMul?: number;
  // arc
  sx: number; sy: number; tx: number; ty: number; t: number; flightMs: number; splash: number;
  // boomerang
  returning: boolean;
  spin: number;
}

export interface Zone {
  id: number;
  kind: 'prison' | 'supply' | 'ink';
  x: number; y: number; r: number;
  start: number; until: number;
  ownerId: string;
  targets: string[];
  done: boolean;
}

export type PickupKind = 'cube' | 'heal' | 'super';
export interface Pickup { id: number; kind: PickupKind; x: number; y: number; spawnAt: number; taken: boolean }

export interface BushState { alive: boolean; destroyedAt: number; regrowAt: number; withered: boolean }

export type MapEventKind = 'flowers' | 'supply' | 'wind';

export type GameEvent =
  | { type: 'countdown'; n: number }
  | { type: 'start' }
  | { type: 'fire'; id: string; x: number; y: number; angle: number; kind: string; isSuper: boolean }
  | { type: 'shot'; id: string; x: number; y: number; angle: number; kind: string; isSuper: boolean }
  | { type: 'superStart'; id: string; kind: SuperKind; x: number; y: number; angle: number }
  | { type: 'hit'; target: string; attacker: string | null; amount: number; x: number; y: number; crit: boolean; isSuper: boolean; covered: boolean; kind: string; nx: number; ny: number; shield: boolean }
  | { type: 'heal'; target: string; amount: number; x: number; y: number }
  | { type: 'kill'; killer: string | null; victim: string; place: number; bounty: boolean; inBush: boolean }
  | { type: 'streak'; id: string; n: number }
  | { type: 'explode'; x: number; y: number; r: number; kind: string; ownerId: string }
  | { type: 'obstacleHit'; id: number; x: number; y: number }
  | { type: 'obstacleSpawn'; id: number }
  | { type: 'obstacleDestroyed'; id: number; x: number; y: number; otype: ObstacleType }
  | { type: 'bushDestroyed'; id: number }
  | { type: 'bushRegrow'; id: number }
  | { type: 'pickup'; id: string; pickupId: number; kind: PickupKind; x: number; y: number; stock?: number }
  | { type: 'pickupSpawn'; pickupId: number; kind: PickupKind; x: number; y: number }
  | { type: 'superReady'; id: string }
  | { type: 'gadget'; id: string; kind: string; x: number; y: number }
  | { type: 'gadgetReady'; id: string; uses: number }
  | { type: 'hide'; id: string; x: number; y: number }
  | { type: 'unhide'; id: string; x: number; y: number }
  | { type: 'reveal'; id: string }
  | { type: 'reload'; id: string }
  | { type: 'dry'; id: string }
  | { type: 'boomerangBack'; id: number }
  | { type: 'eventAnnounce'; kind: MapEventKind; x: number; y: number; at: number }
  | { type: 'eventStart'; kind: MapEventKind; x: number; y: number }
  | { type: 'eventEnd'; kind: MapEventKind }
  | { type: 'poisonStart' }
  | { type: 'zoneStart'; zoneId: number; kind: Zone['kind']; x: number; y: number; r: number }
  | { type: 'emote'; id: string; emote: number }
  | { type: 'crown'; id: string | null }
  | { type: 'end'; winner: string | null };
