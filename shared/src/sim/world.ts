import { CHAR_BY_ID, weaponOf, superOf, gadgetOf, type CharacterDef } from '../data/characters';
import type { WeaponDef } from '../data/weapons';
import { clamp, segCircle, segAABB, RNG, wrapAngle, DEG, type Vec2 } from '../math';
import { SpatialGrid } from './grid';
import { NavGrid } from './nav';
import { BUSH, bushHides, canAmbush, coverMultiplier, isVisibleTo } from './bush';
import { Bot } from './bot';
import { SCORE, placementBonus } from './scoring';
import {
  emptyInput, type BushDef, type BushState, type Fighter, type GameEvent, type MapData, type MapEventKind,
  type Obstacle, type Pickup, type PlayerInput, type PlayerSlot, type Projectile, type Zone,
} from './types';

export interface MatchConfig {
  mode: 'ffa' | 'tutorial';
  durationMs: number;
  seed: number;
  players: PlayerSlot[];
  poison: boolean;
  mapEvents: boolean;
  countdownMs: number;
}

export const RULES = {
  regenDelayMs: 3000,
  regenPerSec: 0.13,
  inputBufferMs: 100,
  cubeBonus: 0.1,
  killSuperBonus: 0.25,
  poisonStartMs: 90000,
  poisonEndMs: 165000,
  poisonFrom: 58,
  poisonTo: 7,
  poisonDps: 520,
  /** few survivors left: the cloud starts early and closes faster so the endgame can't stall */
  poisonEarlyMs: 60000,
  poisonEarlyRadius: 42,
  poisonFinal: 2,
  gadgetUses: 3,
  gadgetCooldownMs: 5000,
  assistWindowMs: 5000,
  crateHp: 2600,
  supplyHp: 3600,
  healFlower: 1200,
  accelTime: 0.08,
  decelTime: 0.05,
  iceAccelTime: 0.55,
  iceDecelTime: 1.1,
  iceSpeedMul: 1.12,
};

export interface Ranking { id: string; name: string; charId: string; place: number; score: number; kills: number; assists: number; damage: number; isBot: boolean; cubes: number }

export class World {
  time = 0;
  phase: 'countdown' | 'playing' | 'ended' = 'countdown';
  readonly fighters: Fighter[] = [];
  readonly byId = new Map<string, Fighter>();
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  pickups: Pickup[] = [];
  readonly bushStates: BushState[];
  readonly obstacleGrid: SpatialGrid<Obstacle>;
  readonly bushGrid: SpatialGrid<BushDef>;
  readonly nav: NavGrid;
  events: GameEvent[] = [];
  readonly rng: RNG;
  readonly bots = new Map<string, Bot>();
  private inputs = new Map<string, PlayerInput>();
  private nextId = 1;
  poisonRadius: number;
  poisonActive = false;
  /** 0→1 main shrink (poisonFrom→poisonTo), 1→1.25 final squeeze down to poisonFinal */
  poisonProgress = 0;
  wind = { x: 0, y: 0, until: 0 };
  crownId: string | null = null;
  winnerId: string | null = null;
  ranking: Ranking[] = [];
  private eventPlan: { at: number; kind: MapEventKind; x: number; y: number; announced: boolean; started: boolean }[] = [];
  private lastCountdown = -1;
  stats = { superUses: 0, bushKills: 0, kills: 0 };

  constructor(readonly map: MapData, readonly cfg: MatchConfig) {
    this.rng = new RNG(cfg.seed);
    this.obstacleGrid = new SpatialGrid(map.obstacles, map.half, 4, (o) => Math.max(o.r, o.hw, o.hh));
    this.bushGrid = new SpatialGrid(map.bushes, map.half, 4, (b) => b.r);
    this.bushStates = map.bushes.map(() => ({ alive: true, destroyedAt: -1e9, regrowAt: -1e9, withered: false }));
    this.nav = new NavGrid(map.half, map.obstacles);
    this.poisonRadius = RULES.poisonFrom;

    cfg.players.forEach((slot, i) => {
      const def = CHAR_BY_ID[slot.charId];
      const sp = map.spawns[i % map.spawns.length];
      const f = this.createFighter(slot, i, def, sp);
      this.fighters.push(f);
      this.byId.set(f.id, f);
      this.inputs.set(f.id, emptyInput());
      if (slot.isBot) this.bots.set(f.id, new Bot(f.id, slot.difficulty ?? 1, this.rng.next() * 1000, !!slot.passive));
    });

    if (cfg.mapEvents) {
      const kinds: MapEventKind[] = ['flowers', 'supply', 'wind'];
      for (const at of [55000, 115000]) {
        const kind = kinds.splice(this.rng.int(0, kinds.length - 1), 1)[0];
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(4, 14);
        this.eventPlan.push({ at, kind, x: Math.cos(a) * r, y: Math.sin(a) * r, announced: false, started: false });
      }
    }
    if (cfg.countdownMs <= 0) this.phase = 'playing';
  }

  private createFighter(slot: PlayerSlot, i: number, def: CharacterDef, sp: Vec2): Fighter {
    const face = Math.atan2(-sp.y, -sp.x);
    return {
      id: slot.id, slot: i, name: slot.name, charId: def.id, skin: slot.skin ?? 'default', isBot: slot.isBot,
      x: sp.x, y: sp.y, px: sp.x, py: sp.y, vx: 0, vy: 0, kbx: 0, kby: 0,
      aimAngle: face, moveAngle: face,
      hp: def.hp, baseHp: def.hp, maxHp: def.hp, alive: true, retiredAt: -1, killedBy: null, place: 0,
      ammo: 3, reloadT: 0, fireCd: 0, fireBufferUntil: -1, burstLeft: 0, burstT: 0, burstAngle: 0, lastAttackAt: -1e9,
      superCharge: 0, superUntil: 0, superNextShot: 0, superKind: null, tornadoHits: {},
      gadgetUses: RULES.gadgetUses, gadgetCd: 0, shieldUntil: 0, dashUntil: 0, dashVx: 0, dashVy: 0,
      slowUntil: 0, slowAmount: 0, stunUntil: 0, lastCombatAt: -1e9, lastHitAt: -1e9, attackers: {},
      inBush: -1, hiddenSince: 0, revealedUntil: 0,
      cubes: 0, kills: 0, assists: 0, damageDealt: 0, bonusScore: 0, streak: 0, score: 0,
      poisonAcc: 0, poisonTick: 0, superUses: 0, bushKills: 0, emote: -1, emoteAt: -1e9,
    };
  }

