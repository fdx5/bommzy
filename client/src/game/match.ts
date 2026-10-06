import * as THREE from 'three';
import {
  World, buildMap, CHAR_BY_ID, ITEMS, SLOTS, weaponOf, superOf, CHARACTERS, type GameEvent, type Fighter, type PlayerSlot, type CharacterId, type MapId,
} from '@pastel/shared';
import { Environment, type TimeOfDay } from '../render/environment';
import { themeFor } from '../render/themes';
import { ChibiModel, STYLE_FOR, type SuperStyle } from '../render/chibi';
import { VFX, SHAPE } from '../render/vfx';
import { Entities } from '../render/entities';
import { globalUniforms } from '../render/toon';
import type { Stage } from '../render/stage';
import type { QualityLevel } from '../render/quality';
import { Hud } from '../ui/hud';
import { t } from '../ui/i18n';
import { audio, type Sfx } from '../audio/audio';
import type { Controls } from '../input/controls';
import type { Profile } from './profile';

const DT = 1 / 60;
/** Characters are drawn larger than their hitbox so they read well from the top-down camera. */
const CHAR_VISUAL_SCALE = 1.4;
const BOT_NAMES = ['몽실이', '뽀짝', '찹쌀떡', '솜사탕', '콩떡', '말랑젤리', '구름빵', '꿀단지', '도토리', '팝콘', '마카롱', '복숭아', '라임', '보리', '감자칩', '두부'];

export interface MatchResult {
  world: World;
  localId: string;
  place: number;
  score: number;
  kills: number;
  damage: number;
  assists: number;
  charId: CharacterId;
  mvpId: string;
}

export interface MatchOptions { mode: 'ffa' | 'tutorial'; charId: CharacterId; skin: string; nickname: string; difficulty: 0 | 1 | 2; mapId: MapId; items?: string[] }

const SFX_FOR: Record<string, Sfx> = { bullet: 'gatling', pellet: 'shotgun', arc: 'throw', arrow: 'bow', boomerang: 'boomerang', bubble: 'bubble' };
const SUPER_SFX: Record<string, Sfx> = { gatling: 'superGatling', bigbang: 'superBigbang', megabomb: 'superMegabomb', meteor: 'superMeteor', tornado: 'superTornado', prison: 'superPrison' };
const IMPACT_SFX: Record<string, Sfx> = {
  bullet: 'impBullet', gatling: 'impBullet', pellet: 'impPellet', bigbang: 'impPellet', arrow: 'impArrow', meteor: 'impArrow',
  boomerang: 'impBoomerang', tornado: 'impBoomerang', bubble: 'impBubble', grenade: 'impExplosive', megabomb: 'impExplosive', prison: 'impBubble', supply: 'impExplosive',
};
/** Camera recoil per shot, by projectile type (local player only). */
const KICK: Record<string, number> = { bullet: 0.05, pellet: 0.32, arc: 0.08, arrow: 0.2, boomerang: 0.12, bubble: 0.1 };

export class Match {
  readonly world: World;
  readonly scene = new THREE.Scene();
  readonly localId = 'me';
  viewerId = 'me';
  private env: Environment;
  private vfx: VFX;
  private entities: Entities;
  private models = new Map<string, ChibiModel>();
  readonly hud: Hud;
  private acc = 0;
  private seq = 0;
  private hitstop = 0;
  private lastHitstop = 0;
  private slowT = 0;
  private combo = 0;
  private lastConfirm = -9;
  private muffled = false;
  private elapsed = 0;
  private fpsSamples: number[] = [];
  private qualityProbed = false;
  private retiredShown = false;
  private endTimer = -1;
  private fastForward = false;
  private paused = false;
  private superAura = new Map<string, number>();
  private tutorialStep = 0;
  private tutorialMoved = 0;
  private tutorialHits = 0;
  private tutEl?: HTMLElement;
  private lead = new THREE.Vector2();
  private focus = new THREE.Vector3();
  private lastLocal = { x: 0, z: 0 };
  onRetire?: (killer: Fighter | null, place: number) => void;
  onEnd?: (r: MatchResult) => void;
  onTutorialDone?: () => void;
  onQualityProbe?: (level: QualityLevel) => void;

