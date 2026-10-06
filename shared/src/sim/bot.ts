import { CHAR_BY_ID, weaponOf, superOf } from '../data/characters';
import { segCircle, segAABB, RNG, DEG, type Vec2 } from '../math';
import { emptyInput, type Fighter, type PlayerInput } from './types';
import type { World } from './world';

const DIFF = [
  { aimErr: 15, reaction: 520, dodge: 0.15, fireGap: 380, superDelay: 1600 },
  { aimErr: 8, reaction: 300, dodge: 0.45, fireGap: 160, superDelay: 700 },
  { aimErr: 3.5, reaction: 170, dodge: 0.75, fireGap: 40, superDelay: 250 },
];

const PREF_RANGE: Record<string, number> = { gatling: 10, shotgun: 3.2, grenade: 9.5, crossbow: 17, boomerang: 8, bubble: 9 };
/** Bots only pull the trigger inside this distance (shotgun pellets spread out). */
const FIRE_RANGE: Record<string, number> = { shotgun: 6.5 };
/** Bots notice enemies within this radius; early on they prefer looting. */
const SIGHT = 13, SIGHT_EARLY = 6.5, LOOT_PHASE_MS = 35000;

type State = 'roam' | 'fight' | 'hunt' | 'retreat' | 'ambush';

export function lineOfSight(world: World, ax: number, ay: number, bx: number, by: number, pad = 0.1) {
  let clear = true;
  world.obstacleGrid.query(Math.min(ax, bx) - 2, Math.min(ay, by) - 2, Math.max(ax, bx) + 2, Math.max(ay, by) + 2, (o) => {
    if (!o.alive || !o.blocksShots) return;
    const t = o.shape === 'circle'
      ? segCircle(ax, ay, bx, by, o.x, o.y, o.r + pad)
      : segAABB(ax, ay, bx, by, o.x - o.hw - pad, o.y - o.hh - pad, o.x + o.hw + pad, o.y + o.hh + pad);
    if (t >= 0 && t < 0.98) { clear = false; return true; }
  });
  return clear;
}

export class Bot {
  state: State = 'roam';
  private rng: RNG;
  private targetId: string | null = null;
  private lastSeen: { x: number; y: number; t: number } | null = null;
  private path: Vec2[] = [];
  private pathGoal: Vec2 | null = null;
  private repathAt = 0;
  private goal: Vec2 | null = null;
  private goalUntil = 0;
  private goalCrate = -1;
  private strafe = 1;
  private strafeAt = 0;
  private seenAt = new Map<string, number>();
  private nextFireAt = 0;
  private superReadyAt = -1;
  private stuckT = 0;
  private lastX = 0; private lastY = 0;
  private dodgeUntil = 0; private dodgeX = 0; private dodgeY = 0;
  private ambushUntil = 0;
  private lastKills = 0;
  private wobble: number;

  constructor(readonly id: string, readonly difficulty: 0 | 1 | 2, seed: number, readonly passive = false) {
    this.rng = new RNG(Math.floor(seed * 7919) + 13);
    this.wobble = this.rng.range(0, 100);
  }