  // ───────────────────────────────────────────── public API
  setInput(id: string, input: PlayerInput) { this.inputs.set(id, input); }
  get aliveCount() { let n = 0; for (const f of this.fighters) if (f.alive) n++; return n; }
  visible(viewerId: string | null, target: Fighter) { return isVisibleTo(viewerId ? this.byId.get(viewerId) ?? null : null, target, this.time); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  weapon(f: Fighter) { return weaponOf(CHAR_BY_ID[f.charId]); }
  dmgMul(f: Fighter) { return 1 + RULES.cubeBonus * f.cubes; }
  emote(id: string, emote: number) {
    const f = this.byId.get(id);
    if (!f || this.time - f.emoteAt < 1500) return;
    f.emote = emote; f.emoteAt = this.time;
    this.events.push({ type: 'emote', id, emote });
  }

  step(dtSec: number) {
    if (this.phase === 'ended') return;
    const dt = dtSec * 1000;
    this.time += dt;

    if (this.phase === 'countdown') {
      const left = Math.ceil((this.cfg.countdownMs - this.time) / 1000);
      if (left !== this.lastCountdown && left > 0) { this.lastCountdown = left; this.events.push({ type: 'countdown', n: left }); }
      if (this.time >= this.cfg.countdownMs) { this.phase = 'playing'; this.time = 0; this.events.push({ type: 'start' }); }
      for (const f of this.fighters) { f.px = f.x; f.py = f.y; }
      return;
    }

    for (const [id, bot] of this.bots) {
      const f = this.byId.get(id)!;
      if (f.alive) this.inputs.set(id, bot.think(this, f, dtSec));
    }
    for (const f of this.fighters) { f.px = f.x; f.py = f.y; }
    for (const f of this.fighters) if (f.alive) this.stepFighter(f, dtSec, this.inputs.get(f.id)!);
    this.separateFighters();
    this.stepProjectiles(dtSec);
    this.stepZones();
    this.stepPickups();
    this.stepBushes();
    this.stepPoison(dtSec);
    this.stepMapEvents();
    this.updateScores();
    this.checkEnd();
  }

  // ───────────────────────────────────────────── fighters
  private stepFighter(f: Fighter, dt: number, inp: PlayerInput) {
    const def = CHAR_BY_ID[f.charId];
    const w = weaponOf(def);
    const now = this.time;
    const stunned = now < f.stunUntil;

    // movement
    let mx = stunned ? 0 : inp.moveX, my = stunned ? 0 : inp.moveY;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const onIce = this.onIce(f.x, f.y);
    let speed = def.moveSpeed;
    if (f.inBush >= 0) speed *= BUSH.speedMul;
    if (now < f.slowUntil) speed *= 1 - f.slowAmount;
    if (f.superKind === 'gatling' && now < f.superUntil) speed *= 0.85;
    if (onIce) speed *= RULES.iceSpeedMul;
    const tx = mx * speed, ty = my * speed;
    // linear approach: full speed within accelTime, full stop within decelTime (ice: long slides)
    const accel = ml > 0.05 ? (onIce ? RULES.iceAccelTime : RULES.accelTime) : onIce ? RULES.iceDecelTime : RULES.decelTime;
    const ddx = tx - f.vx, ddy = ty - f.vy, dl = Math.hypot(ddx, ddy);
    const maxDv = (def.moveSpeed / accel) * dt;
    if (dl <= maxDv) { f.vx = tx; f.vy = ty; } else { f.vx += (ddx / dl) * maxDv; f.vy += (ddy / dl) * maxDv; }
    if (ml > 0.1) f.moveAngle = Math.atan2(my, mx);

    let vx = f.vx, vy = f.vy;
    if (now < f.dashUntil) { vx = f.dashVx; vy = f.dashVy; }
    vx += f.kbx; vy += f.kby;
    const kd = Math.exp(-dt * 10);
    f.kbx *= kd; f.kby *= kd;
    f.x += vx * dt; f.y += vy * dt;
    this.resolveCollisions(f, def.hitboxRadius);

    // aim
    if (!stunned && (Math.abs(inp.aimX) > 1e-3 || Math.abs(inp.aimY) > 1e-3)) f.aimAngle = Math.atan2(inp.aimY, inp.aimX);

    // reload (sequential, one slot at a time)
    if (f.ammo < w.ammoMax) {
      f.reloadT += dt * 1000;
      if (f.reloadT >= w.reloadMs) { f.reloadT -= w.reloadMs; f.ammo = Math.min(w.ammoMax, f.ammo + 1); this.events.push({ type: 'reload', id: f.id }); }
    } else f.reloadT = 0;
    f.fireCd -= dt * 1000;
    f.gadgetCd -= dt * 1000;

    // bursts in flight
    if (f.burstLeft > 0) {
      f.burstT -= dt * 1000;
      while (f.burstLeft > 0 && f.burstT <= 0) {
        this.emitShot(f, w, f.burstAngle, false, inp);
        f.burstLeft--; f.burstT += w.burstIntervalMs;
      }
    }

    // active supers (gatling / tornado)
    if (f.superKind && now < f.superUntil) this.stepActiveSuper(f, w);
    else if (f.superKind) f.superKind = null;

    if (!stunned && this.phase === 'playing') {
      if (inp.fire) f.fireBufferUntil = now + RULES.inputBufferMs;
      const busySuper = f.superKind !== null && now < f.superUntil;
      if (now <= f.fireBufferUntil && f.fireCd <= 0 && f.burstLeft === 0 && !busySuper) {
        if (f.ammo >= 1) {
          let angle = f.aimAngle, distAim = inp.aimDist;
          if (inp.autoAim) { const a = this.autoAim(f, w.range, w.projectileSpeed, w.projectileType === 'arc'); if (a) { angle = a.angle; distAim = a.dist; f.aimAngle = angle; } }
          this.attack(f, w, angle, distAim, inp);
          f.fireBufferUntil = -1;
        } else if (inp.fire && now - f.lastAttackAt > 300) {
          this.events.push({ type: 'dry', id: f.id });
          f.fireBufferUntil = -1;
        }
      }
      if (inp.superFire && f.superCharge >= 1 && !busySuper) {
        let angle = f.aimAngle, distAim = inp.aimDist;
        const sd = superOf(def);
        if (inp.autoAim) { const a = this.autoAim(f, Math.min(sd.range || w.range, 25), w.projectileSpeed, sd.aim === 'arc'); if (a) { angle = a.angle; distAim = a.dist; f.aimAngle = angle; } }
        this.castSuper(f, def, angle, distAim);
      }
      if (inp.gadget && f.gadgetUses > 0 && f.gadgetCd <= 0) this.useGadget(f, def, inp);
    }

    // regen
    if (now - f.lastCombatAt >= RULES.regenDelayMs && f.hp < f.maxHp) {
      const before = f.hp;
      f.hp = Math.min(f.maxHp, f.hp + f.maxHp * RULES.regenPerSec * dt);
      if (Math.floor(before / 400) !== Math.floor(f.hp / 400)) this.events.push({ type: 'heal', target: f.id, amount: Math.round(f.maxHp * RULES.regenPerSec), x: f.x, y: f.y });
    }

    // bush state
    const cl = this.bushAt(f.x, f.y);
    if (cl !== f.inBush) {
      if (cl >= 0 && f.inBush < 0) { f.hiddenSince = now; this.events.push({ type: 'hide', id: f.id, x: f.x, y: f.y }); }
      else if (cl < 0) this.events.push({ type: 'unhide', id: f.id, x: f.x, y: f.y });
      else f.hiddenSince = now;
      f.inBush = cl;
    }
  }

  private resolveCollisions(f: Fighter, r: number) {
    const lim = this.map.half - r - 0.2;
    for (let iter = 0; iter < 2; iter++) {
      this.obstacleGrid.query(f.x - r - 2, f.y - r - 2, f.x + r + 2, f.y + r + 2, (o) => {
        if (!o.alive || !o.blocksMove) return;
        if (o.shape === 'circle') {
          const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy), m = o.r + r;
          if (d < m) {
            const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
            f.x = o.x + nx * m; f.y = o.y + ny * m;
            const vn = f.vx * nx + f.vy * ny; if (vn < 0) { f.vx -= vn * nx; f.vy -= vn * ny; }
          }
        } else {
          const cx = clamp(f.x, o.x - o.hw, o.x + o.hw), cy = clamp(f.y, o.y - o.hh, o.y + o.hh);
          let dx = f.x - cx, dy = f.y - cy, d = Math.hypot(dx, dy);
          if (d < r) {
            if (d < 1e-6) { // centre inside box: push along smallest axis
              const ox = o.hw - Math.abs(f.x - o.x), oy = o.hh - Math.abs(f.y - o.y);
              if (ox < oy) { dx = Math.sign(f.x - o.x) || 1; dy = 0; } else { dx = 0; dy = Math.sign(f.y - o.y) || 1; }
              d = 1; f.x = ox < oy ? o.x + dx * (o.hw + r) : f.x; f.y = ox < oy ? f.y : o.y + dy * (o.hh + r);
              return;
            }
            const nx = dx / d, ny = dy / d;
            f.x = cx + nx * r; f.y = cy + ny * r;
            const vn = f.vx * nx + f.vy * ny; if (vn < 0) { f.vx -= vn * nx; f.vy -= vn * ny; }
          }
        }
      });
    }
    f.x = clamp(f.x, -lim, lim); f.y = clamp(f.y, -lim, lim);
  }