  constructor(private stage: Stage, private controls: Controls, private uiRoot: HTMLElement, private portraits: Record<CharacterId, string>, private profile: Profile, readonly opts: MatchOptions) {
    const seed = (Math.random() * 1e9) | 0;
    const players: PlayerSlot[] = [{ id: this.localId, name: opts.nickname, charId: opts.charId, skin: opts.skin, isBot: false }];
    if (opts.mode === 'tutorial') {
      players.push({ id: 'dummy', name: '허수아비', charId: 'boogie', isBot: true, passive: true });
    } else {
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      const pool = CHARACTERS.map((c) => c.id).filter((id) => id !== opts.charId);
      for (let i = 1; i < 8; i++) {
        const charId = i < 6 ? pool[(i - 1) % pool.length] : CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;
        const d = Math.max(0, Math.min(2, opts.difficulty + (i % 3 === 0 ? -1 : i % 4 === 0 ? 1 : 0))) as 0 | 1 | 2;
        players.push({ id: 'b' + i, name: names[i - 1], charId, isBot: true, difficulty: d });
      }
      // shuffle spawn order so the local player isn't always at spawn 0
      const me = players.shift()!;
      players.splice(Math.floor(Math.random() * 8), 0, me);
    }
    this.world = new World(buildMap(opts.mode === 'tutorial' ? 'meadow' : opts.mapId), {
      mode: opts.mode, durationMs: 180000, seed, players, poison: opts.mode === 'ffa', mapEvents: opts.mode === 'ffa',
      countdownMs: opts.mode === 'ffa' ? 3000 : 0,
    });

    if (opts.mode === 'tutorial') this.setupTutorial();

    const tods: TimeOfDay[] = themeFor(this.world.map.theme).tods;
    const tod = tods[Math.floor(Math.random() * tods.length)];
    this.env = new Environment(this.scene, this.world.map, stage.quality, tod);
    this.vfx = new VFX(this.scene, stage.quality.particles);
    this.entities = new Entities(this.scene, this.vfx);
    for (const f of this.world.fighters) {
      const def = CHAR_BY_ID[f.charId];
      const skin = def.skins.find((s) => s.id === f.skin) ?? def.skins[0];
      // local player wears their saved outfit; bots get a random cute outfit for variety
      const m = new ChibiModel(f.charId, skin.palette, undefined, f.id === this.localId ? opts.items ?? [] : this.botOutfit(f.slot));
      m.group.scale.setScalar(CHAR_VISUAL_SCALE);
      m.onStep = () => {
        if (!m.group.visible) return;
        this.vfx.dust(m.group.position.x, m.group.position.z, 1);
        if (f.id === this.localId) audio.play('step', undefined, 0.5);
      };
      m.onLand = () => {
        const p = m.group.position;
        this.vfx.shockRing(p.x, p.z, 1.6, '#FFFFFF', 0.35);
        this.vfx.dust(p.x, p.z, 6);
        audio.play('land', f.id === this.localId ? undefined : { x: p.x, z: p.z }, f.id === this.localId ? 1 : 0.6);
        if (f.id === this.localId) this.stage.shake(0.25);
      };
      this.models.set(f.id, m);
      this.scene.add(m.group);
      m.group.position.set(f.x, 0, f.y);
    }
    this.hud = new Hud(uiRoot, this.world, this.localId, portraits, controls.touchMode);
    this.hud.onEmote = (i) => this.world.emote(this.localId, i);
    this.hud.showStats(profile.settings.showStats);

    const me = this.world.byId.get(this.localId)!;
    this.focus.set(me.x, 0, me.y);
    stage.follow(this.focus, this.lead, 0.016, true);
    stage.setView(this.scene);
    stage.warmup(this.scene);
    audio.music('battle');
    controls.enabled = true;
    controls.reset();
    controls.setVisible(true);
    controls.onScoreboard = (s) => this.hud.scoreboard(s);
    controls.onEmoteWheel = (s) => { if (s) this.hud.emoteWheel(true); };
  }

  private botOutfit(seed: number) {
    let x = (seed * 9301 + this.world.cfg.seed) % 233280;
    const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    const out: string[] = [];
    for (const sl of SLOTS) {
      if (rnd() > 0.38) continue;
      const pool = ITEMS.filter((i) => i.slot === sl && i.price < 40000);
      out.push(pool[Math.floor(rnd() * pool.length)].id);
    }
    return out;
  }

  private setupTutorial() {
    const w = this.world;
    const me = w.byId.get(this.localId)!, dummy = w.byId.get('dummy')!;
    // stand next to the spawn-cover rocks and a bush patch
    // spawn safe zones are obstacle-free: put the dummy 5m along the tangent so the shot is clear
    const sp = w.map.spawns[0];
    const r = Math.hypot(sp.x, sp.y), tx = -sp.y / r, ty = sp.x / r;
    me.x = me.px = sp.x; me.y = me.py = sp.y;
    dummy.x = dummy.px = sp.x + tx * 5; dummy.y = dummy.py = sp.y + ty * 5;
    me.aimAngle = Math.atan2(ty, tx);
    this.tutEl = document.createElement('div');
    this.tutEl.className = 'tutorial-box panel';
    this.uiRoot.appendChild(this.tutEl);
    this.renderTutorial();
  }

  private renderTutorial() {
    if (!this.tutEl) return;
    const steps = ['tut1', 'tut2', 'tut3', 'tut4', 'tut5'];
    this.tutEl.innerHTML = `<div class="prog">${steps.slice(0, 4).map((_, i) => `<i class="${i < this.tutorialStep ? 'done' : ''}"></i>`).join('')}</div>
      <div class="step">${t(steps[this.tutorialStep])}</div>
      ${this.tutorialStep >= 4 ? `<button class="btn mint" data-a="done">${t('play')}</button>` : `<button class="btn white" data-a="skip">${t('tutSkip')}</button>`}`;
    this.tutEl.querySelector('button')!.addEventListener('click', () => this.onTutorialDone?.());
  }