  think(world: World, me: Fighter, dt: number): PlayerInput {
    const inp = emptyInput();
    const now = world.time;
    const P = DIFF[this.difficulty];
    const def = CHAR_BY_ID[me.charId];
    const w = weaponOf(def);

    if (this.passive) {
      const a = now / 1400 + this.wobble;
      inp.moveX = Math.cos(a) * 0.35; inp.moveY = Math.sin(a * 0.7) * 0.35;
      return inp;
    }

    // ── perception
    let target: Fighter | null = null, td = Infinity;
    for (const f of world.fighters) {
      if (f === me || !f.alive) continue;
      if (!world.visible(me.id, f)) { this.seenAt.delete(f.id); continue; }
      const d = Math.hypot(f.x - me.x, f.y - me.y);
      const sight = now < LOOT_PHASE_MS && now - me.lastHitAt > 2000 ? SIGHT_EARLY : SIGHT;
      if (d > sight && !(f.id === this.targetId && d < sight + 4)) continue;
      if (!this.seenAt.has(f.id)) this.seenAt.set(f.id, now);
      // prefer the current target, weak targets and close ones
      const score = d * (f.id === this.targetId ? 0.7 : 1) * (0.6 + 0.4 * f.hp / f.maxHp) * (f.id === world.crownId ? 0.85 : 1);
      if (score < td) { td = score; target = f; }
    }
    if (target) { this.targetId = target.id; this.lastSeen = { x: target.x, y: target.y, t: now }; }
    else this.targetId = null;
    const dist = target ? Math.hypot(target.x - me.x, target.y - me.y) : Infinity;
    const reacted = target ? now - (this.seenAt.get(target.id) ?? now) >= P.reaction : false;

    // ── state selection
    const hpFrac = me.hp / me.maxHp;
    const poisonDanger = world.poisonActive && Math.max(Math.abs(me.x), Math.abs(me.y)) > world.poisonRadius - 2.5;
    if (poisonDanger) this.state = 'roam';
    else if (hpFrac < 0.4 && (!target || dist > 5 || this.state === 'retreat')) this.state = hpFrac > 0.85 ? 'roam' : 'retreat';
    else if (this.state === 'retreat' && hpFrac < 0.8 && (!target || dist > 6)) this.state = 'retreat';
    else if (target) this.state = 'fight';
    else if (this.lastSeen && now - this.lastSeen.t < 2500) this.state = 'hunt';
    else if (this.state === 'ambush' && now < this.ambushUntil) this.state = 'ambush';
    else if (this.state !== 'roam') { this.state = 'roam'; this.goal = null; }

    let mx = 0, my = 0;
    let aimAt: Vec2 | null = null;
    let wantFire = false;

    if (poisonDanger) {
      const g = { x: me.x * 0.2, y: me.y * 0.2 };
      [mx, my] = this.goTo(world, me, g);
    } else if (this.state === 'fight' && target) {
      const pref = PREF_RANGE[w.id] ?? 9;
      const arc = w.projectileType === 'arc';
      const los = arc || lineOfSight(world, me.x, me.y, target.x, target.y);
      const dx = (target.x - me.x) / dist, dy = (target.y - me.y) / dist;
      if (!los) {
        [mx, my] = this.goTo(world, me, target);
      } else {
        if (now > this.strafeAt) { this.strafe = this.rng.next() < 0.5 ? -1 : 1; this.strafeAt = now + this.rng.range(500, 1400); }
        let fwd = 0;
        if (dist > pref + 1.5) fwd = 1; else if (dist < pref - 1.5) fwd = -0.9;
        mx = dx * fwd + -dy * this.strafe * 0.75;
        my = dy * fwd + dx * this.strafe * 0.75;
        if (fwd > 0 && dist > pref + 4) { const [px, py] = this.goTo(world, me, target); mx = px * 0.8 + mx * 0.2; my = py * 0.8 + my * 0.2; }
      }
      if (los && dist <= (FIRE_RANGE[w.id] ?? w.range * 0.95) && reacted) { aimAt = this.lead(target, me, w.projectileSpeed, arc); wantFire = true; }
      else if (los && dist <= w.range * 1.1) aimAt = { x: target.x, y: target.y };

      // super usage
      if (me.superCharge >= 1) {
        if (this.superReadyAt < 0) this.superReadyAt = now + P.superDelay;
        if (now >= this.superReadyAt) {
          const sd = superOf(def);
          const ok = ({
            gatling: dist < 13 && los, bigbang: dist < 6 && los, megabomb: dist < 13, meteor: dist < 22,
            tornado: dist < 3.6, prison: dist < 12,
          } as Record<string, boolean>)[sd.kind];
          if (ok) {
            const a = this.lead(target, me, sd.kind === 'meteor' ? 55 : w.projectileSpeed, sd.aim === 'arc');
            inp.superFire = true;
            inp.aimX = a.x - me.x; inp.aimY = a.y - me.y; inp.aimDist = Math.hypot(inp.aimX, inp.aimY);
            this.superReadyAt = -1;
          }
        }
      }
      // gadgets
      if (me.gadgetUses > 0 && me.gadgetCd <= 0) {
        const g = def.gadgetId;
        if ((g === 'honeyShield' || g === 'bananaSnack') && hpFrac < 0.45 && now - me.lastHitAt < 600) inp.gadget = true;
        if (g === 'bullRush' && dist > 3.5 && dist < 8 && los) { inp.gadget = true; mx = dx; my = dy; }
        if ((g === 'starDash' || g === 'iceSlide') && dist < 4 && hpFrac < 0.6) { inp.gadget = true; mx = -dx; my = -dy; }
        if (g === 'inkCloud' && dist < 3.6) inp.gadget = true;
      }
    } else if (this.state === 'hunt' && this.lastSeen) {
      [mx, my] = this.goTo(world, me, this.lastSeen);
      if (Math.hypot(this.lastSeen.x - me.x, this.lastSeen.y - me.y) < 1.5) this.lastSeen = null;
    } else if (this.state === 'retreat') {
      if (!this.goal || now > this.goalUntil || (me.inBush >= 0 && !target)) {
        if (me.inBush < 0) { this.goal = this.findBush(world, me); this.goalUntil = now + 5000; }
        else { this.goal = { x: me.x, y: me.y }; this.goalUntil = now + 800; }
      }
      if (this.goal) [mx, my] = this.goTo(world, me, this.goal);
      if (target && dist < w.range * 0.9 && reacted) { aimAt = this.lead(target, me, w.projectileSpeed, w.projectileType === 'arc'); wantFire = me.ammo >= 2; }
    } else if (this.state === 'ambush') {
      if (this.goal && Math.hypot(this.goal.x - me.x, this.goal.y - me.y) > 0.6) [mx, my] = this.goTo(world, me, this.goal);
    } else {
      // roam: cubes > heal flowers (hurt) > crates > bush ambush > centre-ish points
      const crate = this.goalCrate >= 0 ? world.map.obstacles[this.goalCrate] : null;
      if (crate && !crate.alive) { this.goal = null; this.goalCrate = -1; }
      const reached = this.goal && this.goalCrate < 0 && Math.hypot(this.goal.x - me.x, this.goal.y - me.y) < 1.2;
      if (!this.goal || now > this.goalUntil || reached) this.pickRoamGoal(world, me);
      if (this.goal) [mx, my] = this.goTo(world, me, this.goal);
      // shoot crates in range + sight; stand still once comfortably in range
      for (const o of world.map.obstacles) {
        if (o.type !== 'crate' || !o.alive) continue;
        const d = Math.hypot(o.x - me.x, o.y - me.y);
        if (d < w.range * 0.85 && (w.projectileType === 'arc' || lineOfSight(world, me.x, me.y, o.x, o.y, -0.2))) {
          aimAt = { x: o.x, y: o.y }; wantFire = true;
          if (o.id === this.goalCrate && d < Math.max(2.5, w.range * 0.6)) { mx = 0; my = 0; }
          else if (d < 4) { mx *= 0.2; my *= 0.2; }
          break;
        }
      }
    }

    // ── dodge incoming projectiles
    if (now < this.dodgeUntil) { mx = mx * 0.3 + this.dodgeX; my = my * 0.3 + this.dodgeY; }
    else if (this.rng.next() < P.dodge * dt * 6) {
      for (const p of world.projectiles) {
        if (p.ownerId === me.id) continue;
        if (p.kind === 'arc') {
          const ax = me.x - p.tx, ay = me.y - p.ty, ad = Math.hypot(ax, ay);
          if (ad < p.splash + 0.9) {
            this.dodgeX = ad > 0.01 ? ax / ad : 1; this.dodgeY = ad > 0.01 ? ay / ad : 0; this.dodgeUntil = now + 380;
            break;
          }
          continue;
        }
        const rx = me.x - p.x, ry = me.y - p.y, d = Math.hypot(rx, ry);
        if (d > 7) continue;
        const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
        const along = rx * ux + ry * uy;
        if (along <= 0) continue;
        const perp = rx * -uy + ry * ux;
        if (Math.abs(perp) < 1.3) {
          const s = perp >= 0 ? 1 : -1;
          this.dodgeX = -uy * s; this.dodgeY = ux * s; this.dodgeUntil = now + 280;
          break;
        }
      }
    }

    // ── stuck detection
    const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
    this.lastX = me.x; this.lastY = me.y;
    if (Math.hypot(mx, my) > 0.3 && moved < 0.3 * dt) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) { this.path = []; this.repathAt = 0; this.goal = null; this.stuckT = 0; this.dodgeX = this.rng.range(-1, 1); this.dodgeY = this.rng.range(-1, 1); this.dodgeUntil = now + 400; }
    } else this.stuckT = 0;

    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    inp.moveX = mx; inp.moveY = my;

    if (!inp.superFire) {
      if (aimAt) {
        const err = (this.rng.next() - 0.5) * 2 * P.aimErr * DEG;
        const a = Math.atan2(aimAt.y - me.y, aimAt.x - me.x) + err;
        let d = Math.hypot(aimAt.x - me.x, aimAt.y - me.y);
        if (w.projectileType === 'arc') d *= 1 + (this.rng.next() - 0.5) * P.aimErr * 0.025;
        inp.aimX = Math.cos(a); inp.aimY = Math.sin(a); inp.aimDist = d;
        if (wantFire && now >= this.nextFireAt && me.ammo >= 1) { inp.fire = true; this.nextFireAt = now + P.fireGap + this.rng.range(0, P.fireGap); }
      } else if (ml > 0.1) { inp.aimX = mx; inp.aimY = my; }
    }

    // ── a little personality
    if (me.kills > this.lastKills) { this.lastKills = me.kills; if (this.rng.next() < 0.45) world.emote(me.id, this.rng.int(0, 3)); }
    return inp;
  }

  private lead(t: Fighter, me: Fighter, speed: number, arc: boolean): Vec2 {
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    const time = arc ? 0.8 : d / speed;
    const k = this.difficulty === 0 ? 0.3 : this.difficulty === 1 ? 0.65 : 0.9;
    return { x: t.x + t.vx * time * k, y: t.y + t.vy * time * k };
  }

  private goTo(world: World, me: Fighter, goal: Vec2): [number, number] {
    const now = world.time;
    const direct = Math.hypot(goal.x - me.x, goal.y - me.y);
    if (direct < 0.4) return [0, 0];
    if (!this.pathGoal || Math.hypot(this.pathGoal.x - goal.x, this.pathGoal.y - goal.y) > 2 || now > this.repathAt || this.path.length === 0) {
      this.path = world.nav.findPath(me, goal) ?? [goal];
      this.pathGoal = { x: goal.x, y: goal.y };
      this.repathAt = now + 900 + this.rng.range(0, 400);
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - me.x, this.path[0].y - me.y) < 0.8) this.path.shift();
    const wp = this.path[0] ?? goal;
    const dx = wp.x - me.x, dy = wp.y - me.y, d = Math.hypot(dx, dy) || 1;
    const slow = this.path.length <= 1 && d < 1 ? d : 1;
    return [(dx / d) * slow, (dy / d) * slow];
  }

  private findBush(world: World, me: Fighter): Vec2 | null {
    let best: Vec2 | null = null, bd = Infinity;
    world.map.bushes.forEach((b, i) => {
      const s = world.bushStates[i];
      if (!s.alive || s.withered) return;
      if (world.inPoison(b.x, b.y)) return;
      let d = Math.hypot(b.x - me.x, b.y - me.y);
      // avoid bushes near visible enemies
      for (const f of world.fighters) if (f !== me && f.alive && world.visible(me.id, f) && Math.hypot(f.x - b.x, f.y - b.y) < 6) d += 15;
      if (d < bd) { bd = d; best = { x: b.x, y: b.y }; }
    });
    return best;
  }

  private pickRoamGoal(world: World, me: Fighter) {
    const now = world.time;
    this.goalUntil = now + this.rng.range(5000, 9000);
    let best: Vec2 | null = null, bd = 26;
    for (const p of world.pickups) {
      if (p.kind === 'heal' && me.hp > me.maxHp * 0.7) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bd && !world.inPoison(p.x, p.y)) { bd = d; best = p; }
    }
    if (best) { this.goal = { x: best.x, y: best.y }; this.goalCrate = -1; return; }
    bd = 30;
    for (const o of world.map.obstacles) {
      if (o.type !== 'crate' || !o.alive || world.inPoison(o.x, o.y)) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) {
      // walk toward the crate itself until it's in range and in sight (see roam), then shoot
      const c = best as unknown as { x: number; y: number; id: number };
      this.goal = { x: c.x, y: c.y }; this.goalCrate = c.id;
      this.goalUntil = now + 12000;
      return;
    }
    this.goalCrate = -1;
    if (this.rng.next() < 0.35) {
      const bush = this.findBush(world, me);
      if (bush && Math.hypot(bush.x - me.x, bush.y - me.y) < 14) {
        this.goal = bush; this.state = 'ambush'; this.ambushUntil = now + this.rng.range(3000, 6500); return;
      }
    }
    const lim = world.poisonActive ? Math.max(4, world.poisonRadius - 4) : 26;
    const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(3, lim);
    this.goal = { x: Math.max(-lim, Math.min(lim, me.x * 0.4 + Math.cos(a) * r)), y: Math.max(-lim, Math.min(lim, me.y * 0.4 + Math.sin(a) * r)) };
  }
}