  private separateFighters() {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j]; if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const m = CHAR_BY_ID[a.charId].hitboxRadius + CHAR_BY_ID[b.charId].hitboxRadius;
        if (d < m && d > 1e-6) {
          const push = (m - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }

  onIce(x: number, y: number) {
    for (const z of this.map.slipZones) if ((x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r) return true;
    return false;
  }

  bushAt(x: number, y: number): number {
    let found = -1;
    this.bushGrid.query(x, y, x, y, (b, i) => {
      if (!bushHides(this.bushStates[i], this.time)) return;
      if ((x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r) { found = b.cluster; return true; }
    });
    return found;
  }

  /** Nearest visible enemy (with lead) or crate in range. */
  autoAim(f: Fighter, range: number, speed: number, arc: boolean): { angle: number; dist: number } | null {
    let best: Fighter | null = null, bd = range * 1.08;
    for (const o of this.fighters) {
      if (o === f || !o.alive || !isVisibleTo(f, o, this.time)) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) {
      const t = arc ? 0.75 : bd / speed;
      const tx = best.x + best.vx * t * 0.8, ty = best.y + best.vy * t * 0.8;
      return { angle: Math.atan2(ty - f.y, tx - f.x), dist: Math.min(range, Math.hypot(tx - f.x, ty - f.y)) };
    }
    let crate: Obstacle | null = null; bd = range;
    this.obstacleGrid.query(f.x - range, f.y - range, f.x + range, f.y + range, (o) => {
      if (o.type !== 'crate' || !o.alive) return;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; crate = o; }
    });
    if (crate) { const c = crate as Obstacle; return { angle: Math.atan2(c.y - f.y, c.x - f.x), dist: bd }; }
    return null;
  }

  // ───────────────────────────────────────────── attacks
  private reveal(f: Fighter, ms: number) {
    const was = this.time < f.revealedUntil;
    f.revealedUntil = Math.max(f.revealedUntil, this.time + ms);
    if (!was && f.inBush >= 0) this.events.push({ type: 'reveal', id: f.id });
  }

  private attack(f: Fighter, w: WeaponDef, angle: number, aimDist: number, inp: PlayerInput) {
    const ambush = canAmbush(f, this.time);
    f.ammo -= 1;
    f.fireCd = w.fireIntervalMs;
    f.lastAttackAt = this.time;
    f.lastCombatAt = this.time;
    f.aimAngle = angle;
    this.reveal(f, BUSH.revealAfterAttackMs);
    if (w.burstCount > 1) {
      f.burstAngle = angle;
      this.emitShot(f, w, angle, ambush, inp);
      f.burstLeft = w.burstCount - 1; f.burstT = w.burstIntervalMs;
    } else {
      this.emitShot(f, w, angle, ambush, inp, aimDist);
    }
    this.events.push({ type: 'fire', id: f.id, x: f.x, y: f.y, angle, kind: w.projectileType, isSuper: false });
  }

  private baseProjectile(f: Fighter, kind: Projectile['kind'], angle: number, speed: number, range: number, damage: number, radius: number): Projectile {
    const r = CHAR_BY_ID[f.charId].hitboxRadius * 0.6;
    const x = f.x + Math.cos(angle) * r, y = f.y + Math.sin(angle) * r;
    return {
      id: this.nextId++, ownerId: f.id, kind, x, y, px: x, py: y, z: 0.7,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      damage, radius, rangeLeft: range, maxRange: range, traveled: 0,
      isSuper: false, superKind: null, terrainDamage: 0, knockback: 0, pierce: false,
      hit: [], hitBack: [], originCluster: f.inBush, ambush: false, dead: false,
      sx: x, sy: y, tx: x, ty: y, t: 0, flightMs: 0, splash: 0, returning: false, spin: 0,
    };
  }

  private emitShot(f: Fighter, w: WeaponDef, angle: number, ambush: boolean, _inp: PlayerInput, aimDist = 0) {
    const mul = this.dmgMul(f) * (ambush ? BUSH.ambushMul : 1);
    this.events.push({ type: 'shot', id: f.id, x: f.x, y: f.y, angle, kind: w.projectileType, isSuper: false });
    if (w.projectileType === 'arc') {
      const d = aimDist > 0.5 ? Math.min(aimDist, w.range) : w.range;
      this.spawnArc(f, angle, d, w.damage * mul, w.splashRadius ?? 2, w.projectileSpeed, false, null).ambush = ambush;
      return;
    }
    const n = w.pelletCount;
    for (let i = 0; i < n; i++) {
      let a = angle;
      if (n > 1) a += (i / (n - 1) - 0.5) * w.spreadDeg * DEG;
      else if (w.spreadDeg > 0) a += (this.rng.next() - 0.5) * w.spreadDeg * DEG;
      const kind = w.projectileType;
      const p = this.baseProjectile(f, kind, a, w.projectileSpeed * (n > 1 && kind === 'pellet' ? 1 - Math.abs(i / (n - 1) - 0.5) * 0.15 : 1), w.range, w.damage * mul, w.projectileRadius);
      p.ambush = ambush;
      p.status = w.statusEffect;
      p.pierce = kind === 'boomerang';
      if (w.maxRangeDamageMul) p.rangeMul = w.maxRangeDamageMul;
      this.projectiles.push(p);
    }
  }

  private spawnArc(f: Fighter, angle: number, d: number, damage: number, splash: number, speed: number, isSuper: boolean, kind: Projectile['superKind']) {
    const p = this.baseProjectile(f, 'arc', angle, 0, d, damage, 0.3);
    p.sx = f.x; p.sy = f.y;
    p.tx = clamp(f.x + Math.cos(angle) * d, -this.map.half + 0.5, this.map.half - 0.5);
    p.ty = clamp(f.y + Math.sin(angle) * d, -this.map.half + 0.5, this.map.half - 0.5);
    p.flightMs = clamp((d / speed) * 1000, 450, 1000);
    p.splash = splash; p.isSuper = isSuper; p.superKind = kind;
    this.projectiles.push(p);
    return p;
  }

  private castSuper(f: Fighter, def: CharacterDef, angle: number, aimDist: number) {
    const sd = superOf(def), w = weaponOf(def);
    f.superCharge = 0; f.superUses++; this.stats.superUses++;
    f.lastAttackAt = this.time; f.lastCombatAt = this.time;
    f.aimAngle = angle;
    this.reveal(f, BUSH.revealAfterAttackMs);
    const mul = this.dmgMul(f);
    this.events.push({ type: 'superStart', id: f.id, kind: sd.kind, x: f.x, y: f.y, angle });
    switch (sd.kind) {
      case 'gatling':
        f.superKind = 'gatling'; f.superUntil = this.time + sd.durationMs; f.superNextShot = this.time; break;
      case 'tornado':
        f.superKind = 'tornado'; f.superUntil = this.time + sd.durationMs; f.tornadoHits = {}; break;
      case 'bigbang': {
        const n = 9, spread = 52;
        for (let i = 0; i < n; i++) {
          const a = angle + (i / (n - 1) - 0.5) * spread * DEG;
          const p = this.baseProjectile(f, 'pellet', a, 30, sd.range, w.damage * sd.damageMultiplier * mul, 0.32);
          p.isSuper = true; p.superKind = 'bigbang'; p.terrainDamage = sd.terrainDamage; p.knockback = sd.knockback;
          this.projectiles.push(p);
        }
        // instant cone clear of rocks
        this.forObstaclesInRadius(f.x, f.y, 6.5, (o) => {
          if (o.type !== 'rock') return;
          const da = Math.abs(wrapAngle(Math.atan2(o.y - f.y, o.x - f.x) - angle));
          if (da < (spread / 2 + 8) * DEG) this.damageObstacle(o, 999, true);
        });
        break;
      }
      case 'megabomb': {
        const d = aimDist > 0.5 ? Math.min(aimDist, sd.range) : sd.range;
        const p = this.spawnArc(f, angle, d, w.damage * sd.damageMultiplier * mul, sd.radius, 13, true, 'megabomb');
        p.terrainDamage = sd.terrainDamage; p.knockback = sd.knockback; p.flightMs = 950;
        break;
      }
      case 'prison': {
        const d = aimDist > 0.5 ? Math.min(aimDist, sd.range) : sd.range;
        const p = this.spawnArc(f, angle, d, w.damage * sd.damageMultiplier * mul, sd.radius, 13, true, 'prison');
        p.terrainDamage = sd.terrainDamage; p.flightMs = 800;
        break;
      }
      case 'meteor': {
        const p = this.baseProjectile(f, 'meteor', angle, 55, sd.range, w.damage * sd.damageMultiplier * mul, sd.radius);
        p.isSuper = true; p.superKind = 'meteor'; p.pierce = true; p.terrainDamage = sd.terrainDamage; p.knockback = sd.knockback;
        this.projectiles.push(p);
        break;
      }
    }
    this.events.push({ type: 'fire', id: f.id, x: f.x, y: f.y, angle, kind: sd.kind, isSuper: true });
  }

  private stepActiveSuper(f: Fighter, w: WeaponDef) {
    const def = CHAR_BY_ID[f.charId], sd = superOf(def);
    if (f.superKind === 'gatling') {
      while (this.time >= f.superNextShot && f.superNextShot < f.superUntil) {
        const a = f.aimAngle + (this.rng.next() - 0.5) * 10 * DEG;
        const p = this.baseProjectile(f, 'bullet', a, 34, sd.range, w.damage * sd.damageMultiplier * this.dmgMul(f), 0.22);
        p.isSuper = true; p.superKind = 'gatling'; p.terrainDamage = sd.terrainDamage; p.knockback = sd.knockback;
        this.projectiles.push(p);
        this.events.push({ type: 'shot', id: f.id, x: f.x, y: f.y, angle: a, kind: 'bullet', isSuper: true });
        f.superNextShot += 100;
        f.lastCombatAt = this.time;
        this.reveal(f, BUSH.revealAfterAttackMs);
      }
    } else if (f.superKind === 'tornado') {
      const R = sd.radius;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d <= R + CHAR_BY_ID[o.charId].hitboxRadius && this.time - (f.tornadoHits[o.id] ?? -1e9) >= 500) {
          f.tornadoHits[o.id] = this.time;
          const nx = (o.x - f.x) / (d || 1), ny = (o.y - f.y) / (d || 1);
          this.damageFighter(o, f, w.damage * sd.damageMultiplier * this.dmgMul(f), { x: f.x, y: f.y, originCluster: -1, isSuper: true, kind: 'tornado', knockback: sd.knockback, nx, ny });
        }
      }
      this.forObstaclesInRadius(f.x, f.y, R, (o) => { if (o.type === 'rock') this.damageObstacle(o, 999, true); });
      this.destroyBushesInRadius(f.x, f.y, R);
      f.lastCombatAt = this.time;
      this.reveal(f, 300);
    }
  }