  private advanceTutorial(to: number) {
    if (this.tutorialStep >= to) return;
    this.tutorialStep = to;
    audio.play('superReady');
    this.vfx.confetti(this.focus.x, this.focus.z);
    if (to === 3) { const me = this.world.byId.get(this.localId)!; me.superCharge = 1; this.events([{ type: 'superReady', id: me.id }]); }
    this.renderTutorial();
  }

  setPaused(p: boolean) { this.paused = p; this.controls.enabled = !p && this.world.byId.get(this.localId)!.alive; }

  /** Skip to the end (retired player pressed "results"): run the sim headless. */
  fastForwardToEnd() { this.fastForward = true; }

  spectateNext(dir = 1) {
    const alive = this.world.fighters.filter((f) => f.alive);
    if (!alive.length) return;
    const i = alive.findIndex((f) => f.id === this.viewerId);
    this.viewerId = alive[(i + dir + alive.length) % alive.length].id;
    this.hud.setLocal(this.localId);
    const v = this.world.byId.get(this.viewerId)!;
    this.focus.set(v.x, 0, v.y);
    this.stage.follow(this.focus, this.lead.set(0, 0), 0.016, true);
  }

  get viewerName() { return this.world.byId.get(this.viewerId)?.name ?? ''; }

  update(frameDt: number) {
    // kill slow-motion: brief 0.3x time, eased back to normal (real-time based)
    this.slowT = Math.max(0, this.slowT - Math.min(frameDt, 0.1));
    const timeScale = this.slowT > 0 ? 0.3 + 0.7 * (1 - Math.min(1, this.slowT / 0.45)) ** 3 : 1;
    const dt = Math.min(frameDt, 0.1) * timeScale;
    this.elapsed += dt;
    const w = this.world;
    const me = w.byId.get(this.localId)!;

    const ended = () => w.phase === 'ended';
    if (this.fastForward && !ended()) {
      for (let i = 0; i < 1500 && !ended(); i++) { w.step(DT); }
      w.drainEvents();
      if (ended()) this.events([{ type: 'end', winner: w.winnerId }]);
    }

    // ── fixed-step simulation
    if (!this.paused) {
      if (this.hitstop > 0) this.hitstop -= dt;
      else this.acc += dt;
      const wpn = weaponOf(CHAR_BY_ID[me.charId]);
      while (this.acc >= DT) {
        this.acc -= DT;
        if (me.alive) w.setInput(this.localId, this.controls.sample(me.x, me.y, wpn.range, ++this.seq));
        w.step(DT);
        this.events(w.drainEvents());
      }
    }
    const alpha = this.paused ? 1 : this.acc / DT;

    // ── visuals
    const viewer = w.byId.get(this.viewerId) ?? me;
    if (!viewer.alive && this.viewerId !== this.localId && w.phase !== 'ended') this.spectateNext(1);
    const pushers: { x: number; z: number; s: number }[] = [];
    for (const f of w.fighters) {
      const m = this.models.get(f.id)!;
      const x = f.px + (f.x - f.px) * alpha, z = f.py + (f.y - f.py) * alpha;
      m.group.position.set(x, 0, z);
      const vis = w.visible(this.viewerId, f);
      if (!f.alive) {
        m.dead = true;
        m.group.visible = m.deathT < 1.2;
      } else {
        m.group.visible = vis;
      }
      if (!f.alive) { m.update({ dt, time: this.elapsed, speed: 0 }); continue; }
      const def = CHAR_BY_ID[f.charId];
      const speed = Math.min(1, Math.hypot(f.vx, f.vy) / def.moveSpeed);
      const superOn = f.superKind && w.time < f.superUntil ? (f.superKind as SuperStyle) : null;
      const aiming = w.time - f.lastAttackAt < 700 || !!superOn || speed < 0.1 || (f.id === this.localId && this.controls.aimPreview().strength > 0.5);
      const dashing = w.time < f.dashUntil;
      m.stunned = w.time < f.stunUntil;
      m.victory = w.phase === 'ended' && f.id === w.winnerId;
      m.weaponAway = def.weaponId === 'boomerang' && w.projectiles.some((p) => p.ownerId === f.id && p.kind === 'boomerang');
      m.update({
        dt, time: this.elapsed + f.slot, speed,
        moveYaw: Math.PI / 2 - f.moveAngle, aimYaw: Math.PI / 2 - f.aimAngle, aiming, dashing,
        superActive: superOn === 'gatling' || superOn === 'tornado' ? superOn : null, lowHp: f.hp / f.maxHp < 0.3,
      });
      if (vis) {
        pushers.push({ x, z, s: 1 });
        if (dashing) this.vfx.speedLines(x, z, f.moveAngle);
        if (f.superCharge >= 1) {
          const tt = (this.superAura.get(f.id) ?? 0) - dt;
          if (tt <= 0) { this.vfx.sparkle(x, 0.8, z, '#FFE27A', 1, 0.9); this.superAura.set(f.id, 0.12); } else this.superAura.set(f.id, tt);
        }
        if (w.time < f.shieldUntil && Math.random() < dt * 20) this.vfx.emit(x, 0.9, z, { count: 1, color: '#FFE9A8', speed: [0, 0], up: [0, 0], life: [0.25, 0.25], size: [2.2, 2.2], endSize: 1.05, shape: SHAPE.ring, alpha: 0.5 });
        if (w.time < f.slowUntil && Math.random() < dt * 8) this.vfx.emit(x, 1.4, z, { count: 1, color: '#B5DEFF', speed: [0, 0.3], up: [0.3, 0.6], life: [0.5, 0.7], size: [0.15, 0.22], shape: SHAPE.ring });
      }
    }
    this.env.setPushers(pushers);
    const muffle = viewer.alive && viewer.inBush >= 0;
    if (muffle !== this.muffled) { this.muffled = muffle; audio.setMuffled(muffle); }

    // ── camera, aim preview, environment
    const meNow = { x: me.px + (me.x - me.px) * alpha, z: me.py + (me.y - me.py) * alpha };
    if (me.alive) {
      const pv = this.controls.aimPreview();
      if (pv.active && w.phase === 'playing') {
        let ang = pv.angle, dist = pv.dist * weaponOf(CHAR_BY_ID[me.charId]).range;
        if (Number.isNaN(ang)) { const mw = this.controls.mouseWorld; ang = Math.atan2(mw.z - meNow.z, mw.x - meNow.x); dist = Math.hypot(mw.x - meNow.x, mw.z - meNow.z); }
        const sup = pv.isSuper && me.superCharge >= 1;
        if (pv.isSuper && sup) dist = Math.min(dist, superOf(CHAR_BY_ID[me.charId]).range || dist);
        this.entities.aim.show(me.charId, sup, meNow.x, meNow.z, ang, dist, pv.strength);
        const leadLen = this.controls.touchMode ? 1.6 : Math.min(2.5, dist * 0.18);
        this.lead.lerp(new THREE.Vector2(Math.cos(ang) * leadLen, Math.sin(ang) * leadLen), Math.min(1, dt * 4));
      } else {
        this.entities.aim.hide();
        const mv = Math.hypot(me.vx, me.vy) > 0.5 ? new THREE.Vector2(me.vx, me.vy).normalize().multiplyScalar(2) : new THREE.Vector2();
        this.lead.lerp(mv, Math.min(1, dt * 2.5));
      }
      this.tutorialMoved += Math.hypot(meNow.x - this.lastLocal.x, meNow.z - this.lastLocal.z);
      this.lastLocal = meNow;
      if (this.tutorialStep === 0 && this.opts.mode === 'tutorial' && this.tutorialMoved > 4) this.advanceTutorial(1);
    } else {
      this.entities.aim.hide();
      this.lead.lerp(new THREE.Vector2(), Math.min(1, dt * 3));
    }
    const vNow = this.viewerId === this.localId ? meNow : { x: viewer.px + (viewer.x - viewer.px) * alpha, z: viewer.py + (viewer.y - viewer.py) * alpha };
    this.focus.set(vNow.x, 0, vNow.z);
    this.stage.follow(this.focus, this.lead, dt);
    audio.listener.x = vNow.x; audio.listener.z = vNow.z;
    this.env.update(dt, this.elapsed, w, this.focus, viewer.alive ? viewer.inBush : -1);
    this.entities.update(w, alpha, dt, this.viewerId);
    this.vfx.update(dt);
    this.controls.setSuperState(me.superCharge, me.superCharge >= 1);
    this.controls.setGadgetState(me.gadgetUses, me.gadgetCd > 0);
    if (this.controls.pendingEmote >= 0) { w.emote(this.localId, this.controls.pendingEmote); this.controls.pendingEmote = -1; }
    this.hud.update(this.viewerId, this.stage.camera, alpha, dt, this.stage.renderer);

    this.ambience(dt);

    // wind visuals
    const windOn = w.time < w.wind.until;
    globalUniforms.uWindBoost.value += ((windOn ? 1 : 0) - globalUniforms.uWindBoost.value) * Math.min(1, dt * 2);
    if (windOn) {
      globalUniforms.uWindDir.value.set(w.wind.x, w.wind.y).normalize();
      if (Math.random() < dt * 25) this.vfx.emit(this.focus.x - w.wind.x * 2 + (Math.random() - 0.5) * 24, 1 + Math.random() * 2, this.focus.z - w.wind.y * 2 + (Math.random() - 0.5) * 18, { count: 1, color: ['#B8E6A8', '#FFC8DD'], angle: Math.atan2(w.wind.y, w.wind.x), spread: 0.3, speed: [6, 9], up: [-0.2, 0.2], life: [1.2, 1.8], size: [0.14, 0.2], shape: SHAPE.leaf, drag: 0.2, spin: 6 });
    }

    // auto quality probe: first seconds of real play
    if (!this.qualityProbed && w.phase === 'playing') {
      this.fpsSamples.push(frameDt);
      if (this.fpsSamples.length > 200) {
        this.qualityProbed = true;
        const avg = this.fpsSamples.slice(30).reduce((a, b) => a + b, 0) / (this.fpsSamples.length - 30);
        const fps = 1 / avg;
        const cur = this.stage.quality.level;
        const next: QualityLevel | null = fps < 40 && cur !== 'low' ? (cur === 'high' ? 'medium' : 'low') : fps > 57 && cur === 'low' ? 'medium' : null;
        if (next) this.onQualityProbe?.(next);
      }
    }

    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.finish();
    }
  }

  /** Weather / ambience particles around the camera focus, per map theme. */
  private ambience(dt: number) {
    const f = this.focus, night = this.env.tod === 'night';
    for (const kind of this.env.theme.ambient) {
      switch (kind) {
        case 'snow':
          if (Math.random() < dt * 45) this.vfx.emit(f.x + (Math.random() - 0.5) * 30, 7 + Math.random() * 2, f.z + (Math.random() - 0.5) * 22 - 3, { count: 1, color: '#FFFFFF', angle: 0.6, spread: 0.6, speed: [0.3, 0.9], up: [-1.3, -0.9], gravity: 0, drag: 0, life: [5, 6.5], size: [0.07, 0.14], endSize: 1, shape: SHAPE.glow, alpha: 0.95 });
          break;
        case 'sand':
          if (Math.random() < dt * 22) this.vfx.emit(f.x - 16 + Math.random() * 6, 0.2 + Math.random() * 1.6, f.z + (Math.random() - 0.5) * 22, { count: 1, color: ['#F7E3BA', '#EFD4A2'], angle: 0.15, spread: 0.2, speed: [6, 9], up: [-0.1, 0.2], drag: 0.1, life: [2.5, 3.5], size: [0.16, 0.3], endSize: 0.8, shape: SHAPE.streak, align: true, alpha: 0.55 });
          break;
        case 'fireflies':
          if (Math.random() < dt * (night ? 10 : 3)) this.vfx.emit(f.x + (Math.random() - 0.5) * 26, 0.4 + Math.random() * 1.8, f.z + (Math.random() - 0.5) * 18, { count: 1, color: night ? '#E8FF8A' : '#FFF6B0', speed: [0.1, 0.5], up: [-0.2, 0.3], drag: 0.5, life: [2, 3.2], size: [0.1, 0.16], endSize: 1, shape: SHAPE.glow });
          break;
        case 'petals':
          if (Math.random() < dt * 3) this.vfx.emit(f.x + (Math.random() - 0.5) * 26, 5, f.z + (Math.random() - 0.5) * 18, { count: 1, color: ['#FFC8DD', '#FFFFFF', '#FFE3EE'], angle: 0.4, spread: 0.8, speed: [0.5, 1.2], up: [-0.8, -0.5], drag: 0, life: [5, 6], size: [0.1, 0.15], endSize: 1, shape: SHAPE.leaf, spin: 4 });
          break;
      }
    }
  }

  private model(id: string) { return this.models.get(id); }
  private isMe(id: string | null | undefined) { return id === this.localId; }
  private pos(id: string) { const f = this.world.byId.get(id); return f ? { x: f.x, z: f.y } : undefined; }

  private events(list: GameEvent[]) {
    const w = this.world;
    for (const e of list) {
      switch (e.type) {
        case 'countdown':
          this.hud.banner(String(e.n), 'count', 900); audio.play('count');
          if (e.n === 3) for (const f of w.fighters) this.model(f.id)!.drop(8, 0.15 + f.slot * 0.12);
          break;
        case 'start': this.hud.banner(t('go'), 'count', 900); audio.play('go'); this.controls.vibrate(30); break;
        case 'fire':
          if (!e.isSuper) this.model(e.id)!.triggerAttack(STYLE_FOR[e.kind] ?? 'rapid');
          break;
        case 'shot': {
          // every volley: muzzle, casing, kick, sound
          const f = w.byId.get(e.id)!; const m = this.model(e.id)!;
          const me = this.isMe(e.id);
          m.kick(e.kind === 'pellet' ? 1.6 : e.isSuper ? 0.8 : 1);
          const vis = me || w.visible(this.viewerId, f);
          const pal = CHAR_BY_ID[f.charId].colorPalette;
          if (vis) {
            switch (e.kind) {
              case 'bullet': this.vfx.muzzle(e.x, e.y, e.angle, e.isSuper ? '#FFC94D' : '#FFE27A', e.isSuper); this.vfx.shell(e.x, e.y, e.angle); break;
              case 'pellet': this.vfx.shotgunPuff(e.x, e.y, e.angle); this.vfx.muzzle(e.x, e.y, e.angle, '#FF9A4D', true); this.vfx.shell(e.x, e.y, e.angle, true); break;
              case 'arrow': this.vfx.bowSnap(e.x, e.y, e.angle); break;
              case 'boomerang': this.vfx.swoosh(e.x, e.y, e.angle); break;
              case 'bubble': this.vfx.impact('bubble', e.x + Math.cos(e.angle) * 0.8, e.y + Math.sin(e.angle) * 0.8, e.angle); break;
              case 'arc': this.vfx.swoosh(e.x, e.y, e.angle, pal[0]); break;
            }
          }
          const sfx: Sfx = e.isSuper && e.kind === 'bullet' ? 'gatlingSuper' : SFX_FOR[e.kind] ?? 'gatling';
          audio.play(sfx, me ? undefined : { x: e.x, z: e.y }, me ? 0.95 : 0.7);
          if (me) {
            this.stage.kick(Math.cos(e.angle), Math.sin(e.angle), (KICK[e.kind] ?? 0.06) * (e.isSuper ? 1.3 : 1));
            if (e.kind === 'pellet') { this.stage.shake(0.12); this.controls.vibrate(14); }
          }
          break;
        }
        case 'superStart': {
          const m = this.model(e.id)!; m.triggerSuper(e.kind);
          const f = w.byId.get(e.id)!;
          const me = this.isMe(e.id);
          audio.play(SUPER_SFX[e.kind] ?? 'superBigbang', me ? undefined : { x: e.x, z: e.y });
          if (w.visible(this.viewerId, f) || me) {
            const pal = CHAR_BY_ID[f.charId].colorPalette;
            this.vfx.starPop(e.x, 1, e.y, pal.slice(0, 3));
            this.vfx.shockRing(e.x, e.y, 2.2, pal[0], 0.35);
            if (e.kind === 'meteor') for (let i = 0; i < 6; i++) setTimeout(() => this.vfx.chargeGlow(f.x, f.y, '#FFE27A'), i * 50);
            if (e.kind === 'bigbang') this.vfx.shotgunPuff(e.x, e.y, e.angle);
          }
          if (me) {
            this.stage.screenFlash(0.7, CHAR_BY_ID[f.charId].colorPalette[0]); this.stage.punch(0.14); this.stage.saturate(0.5);
            this.stage.kick(Math.cos(e.angle), Math.sin(e.angle), e.kind === 'bigbang' || e.kind === 'meteor' ? 0.5 : 0.15);
            this.controls.vibrate([20, 30, 40]);
          }
          break;
        }
        case 'hit': {
          const target = w.byId.get(e.target)!;
          const meAtt = this.isMe(e.attacker), meTgt = this.isMe(e.target);
          const power = e.isSuper ? 2 : e.crit ? 1.5 : Math.min(1.4, 0.45 + e.amount / 900);
          const ang = Math.atan2(e.ny, e.nx);
          const visibleT = meTgt || w.visible(this.viewerId, target);
          if (e.kind !== 'poison') {
            this.model(e.target)!.triggerHit(e.nx, e.ny, power);
            if (visibleT || meAtt) this.vfx.impact(e.kind, e.x, e.y, ang, e.isSuper || e.crit);
            const imp = IMPACT_SFX[e.kind];
            if (imp && imp !== 'impExplosive') audio.play(imp, { x: e.x, z: e.y }, meAtt || meTgt ? 0.9 : 0.6);
          }
          if (visibleT || meAtt) {
            const cls = meTgt ? 'me' : e.crit ? 'crit' : e.covered ? 'cover' : '';
            this.hud.damage(e.target + (meAtt ? ':m' : ':o'), e.x, e.y, e.amount, cls, e.crit ? '★' : '');
          }
          if (meAtt && e.kind !== 'poison') {
            // rising-pitch confirm for consecutive hits = the rhythm of a good combo
            const now = this.elapsed;
            this.combo = now - this.lastConfirm < 0.6 ? Math.min(this.combo + 1, 10) : 0;
            this.lastConfirm = now;
            audio.play('hitConfirm', undefined, 0.5, { pitch: Math.pow(2, this.combo / 12), noJitter: true });
            if (e.crit) audio.play('crit', undefined, 0.8);
            if (e.shield) audio.play('shieldHit', undefined, 0.8);
            if (now - this.lastHitstop > 0.12 || e.isSuper) {
              this.lastHitstop = now;
              this.hitstop = Math.max(this.hitstop, e.isSuper ? 0.075 : e.crit ? 0.06 : 0.025 + Math.min(0.035, e.amount / 25000));
            }
          }
          if (meTgt) {
            audio.play('hitMe');
            if (e.shield) audio.play('shieldHit');
            this.stage.shake(e.isSuper ? 0.45 : 0.12 + Math.min(0.2, e.amount / 4000));
            this.controls.vibrate(e.isSuper ? 60 : 25);
            if (e.kind !== 'poison' && (e.nx || e.ny)) this.hud.hurtFrom(Math.atan2(-e.ny, -e.nx));
          }
          break;
        }
        case 'heal': {
          const f = w.byId.get(e.target)!;
          if (w.visible(this.viewerId, f)) { this.vfx.heal(e.x, e.y); if (e.amount > 300) this.hud.number(e.x, e.y, '+' + e.amount, 'heal'); }
          if (this.isMe(e.target) && e.amount > 300) audio.play('heal');
          break;
        }
        case 'kill': {
          const victim = w.byId.get(e.victim)!;
          const killer = e.killer ? w.byId.get(e.killer)! : null;
          if (this.opts.mode === 'tutorial') { this.vfx.starPop(victim.x, 1, victim.y, ['#FFF5BA', '#FFFFFF']); audio.play('kill'); break; }
          this.vfx.starPop(victim.x, 1, victim.y, CHAR_BY_ID[victim.charId].colorPalette.slice(0, 3));
          this.vfx.shockRing(victim.x, victim.y, 2, '#FFFFFF');
          this.hud.killfeed(killer, victim);
          if (this.isMe(e.killer)) {
            audio.play('kill'); this.controls.vibrate([30, 40, 30]);
            if (e.bounty) this.hud.banner(t('bounty'), 'small');
            this.slowT = 0.45; this.stage.punch(0.16); this.stage.screenFlash(0.35, '#FFFFFF');
          }
          else audio.play('pop', { x: victim.x, z: victim.y });
          if (this.isMe(e.victim)) {
            audio.play('retire');
            this.controls.enabled = false;
            this.controls.setVisible(false);
            this.entities.aim.hide();
            this.hud.root.classList.add('dead');
            this.stage.shake(0.5);
            setTimeout(() => {
              if (this.retiredShown || this.world.phase === 'ended') return;
              this.retiredShown = true;
              this.onRetire?.(killer, e.place);
            }, 1400);
          }
          break;
        }
        case 'streak':
          if (this.isMe(e.id)) { this.hud.banner(e.n === 2 ? t('double') : e.n === 3 ? t('triple') : t('mega')); audio.play('streak'); }
          break;
        case 'explode': {
          const pal: string[] = e.kind === 'prison' ? ['#FFFFFF', '#CFF1FF', '#FFC8DD', '#E9DEFF'] : e.kind === 'megabomb' ? ['#FFFFFF', '#FFE9C7', '#E9DEFF', '#FFC8DD'] : ['#FFFFFF', '#FFE3F0', '#F1EAFF'];
          this.vfx.explosion(e.x, e.y, e.r, pal);
          if (e.kind === 'prison') { audio.play('impBubble', { x: e.x, z: e.y }, 1.2); audio.play('explode', { x: e.x, z: e.y }, 0.7); }
          else audio.play(e.r > 3 ? 'bigExplode' : 'explode', { x: e.x, z: e.y }, e.r > 3 ? 1.1 : 0.9);
          const d = Math.hypot(e.x - this.focus.x, e.y - this.focus.z);
          this.stage.shake(Math.max(0, (e.r > 3 ? 0.6 : 0.25) * (1 - d / 16)));
          if (e.r > 3 && d < 14) this.stage.screenFlash(0.25);
          break;
        }
        case 'obstacleHit': {
          this.env.onObstacleHit(e.id);
          const o = w.map.obstacles[e.id];
          if (o && o.type !== 'water') this.vfx.dust(e.x, e.y, 1);
          if (o?.type === 'crate') audio.play('tick', { x: e.x, z: e.y }, 0.6);
          break;
        }
        case 'obstacleDestroyed':
          if (e.otype === 'rock') { this.vfx.rockBurst(e.x, e.y); this.vfx.shockRing(e.x, e.y, 1.8, '#FFFFFF', 0.3); audio.play('rock', { x: e.x, z: e.y }); }
          else { this.vfx.crateBurst(e.x, e.y); audio.play('crate', { x: e.x, z: e.y }); }
          if (Math.hypot(e.x - this.focus.x, e.y - this.focus.z) < 10) this.stage.shake(0.15);
          if (this.opts.mode === 'tutorial' && this.tutorialStep === 3 && e.otype === 'rock') this.advanceTutorial(4);
          break;
        case 'obstacleSpawn': {
          const o = w.map.obstacles[e.id];
          this.vfx.explosion(o.x, o.y, 2.2, ['#FFFFFF', '#FFF1E0', '#FFE3C9']);
          audio.play('crate', { x: o.x, z: o.y }, 1.2);
          this.stage.shake(0.3);
          break;
        }
        case 'bushDestroyed': { const b = w.map.bushes[e.id]; this.vfx.leaves(b.x, b.y, 14); break; }
        case 'bushRegrow': { const b = w.map.bushes[e.id]; this.vfx.leaves(b.x, b.y, 4); break; }
        case 'pickup':
          if (this.isMe(e.id)) { audio.play(e.kind === 'cube' ? 'pickup' : 'heal'); this.controls.vibrate(15); }
          this.vfx.sparkle(e.x, 0.6, e.y, e.kind === 'cube' ? '#A8E6CF' : '#FFC8DD', 10, 0.5);
          if (e.kind === 'cube') this.hud.number(e.x, e.y, '+🟩', 'heal');
          break;
        case 'pickupSpawn': this.vfx.sparkle(e.x, 0.6, e.y, '#FFFFFF', 8, 0.4); break;
        case 'superReady':
          if (this.isMe(e.id)) { audio.play('superReady'); this.controls.vibrate([15, 40, 15]); this.hud.banner(t('superReady'), 'small', 1200); }
          break;
        case 'gadget': {
          const f = w.byId.get(e.id)!;
          if (w.visible(this.viewerId, f) || this.isMe(e.id)) {
            if (e.kind === 'dash') { this.vfx.dust(e.x, e.y, 6); audio.play('dash', { x: e.x, z: e.y }); }
            else if (e.kind === 'shield') { this.vfx.sparkle(e.x, 1, e.y, '#FFE27A', 12, 0.8); audio.play('shield', { x: e.x, z: e.y }); }
            else if (e.kind === 'heal') { this.vfx.heal(e.x, e.y); this.vfx.heal(e.x, e.y); }
            else if (e.kind === 'ink') { this.vfx.explosion(e.x, e.y, 3, ['#6E5A8E', '#8E7AB0', '#4A3B5C']); audio.play('explode', { x: e.x, z: e.y }, 0.5); }
          }
          break;
        }
        case 'hide': {
          this.env.rustleAt(e.x, e.y);
          if (this.isMe(e.id) || w.visible(this.viewerId, w.byId.get(e.id)!)) { this.vfx.leaves(e.x, e.y, 8); audio.play('rustle', { x: e.x, z: e.y }); }
          if (this.isMe(e.id) && this.opts.mode === 'tutorial' && this.tutorialStep === 2) this.advanceTutorial(3);
          break;
        }
        case 'unhide': this.env.rustleAt(e.x, e.y); if (this.isMe(e.id)) this.vfx.leaves(e.x, e.y, 5); break;
        case 'reveal': { const f = w.byId.get(e.id)!; this.env.rustleAt(f.x, f.y); break; }
        case 'reload': if (this.isMe(e.id)) audio.play('reload', undefined, 0.4); break;
        case 'dry': if (this.isMe(e.id)) audio.play('dry'); break;
        case 'eventAnnounce':
          this.hud.banner(`${t('ev_' + e.kind)} (${t('ev_soon')})`, 'small', 2600);
          audio.play('event');
          break;
        case 'eventStart':
          if (e.kind === 'flowers') this.vfx.confetti(this.focus.x, this.focus.z);
          break;
        case 'poisonStart': this.hud.banner(t('poison'), 'small', 2600); audio.play('event'); break;
        case 'zoneStart': audio.play('bubble', { x: e.x, z: e.y }, 1.3); this.vfx.shockRing(e.x, e.y, e.r, '#CFF1FF'); break;
        case 'emote': {
          this.hud.emote(e.id, e.emote);
          const f = w.byId.get(e.id)!;
          if (w.visible(this.viewerId, f)) { audio.play('pop', { x: f.x, z: f.y }, 0.6); if (e.emote === 3) this.vfx.hearts(f.x, f.y); }
          break;
        }
        case 'crown': if (this.isMe(e.id)) this.hud.banner(t('crownYou'), 'small'); break;
        case 'end': {
          if (this.endTimer > 0 || this.endTimer === -2) break;
          this.endTimer = this.fastForward ? 0.05 : 2.6;
          this.controls.enabled = false;
          this.entities.aim.hide();
          if (w.winnerId) {
            const win = w.byId.get(w.winnerId)!;
            this.viewerId = win.id;
            this.vfx.confetti(win.x, win.y);
            this.stage.punch(0.18);
          }
          if (this.isMe(w.winnerId)) { audio.play('victory'); this.hud.banner(t('victory'), '', 2400); }
          break;
        }
        default: break;
      }
      // tutorial hit tracking
      if (this.opts.mode === 'tutorial' && e.type === 'hit' && this.isMe(e.attacker) && e.target === 'dummy') {
        this.tutorialHits++;
        if (this.tutorialStep === 1 && this.tutorialHits >= 2) this.advanceTutorial(2);
      }
    }
    void this.pos;
  }

  private finish() {
    this.endTimer = -2;
    const w = this.world;
    const me = w.byId.get(this.localId)!;
    const mvp = [...w.fighters].sort((a, b) => b.score - a.score)[0];
    audio.music('lobby');
    this.hud.root.classList.add('over');
    this.controls.setVisible(false);
    this.onEnd?.({ world: w, localId: this.localId, place: me.place, score: me.score, kills: me.kills, damage: Math.round(me.damageDealt), assists: me.assists, charId: me.charId, mvpId: mvp.id });
  }

  dispose() {
    this.hud.dispose();
    this.tutEl?.remove();
    for (const m of this.models.values()) m.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else mat?.dispose();
    });
    this.controls.enabled = false;
    this.controls.setVisible(false);
    this.controls.onScoreboard = undefined;
    this.controls.onEmoteWheel = undefined;
  }
}