  private useGadget(f: Fighter, def: CharacterDef, inp: PlayerInput) {
    const g = gadgetOf(def);
    f.gadgetUses--; f.gadgetCd = RULES.gadgetCooldownMs;
    switch (g.kind) {
      case 'shield': f.shieldUntil = this.time + g.durationMs; break;
      case 'heal': {
        const amt = Math.min(g.value, f.maxHp - f.hp);
        f.hp += amt;
        this.events.push({ type: 'heal', target: f.id, amount: Math.round(amt), x: f.x, y: f.y });
        break;
      }
      case 'dash': {
        let ax = inp.moveX, ay = inp.moveY;
        if (Math.hypot(ax, ay) < 0.2) { ax = Math.cos(f.aimAngle); ay = Math.sin(f.aimAngle); }
        const l = Math.hypot(ax, ay) || 1;
        const v = g.value / (g.durationMs / 1000);
        f.dashVx = (ax / l) * v; f.dashVy = (ay / l) * v; f.dashUntil = this.time + g.durationMs;
        break;
      }
      case 'ink': {
        for (const o of this.fighters) {
          if (o === f || !o.alive) continue;
          if (Math.hypot(o.x - f.x, o.y - f.y) <= (g.radius ?? 4)) { o.slowUntil = this.time + g.durationMs; o.slowAmount = Math.max(o.slowAmount, g.value); }
        }
        this.zones.push({ id: this.nextId++, kind: 'ink', x: f.x, y: f.y, r: g.radius ?? 4, start: this.time, until: this.time + 600, ownerId: f.id, targets: [], done: true });
        break;
      }
    }
    this.events.push({ type: 'gadget', id: f.id, kind: g.kind, x: f.x, y: f.y });
  }

  // ───────────────────────────────────────────── projectiles
  private stepProjectiles(dt: number) {
    const windOn = this.time < this.wind.until;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.px = p.x; p.py = p.y;
      if (p.kind === 'arc') { this.stepArc(p, dt); continue; }
      if (p.kind === 'boomerang') p.spin += dt * 18;
      if (p.kind === 'boomerang' && p.returning) {
        const o = this.byId.get(p.ownerId);
        if (!o || !o.alive) { p.dead = true; continue; }
        const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
        const sp = Math.hypot(p.vx, p.vy);
        if (d < 0.7) { p.dead = true; continue; }
        p.vx = (dx / d) * sp; p.vy = (dy / d) * sp;
      }
      if (windOn && p.kind !== 'meteor') { p.vx += this.wind.x * dt; p.vy += this.wind.y * dt; }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      const stepLen = Math.hypot(nx - p.x, ny - p.y);
      this.sweep(p, p.x, p.y, nx, ny);
      if (p.dead) continue;
      p.x = nx; p.y = ny;
      p.traveled += stepLen;
      if (!p.returning) {
        p.rangeLeft -= stepLen;
        if (p.kind !== 'meteor' && this.inAnyBush(p.x, p.y)) p.rangeLeft -= stepLen * BUSH.rangeLossPerMeter * p.maxRange;
      }
      if (Math.abs(p.x) > this.map.half + 2 || Math.abs(p.y) > this.map.half + 2) p.dead = true;
      if (p.rangeLeft <= 0) {
        if (p.kind === 'boomerang' && !p.returning) { p.returning = true; this.events.push({ type: 'boomerangBack', id: p.id }); }
        else if (!p.returning) p.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private inAnyBush(x: number, y: number) {
    let hit = false;
    this.bushGrid.query(x, y, x, y, (b, i) => {
      if (this.bushStates[i].alive && (x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r) { hit = true; return true; }
    });
    return hit;
  }

  private sweep(p: Projectile, ax: number, ay: number, bx: number, by: number) {
    const owner = this.byId.get(p.ownerId);
    // obstacles
    let tObs = 2, obs: Obstacle | null = null;
    const passObstacles = p.kind === 'meteor' || (p.kind === 'boomerang' && p.returning);
    const minx = Math.min(ax, bx) - p.radius - 2, maxx = Math.max(ax, bx) + p.radius + 2;
    const miny = Math.min(ay, by) - p.radius - 2, maxy = Math.max(ay, by) + p.radius + 2;
    this.obstacleGrid.query(minx, miny, maxx, maxy, (o) => {
      if (!o.alive || !o.blocksShots) return;
      const t = o.shape === 'circle'
        ? segCircle(ax, ay, bx, by, o.x, o.y, o.r + p.radius * 0.5)
        : segAABB(ax, ay, bx, by, o.x - o.hw - p.radius * 0.5, o.y - o.hh - p.radius * 0.5, o.x + o.hw + p.radius * 0.5, o.y + o.hh + p.radius * 0.5);
      if (t < 0) return;
      if (passObstacles) {
        if (p.kind === 'meteor') {
          if (o.type === 'rock') this.damageObstacle(o, p.terrainDamage, true);
          else if (o.type === 'crate' && !p.hit.includes('o' + o.id)) { p.hit.push('o' + o.id); this.damageObstacle(o, p.damage, false); }
        }
        return;
      }
      if (t < tObs) { tObs = t; obs = o; }
    });
    // fighters
    const hits: { f: Fighter; t: number }[] = [];
    for (const f of this.fighters) {
      if (!f.alive || f.id === p.ownerId) continue;
      const list = p.returning ? p.hitBack : p.hit;
      if (list.includes(f.id)) continue;
      const t = segCircle(ax, ay, bx, by, f.x, f.y, CHAR_BY_ID[f.charId].hitboxRadius + p.radius);
      if (t >= 0 && t <= tObs) hits.push({ f, t });
    }
    hits.sort((a, b) => a.t - b.t);
    for (const h of hits) {
      (p.returning ? p.hitBack : p.hit).push(h.f.id);
      let dmg = p.damage;
      if (p.rangeMul) dmg *= 1 + (p.rangeMul - 1) * clamp(p.traveled / p.maxRange, 0, 1);
      const sp = Math.hypot(p.vx, p.vy) || 1;
      this.damageFighter(h.f, owner ?? null, dmg, {
        x: ax, y: ay, originCluster: p.originCluster, isSuper: p.isSuper, kind: p.superKind ?? p.kind,
        knockback: p.knockback, nx: p.vx / sp, ny: p.vy / sp, status: p.status, crit: p.ambush || (p.rangeMul ? p.traveled > p.maxRange * 0.7 : false),
      });
      if (!p.pierce) { p.dead = true; p.x = ax + (bx - ax) * h.t; p.y = ay + (by - ay) * h.t; return; }
    }
    if (obs) {
      const o = obs as Obstacle;
      if (o.type === 'crate') this.damageObstacle(o, p.damage, false);
      else if (o.type === 'rock' && p.terrainDamage > 0) this.damageObstacle(o, p.terrainDamage, true);
      else this.events.push({ type: 'obstacleHit', id: o.id, x: ax + (bx - ax) * tObs, y: ay + (by - ay) * tObs });
      if (p.kind === 'boomerang') { p.returning = true; this.events.push({ type: 'boomerangBack', id: p.id }); return; }
      p.dead = true; p.x = ax + (bx - ax) * tObs; p.y = ay + (by - ay) * tObs;
    }
  }

  private stepArc(p: Projectile, dt: number) {
    p.t += (dt * 1000) / p.flightMs;
    const t = Math.min(1, p.t);
    p.x = p.sx + (p.tx - p.sx) * t; p.y = p.sy + (p.ty - p.sy) * t;
    const peak = p.isSuper ? 4.5 : 3.2;
    p.z = 0.7 * (1 - t) + 4 * peak * t * (1 - t);
    if (p.t < 1) return;
    p.dead = true;
    const owner = this.byId.get(p.ownerId) ?? null;
    if (p.superKind === 'prison') {
      const z: Zone = { id: this.nextId++, kind: 'prison', x: p.x, y: p.y, r: p.splash, start: this.time, until: this.time + 1500, ownerId: p.ownerId, targets: [], done: false };
      for (const f of this.fighters) {
        if (!f.alive || f.id === p.ownerId) continue;
        if (Math.hypot(f.x - p.x, f.y - p.y) <= p.splash + CHAR_BY_ID[f.charId].hitboxRadius) {
          f.stunUntil = this.time + 1500; z.targets.push(f.id);
          f.lastCombatAt = this.time;
        }
      }
      (z as Zone & { damage: number }).damage = p.damage;
      this.zones.push(z);
      this.events.push({ type: 'zoneStart', zoneId: z.id, kind: 'prison', x: z.x, y: z.y, r: z.r });
      return;
    }
    this.explode(p.x, p.y, p.splash, p.damage, owner, p.isSuper, p.superKind ?? 'grenade', p.terrainDamage, p.knockback, p.ambush);
  }

  private explode(x: number, y: number, r: number, damage: number, owner: Fighter | null, isSuper: boolean, kind: string, terrain: number, knockback: number, crit = false) {
    this.events.push({ type: 'explode', x, y, r, kind, ownerId: owner?.id ?? '' });
    for (const f of this.fighters) {
      if (!f.alive || (owner && f.id === owner.id)) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d <= r + CHAR_BY_ID[f.charId].hitboxRadius) {
        const nx = (f.x - x) / (d || 1), ny = (f.y - y) / (d || 1);
        // arcs ignore bush cover origin: grenades come from above, treat as from outside
        this.damageFighter(f, owner, damage, { x, y, originCluster: -2, isSuper, kind, knockback, nx, ny, crit });
      }
    }
    this.forObstaclesInRadius(x, y, r, (o) => {
      if (o.type === 'crate') this.damageObstacle(o, damage, false);
      else if (o.type === 'rock' && terrain > 0) this.damageObstacle(o, terrain, true);
    });
    if (isSuper && terrain > 0) this.destroyBushesInRadius(x, y, r);
  }

  // ───────────────────────────────────────────── damage
  damageFighter(target: Fighter, attacker: Fighter | null, raw: number, o: {
    x: number; y: number; originCluster: number; isSuper: boolean; kind: string; knockback?: number; nx?: number; ny?: number;
    status?: { type: 'slow'; durationMs: number; amount: number }; crit?: boolean; poison?: boolean;
  }) {
    if (!target.alive || this.phase !== 'playing') return;
    let dmg = raw;
    const cover = o.poison ? 1 : coverMultiplier(target, o.originCluster);
    dmg *= cover;
    if (this.time < target.shieldUntil) dmg *= 0.5;
    dmg = Math.round(dmg);
    if (this.cfg.mode === 'tutorial' && !target.isBot) dmg = Math.min(dmg, Math.max(0, target.hp - 1));
    target.hp -= dmg;
    target.lastCombatAt = this.time;
    target.lastHitAt = this.time;
    if (!o.poison) this.reveal(target, BUSH.revealAfterHitMs);
    if (o.knockback && o.nx !== undefined) { const v = o.knockback * 10; target.kbx += o.nx * v; target.kby += (o.ny ?? 0) * v; }
    if (o.status) {
      const prev = this.time < target.slowUntil ? target.slowAmount : 0;
      target.slowUntil = Math.max(target.slowUntil, this.time + o.status.durationMs);
      target.slowAmount = Math.max(o.status.amount, prev);
    }
    if (attacker && attacker !== target) {
      target.attackers[attacker.id] = this.time;
      attacker.damageDealt += dmg;
      attacker.lastCombatAt = this.time;
      if (!o.isSuper && !o.poison) {
        const w = this.weapon(attacker);
        const before = attacker.superCharge;
        attacker.superCharge = Math.min(1, attacker.superCharge + w.superChargePerHit / 100);
        if (before < 1 && attacker.superCharge >= 1) this.events.push({ type: 'superReady', id: attacker.id });
      }
    }
    let nx = o.nx ?? 0, ny = o.ny ?? 0;
    if (!nx && !ny && attacker) { const d = Math.hypot(target.x - attacker.x, target.y - attacker.y) || 1; nx = (target.x - attacker.x) / d; ny = (target.y - attacker.y) / d; }
    this.events.push({ type: 'hit', target: target.id, attacker: attacker?.id ?? null, amount: dmg, x: target.x, y: target.y, crit: !!o.crit, isSuper: o.isSuper, covered: cover < 1, kind: o.kind, nx, ny, shield: this.time < target.shieldUntil });
    if (target.hp <= 0) this.kill(target, attacker);
  }

  private kill(victim: Fighter, killer: Fighter | null) {
    if (this.cfg.mode === 'tutorial' && victim.isBot) {
      // tutorial dummies pop back up
      victim.hp = victim.maxHp;
      this.events.push({ type: 'kill', killer: killer?.id ?? null, victim: victim.id, place: 0, bounty: false, inBush: false });
      return;
    }
    victim.alive = false; victim.hp = 0; victim.retiredAt = this.time; victim.killedBy = killer?.id ?? null;
    victim.place = this.aliveCount + 1;
    victim.vx = victim.vy = victim.kbx = victim.kby = 0;
    const bounty = this.crownId === victim.id;
    this.stats.kills++;
    if (killer && killer !== victim) {
      killer.kills++; killer.streak++;
      if (killer.inBush >= 0) { killer.bushKills++; this.stats.bushKills++; }
      const before = killer.superCharge;
      killer.superCharge = Math.min(1, killer.superCharge + RULES.killSuperBonus);
      if (before < 1 && killer.superCharge >= 1) this.events.push({ type: 'superReady', id: killer.id });
      // absorb the victim's power cubes
      if (victim.cubes > 0) {
        const gained = victim.cubes;
        killer.cubes += gained;
        killer.maxHp = killer.baseHp * (1 + RULES.cubeBonus * killer.cubes);
        killer.hp = Math.min(killer.maxHp, killer.hp + killer.baseHp * RULES.cubeBonus * gained);
      }
      if (bounty) killer.bonusScore += SCORE.bounty;
      if (killer.streak >= 2) { killer.bonusScore += killer.streak === 2 ? SCORE.double : SCORE.triple; this.events.push({ type: 'streak', id: killer.id, n: killer.streak }); }
    }
    for (const [aid, t] of Object.entries(victim.attackers)) {
      if (aid === killer?.id || this.time - t > RULES.assistWindowMs) continue;
      const a = this.byId.get(aid); if (a) a.assists++;
    }
    victim.cubes = 0;
    this.events.push({ type: 'kill', killer: killer?.id ?? null, victim: victim.id, place: victim.place, bounty, inBush: !!killer && killer.inBush >= 0 });
    this.updateCrown();
  }

  private updateCrown() {
    let best: Fighter | null = null, tie = false;
    for (const f of this.fighters) {
      if (!f.alive || f.kills < 2) continue;
      if (!best || f.kills > best.kills) { best = f; tie = false; } else if (f.kills === best.kills) tie = true;
    }
    const id = best && !tie ? best.id : (this.crownId && this.byId.get(this.crownId)?.alive ? this.crownId : null);
    if (id !== this.crownId) { this.crownId = id; this.events.push({ type: 'crown', id }); }
  }

  forObstaclesInRadius(x: number, y: number, r: number, fn: (o: Obstacle) => void) {
    this.obstacleGrid.query(x - r - 2, y - r - 2, x + r + 2, y + r + 2, (o) => {
      if (!o.alive) return;
      const er = o.shape === 'circle' ? o.r : Math.max(o.hw, o.hh);
      if (Math.hypot(o.x - x, o.y - y) <= r + er * 0.7) fn(o);
    });
  }

  damageObstacle(o: Obstacle, amount: number, terrain: boolean) {
    if (!o.alive || !o.destructible) return;
    if (o.type === 'rock' && !terrain) return;
    o.hp -= amount;
    if (o.hp > 0) { this.events.push({ type: 'obstacleHit', id: o.id, x: o.x, y: o.y }); return; }
    o.alive = false;
    this.nav.onObstacleRemoved(o);
    this.events.push({ type: 'obstacleDestroyed', id: o.id, x: o.x, y: o.y, otype: o.type });
    if (o.type === 'crate') {
      for (let i = 0; i < o.cubes; i++) {
        const a = (i / Math.max(1, o.cubes)) * Math.PI * 2 + this.rng.next();
        const off = o.cubes > 1 ? 0.9 : 0;
        this.spawnPickup('cube', o.x + Math.cos(a) * off, o.y + Math.sin(a) * off);
      }
    }
  }

  private destroyBushesInRadius(x: number, y: number, r: number) {
    this.bushGrid.query(x - r, y - r, x + r, y + r, (b, i) => {
      const s = this.bushStates[i];
      if (!s.alive) return;
      if (Math.hypot(b.x - x, b.y - y) <= r + b.r * 0.5) {
        s.alive = false; s.destroyedAt = this.time; s.regrowAt = this.time + BUSH.regrowMs;
        this.events.push({ type: 'bushDestroyed', id: b.id });
      }
    });
  }

  private spawnPickup(kind: Pickup['kind'], x: number, y: number) {
    const p: Pickup = { id: this.nextId++, kind, x, y, spawnAt: this.time, taken: false };
    this.pickups.push(p);
    this.events.push({ type: 'pickupSpawn', pickupId: p.id, kind, x, y });
  }

  // ───────────────────────────────────────────── world systems
  private stepZones() {
    for (const z of this.zones) {
      if (z.done || this.time < z.until) continue;
      z.done = true;
      if (z.kind === 'prison') {
        const owner = this.byId.get(z.ownerId) ?? null;
        const dmg = (z as Zone & { damage: number }).damage;
        this.explode(z.x, z.y, z.r, dmg, owner, true, 'prison', 999, 1);
      } else if (z.kind === 'supply') {
        for (const f of this.fighters) if (f.alive && Math.hypot(f.x - z.x, f.y - z.y) < 1.8) this.damageFighter(f, null, 800, { x: z.x, y: z.y, originCluster: -2, isSuper: false, kind: 'supply', knockback: 2.5, nx: Math.sign(f.x - z.x) || 1, ny: Math.sign(f.y - z.y) });
        const o: Obstacle = {
          id: this.map.obstacles.length, type: 'crate', variant: 1, x: z.x, y: z.y, rot: 0, scale: 1.25, shape: 'box', r: 1, hw: 1, hh: 1,
          blocksMove: true, blocksShots: true, destructible: true, hp: RULES.supplyHp, maxHp: RULES.supplyHp, alive: true, cubes: 3,
        };
        this.addObstacle(o);
        this.events.push({ type: 'obstacleSpawn', id: o.id });
        this.events.push({ type: 'eventStart', kind: 'supply', x: z.x, y: z.y });
      }
    }
    this.zones = this.zones.filter((z) => !z.done || this.time - z.until < 1000);
  }

  /** Runtime obstacle (supply crate): rebuilds grid lazily via a fresh SpatialGrid. */
  private addObstacle(o: Obstacle) {
    this.map.obstacles.push(o);
    (this as { obstacleGrid: SpatialGrid<Obstacle> }).obstacleGrid = new SpatialGrid(this.map.obstacles, this.map.half, 4, (q) => Math.max(q.r, q.hw, q.hh));
    this.nav.rebuild(o.x - 3, o.y - 3, o.x + 3, o.y + 3);
    // push anyone standing inside out
    for (const f of this.fighters) if (f.alive) this.resolveCollisions(f, CHAR_BY_ID[f.charId].hitboxRadius);
  }

  private stepPickups() {
    for (const p of this.pickups) {
      if (p.taken || this.time - p.spawnAt < 350) continue;
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (Math.hypot(f.x - p.x, f.y - p.y) > CHAR_BY_ID[f.charId].hitboxRadius + 0.55) continue;
        if (p.kind === 'heal' && f.hp >= f.maxHp) continue;
        p.taken = true;
        if (p.kind === 'cube') {
          f.cubes++;
          f.maxHp = f.baseHp * (1 + RULES.cubeBonus * f.cubes);
          f.hp += f.baseHp * RULES.cubeBonus;
        } else {
          const amt = Math.min(RULES.healFlower, f.maxHp - f.hp);
          f.hp += amt;
          this.events.push({ type: 'heal', target: f.id, amount: Math.round(amt), x: f.x, y: f.y });
        }
        this.events.push({ type: 'pickup', id: f.id, pickupId: p.id, kind: p.kind, x: p.x, y: p.y });
        break;
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  private stepBushes() {
    this.bushStates.forEach((s, i) => {
      if (!s.alive && this.time >= s.regrowAt) { s.alive = true; this.events.push({ type: 'bushRegrow', id: i }); }
      if (this.poisonActive && !s.withered) {
        const b = this.map.bushes[i];
        if (Math.max(Math.abs(b.x), Math.abs(b.y)) > this.poisonRadius) s.withered = true;
      }
    });
  }

  /** Square safe zone (Chebyshev distance) — matches the square arena. */
  inPoison(x: number, y: number) { return this.poisonActive && Math.max(Math.abs(x), Math.abs(y)) > this.poisonRadius; }

  private stepPoison(dt: number) {
    if (!this.cfg.poison) return;
    const t = this.time;
    const alive = this.aliveCount;
    if (!this.poisonActive) {
      const early = alive <= 3 && t >= RULES.poisonEarlyMs;
      if (t < RULES.poisonStartMs && !early) return;
      this.poisonActive = true;
      // an early cloud starts right at the arena edge instead of off-map
      if (early) this.poisonProgress = (RULES.poisonFrom - RULES.poisonEarlyRadius) / (RULES.poisonFrom - RULES.poisonTo);
      this.events.push({ type: 'poisonStart' });
    }
    const speed = alive <= 2 ? 3 : alive <= 3 ? 2 : 1;
    this.poisonProgress = Math.min(1.25, this.poisonProgress + ((dt * 1000) / (RULES.poisonEndMs - RULES.poisonStartMs)) * speed);
    const k = this.poisonProgress;
    this.poisonRadius = k <= 1
      ? RULES.poisonFrom + (RULES.poisonTo - RULES.poisonFrom) * k
      : RULES.poisonTo + (RULES.poisonFinal - RULES.poisonTo) * ((k - 1) / 0.25);
    const dpsMul = k > 1 ? 1.6 : 1;
    for (const f of this.fighters) {
      if (!f.alive || !this.inPoison(f.x, f.y)) continue;
      f.poisonAcc += RULES.poisonDps * dpsMul * dt;
      f.poisonTick += dt;
      f.lastCombatAt = t;
      if (f.poisonTick >= 0.5) {
        f.poisonTick = 0;
        const amt = f.poisonAcc; f.poisonAcc = 0;
        const killer = f.attackers ? Object.entries(f.attackers).filter(([, at]) => t - at < RULES.assistWindowMs).sort((a, b) => b[1] - a[1])[0] : undefined;
        this.damageFighter(f, killer ? this.byId.get(killer[0]) ?? null : null, amt, { x: f.x, y: f.y, originCluster: -2, isSuper: true, kind: 'poison', poison: true });
      }
    }
  }

  private stepMapEvents() {
    for (const e of this.eventPlan) {
      if (!e.announced && this.time >= e.at - 3000) {
        e.announced = true;
        this.events.push({ type: 'eventAnnounce', kind: e.kind, x: e.x, y: e.y, at: e.at });
        if (e.kind === 'supply') this.zones.push({ id: this.nextId++, kind: 'supply', x: e.x, y: e.y, r: 1.8, start: this.time, until: e.at, ownerId: '', targets: [], done: false });
      }
      if (!e.started && this.time >= e.at) {
        e.started = true;
        if (e.kind === 'flowers') {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + this.rng.next() * 0.5, r = this.rng.range(8, 22);
            let x = Math.cos(a) * r, y = Math.sin(a) * r, tries = 0;
            while (this.nav.blocked[this.nav.cellOf(x, y)] && tries++ < 10) { x *= 0.9; y *= 0.9; }
            this.spawnPickup('heal', x, y);
          }
          this.events.push({ type: 'eventStart', kind: 'flowers', x: 0, y: 0 });
        } else if (e.kind === 'wind') {
          const a = this.rng.range(0, Math.PI * 2);
          this.wind = { x: Math.cos(a) * 7, y: Math.sin(a) * 7, until: this.time + 10000 };
          this.events.push({ type: 'eventStart', kind: 'wind', x: this.wind.x, y: this.wind.y });
        }
      }
    }
    if (this.wind.until > 0 && this.time >= this.wind.until) { this.wind = { x: 0, y: 0, until: 0 }; this.events.push({ type: 'eventEnd', kind: 'wind' }); }
  }

  private updateScores() {
    for (const f of this.fighters) {
      f.score = Math.round(f.kills * SCORE.kill + f.assists * SCORE.assist + f.damageDealt * SCORE.perDamage + f.bonusScore + (f.place ? placementBonus(f.place) : 0));
    }
  }

  private checkEnd() {
    if (this.cfg.mode === 'tutorial') return;
    const alive = this.fighters.filter((f) => f.alive);
    const timeUp = this.time >= this.cfg.durationMs;
    if (alive.length > 1 && !timeUp) return;
    alive.sort((a, b) => b.score - a.score || b.hp - a.hp);
    alive.forEach((f, i) => { f.place = i + 1; });
    this.winnerId = alive[0]?.id ?? null;
    this.updateScores();
    this.ranking = [...this.fighters].sort((a, b) => a.place - b.place).map((f) => ({
      id: f.id, name: f.name, charId: f.charId, place: f.place, score: f.score, kills: f.kills, assists: f.assists,
      damage: Math.round(f.damageDealt), isBot: f.isBot, cubes: f.cubes,
    }));
    this.phase = 'ended';
    this.events.push({ type: 'end', winner: this.winnerId });
  }
}
