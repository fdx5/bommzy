import * as THREE from 'three';
import { CHAR_BY_ID, RULES, weaponOf, type Fighter, type GameEvent, type World, type CharacterId } from '@pastel/shared';
import { t } from './i18n';
import { themeFor } from '../render/themes';

interface Plate { el: HTMLElement; hp: HTMLElement; lag: HTMLElement; hpn: HTMLElement; ammo?: HTMLElement[]; tags: HTMLElement; reveal: HTMLElement; last: string }
interface Dmg { el: HTMLElement; x: number; y: number; z: number; t: number; life: number; vx: number; active: boolean; key: string; amount: number; prefix: string }

const EMOTES = ['😆', '😠', 'GG', '❤️'];

export class Hud {
  readonly root: HTMLElement;
  private plates = new Map<string, Plate>();
  private dmg: Dmg[] = [];
  private v = new THREE.Vector3();
  private el: Record<string, HTMLElement> = {};
  private mini: CanvasRenderingContext2D;
  private miniBase: HTMLCanvasElement;
  private miniT = 0;
  private statsT = 0;
  private frames = 0;
  private lastStats = '';
  private shown: Record<string, string> = {};
  onEmote?: (i: number) => void;
  onPause?: () => void;

  constructor(parent: HTMLElement, private world: World, private localId: string, private portraits: Record<CharacterId, string>, private touch: boolean) {
    const r = (this.root = document.createElement('div'));
    r.className = 'hud';
    r.innerHTML = `
      <div class="plates"></div>
      <div class="vignette-hurt"></div>
      <div class="poison-tint"></div>
      <div class="hud-tl">
        <span class="chip" data-k="alive">👤 8/8</span>
        <span class="chip" data-k="time">⏱ 3:00</span>
        <span class="chip" data-k="score">⭐ 0</span>
        <span class="chip" data-k="cubes">🟩 0</span>
      </div>
      <div class="hud-tr">
        <div class="minimap-wrap">
          <button class="btn white icon-btn pause-btn" aria-label="pause">⏸</button>
          <canvas class="minimap"></canvas>
        </div>
        <div class="killfeed"></div>
      </div>
      <div class="hud-bottom ${touch ? 'hidden' : ''}">
        <div class="chip gadget-pc" data-k="gadget">✨ ×3 <span class="keyhint">Space</span></div>
        <div class="super-pc"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="bg"/><circle cx="50" cy="50" r="44" class="fg" style="stroke-dashoffset:276.5"/></svg><span>⭐</span><b class="stock"></b></div>
        <div class="keyhint">${t('controlsPc')}</div>
      </div>
      <div class="banners"></div>
      <div class="stats-overlay hidden"></div>`;
    parent.appendChild(r);
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.el.plates = r.querySelector('.plates')!;
    this.el.killfeed = r.querySelector('.killfeed')!;
    this.el.banners = r.querySelector('.banners')!;
    this.el.hurt = r.querySelector('.vignette-hurt')!;
    this.el.poison = r.querySelector('.poison-tint')!;
    this.el.superPc = r.querySelector('.super-pc')!;
    this.el.stats = r.querySelector('.stats-overlay')!;
    (r.querySelector('.pause-btn') as HTMLElement).addEventListener('click', () => this.onPause?.());
    const mc = r.querySelector('.minimap') as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    mc.width = mc.height = Math.round(118 * dpr);
    this.mini = mc.getContext('2d')!;
    this.miniBase = this.buildMiniBase(mc.width);
    for (const f of world.fighters) this.makePlate(f);
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('div');
      d.className = 'dmg'; d.style.display = 'none';
      this.el.plates.appendChild(d);
      this.dmg.push({ el: d, x: 0, y: 0, z: 0, t: 0, life: 1, vx: 0, active: false, key: '', amount: 0, prefix: '' });
    }
  }

  setLocal(id: string) { this.localId = id; }
  showStats(on: boolean) { this.el.stats.classList.toggle('hidden', !on); }

  private makePlate(f: Fighter) {
    const el = document.createElement('div');
    const me = f.id === this.localId;
    el.className = 'plate' + (me ? ' me' : '');
    el.innerHTML = `<div class="tags"></div><div class="nm">${escapeHtml(f.name)}</div><div class="hp"><i class="lag"></i><i></i><span class="hpn"></span></div>${me ? '<div class="ammo"><b><i></i></b><b><i></i></b><b><i></i></b></div>' : ''}<span class="reveal hidden">!</span>`;
    this.el.plates.appendChild(el);
    const [lag, hp] = Array.from(el.querySelectorAll('.hp i')) as HTMLElement[];
    this.plates.set(f.id, {
      el, hp, lag, hpn: el.querySelector('.hpn')!, tags: el.querySelector('.tags')!, reveal: el.querySelector('.reveal')!,
      ammo: me ? (Array.from(el.querySelectorAll('.ammo b i')) as HTMLElement[]) : undefined, last: '',
    });
  }

  private buildMiniBase(size: number) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    drawMapPreview(c.getContext('2d')!, this.world.map, size);
    return c;
  }

  private drawMinimap(viewer: Fighter | undefined) {
    const g = this.mini, size = g.canvas.width, w = this.world, half = w.map.half, k = size / (half * 2);
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.clip();
    g.drawImage(this.miniBase, 0, 0);
    // destroyed crates/rocks
    g.fillStyle = themeFor(w.map.theme).minimap.base;
    for (const o of w.map.obstacles) if (!o.alive && o.type !== 'tree') { g.beginPath(); g.arc((o.x + half) * k, (o.y + half) * k, 2.2, 0, Math.PI * 2); g.fill(); }
    if (w.poisonActive) {
      g.fillStyle = 'rgba(178,139,224,0.6)';
      const r = w.poisonRadius * k, c = size / 2;
      g.fillRect(0, 0, size, c - r); g.fillRect(0, c + r, size, size); g.fillRect(0, c - r, c - r, r * 2); g.fillRect(c + r, c - r, size, r * 2);
    }
    for (const p of w.pickups) { g.fillStyle = p.kind === 'cube' ? '#3FBF8F' : p.kind === 'super' ? '#FFC400' : '#FF8FB8'; g.fillRect((p.x + half) * k - 2, (p.y + half) * k - 2, 4, 4); }
    for (const f of w.fighters) {
      if (!f.alive) continue;
      const me = f.id === viewer?.id;
      const recent = w.time - f.lastAttackAt < 1500;
      if (!me && !(recent && w.visible(viewer?.id ?? null, f))) continue;
      g.fillStyle = me ? '#FFFFFF' : '#FF7A7A';
      g.strokeStyle = '#4A3B5C'; g.lineWidth = 2;
      g.beginPath(); g.arc((f.x + half) * k, (f.y + half) * k, me ? 5 : 4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
  }

  update(viewerId: string | null, camera: THREE.Camera, alpha: number, dt: number, renderer?: THREE.WebGLRenderer) {
    const w = this.world;
    const W = window.innerWidth, H = window.innerHeight;
    const viewer = viewerId ? w.byId.get(viewerId) : undefined;
    const me = w.byId.get(this.localId)!;

    // nameplates
    for (const f of w.fighters) {
      const p = this.plates.get(f.id)!;
      const show = f.alive && w.visible(viewerId, f);
      if (!show) { if (p.el.style.display !== 'none') p.el.style.display = 'none'; continue; }
      const x = f.px + (f.x - f.px) * alpha, z = f.py + (f.y - f.py) * alpha;
      this.v.set(x, 2.35, z).project(camera);
      if (this.v.z > 1) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      p.el.style.transform = `translate(${((this.v.x + 1) / 2) * W}px, ${((1 - this.v.y) / 2) * H}px) translate(-50%, -100%)`;
      const hpk = Math.max(0, f.hp / f.maxHp);
      p.hp.style.transform = `scaleX(${hpk})`;
      p.lag.style.transform = `scaleX(${hpk})`;
      const hpText = String(Math.ceil(f.hp));
      if (p.hpn.textContent !== hpText) p.hpn.textContent = hpText;
      if (p.ammo) {
        const wd = weaponOf(CHAR_BY_ID[f.charId]);
        for (let i = 0; i < 3; i++) {
          const fill = i < Math.floor(f.ammo) ? 1 : i === Math.floor(f.ammo) ? f.reloadT / wd.reloadMs : 0;
          p.ammo[i].style.transform = `scaleX(${fill})`;
        }
      }
      const tags = `${f.id === w.crownId ? '👑' : ''}${f.cubes ? `<span class="cube">🟩${f.cubes}</span>` : ''}${f.inBush >= 0 && f.id === viewerId ? '<span>👁️</span>' : ''}${w.time < f.stunUntil ? '💫' : w.time < f.slowUntil ? '🐌' : ''}${w.time < f.shieldUntil ? '🛡️' : ''}`;
      if (tags !== p.last) { p.tags.innerHTML = tags; p.last = tags; }
      const revealed = f.inBush >= 0 && f.id !== viewerId && w.time < f.revealedUntil;
      p.reveal.classList.toggle('hidden', !revealed);
    }

    // damage numbers
    for (const d of this.dmg) {
      if (!d.active) continue;
      d.t += dt;
      const k = d.t / d.life;
      if (k >= 1) { d.active = false; d.el.style.display = 'none'; continue; }
      this.v.set(d.x + d.vx * d.t, d.y + Math.sin(Math.min(1, k * 2.2) * Math.PI * 0.5) * 1.1, d.z).project(camera);
      const sc = k < 0.15 ? 0.5 + (k / 0.15) * 0.9 : k < 0.3 ? 1.4 - ((k - 0.15) / 0.15) * 0.4 : 1;
      d.el.style.transform = `translate(${((this.v.x + 1) / 2) * W}px, ${((1 - this.v.y) / 2) * H}px) translate(-50%, -50%) scale(${sc})`;
      d.el.style.opacity = String(Math.min(1, (1 - k) * 3));
    }

    // top-left chips
    const left = Math.max(0, w.cfg.durationMs - w.time);
    this.setText('alive', `👤 ${w.aliveCount}/${w.fighters.length}`);
    this.setText('time', w.cfg.mode === 'tutorial' ? '⏱ ∞' : `⏱ ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`);
    this.setText('score', `⭐ ${me.score}`);
    this.setText('cubes', `🟩 ${me.cubes}`);
    const fg = this.el.superPc.querySelector('.fg') as SVGCircleElement;
    fg.style.strokeDashoffset = String(276.5 * (1 - me.superCharge));
    this.el.superPc.classList.toggle('ready', me.superCharge >= 1);
    const stock = me.superStock > 0 ? `×${me.superStock + 1}` : '';
    const sb = this.el.superPc.querySelector('.stock') as HTMLElement;
    if (sb.textContent !== stock) sb.textContent = stock;
    const gLeft = me.gadgetUses < RULES.gadgetUses ? Math.ceil((RULES.gadgetRechargeMs - me.gadgetRecharge) / 1000) : 0;
    this.setText('gadget', `✨ ×${me.gadgetUses}${gLeft ? ` · ⏳${gLeft}s` : ''}`, true);
    this.el.hurt.classList.toggle('on', me.alive && me.hp / me.maxHp < 0.3);
    this.el.poison.classList.toggle('on', !!viewer && viewer.alive && w.inPoison(viewer.x, viewer.y));

    this.miniT -= dt;
    if (this.miniT <= 0) { this.miniT = 0.1; this.drawMinimap(viewer ?? me); }

    // perf overlay
    this.frames++; this.statsT += dt;
    if (this.statsT >= 0.5 && renderer && !this.el.stats.classList.contains('hidden')) {
      const info = renderer.info;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      this.lastStats = `FPS ${Math.round(this.frames / this.statsT)}\nDraw ${info.render.calls}\nTris ${(info.render.triangles / 1000).toFixed(1)}k\nGeo ${info.memory.geometries} Tex ${info.memory.textures}${mem ? `\nHeap ${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB` : ''}\nSim ${w.projectiles.length} proj`;
      this.el.stats.textContent = this.lastStats;
      this.frames = 0; this.statsT = 0;
    } else if (this.statsT >= 0.5) { this.frames = 0; this.statsT = 0; }
  }

  private setText(k: string, s: string, html = false) {
    if (this.shown[k] === s) return;
    this.shown[k] = s;
    if (html) this.el[k].firstChild!.textContent = s + ' '; else this.el[k].textContent = s;
  }

  /**
   * Damage number that stacks: rapid hits on the same target within 0.45s merge into one
   * growing number that re-pops each time (gatling bursts read as one big satisfying hit).
   */
  damage(key: string, x: number, z: number, amount: number, cls: string, prefix = '') {
    const d = this.dmg.find((q) => q.active && q.key === key && q.t < 0.45);
    if (d) {
      d.amount += amount;
      d.t = 0.02; d.x = x; d.z = z;
      d.el.textContent = d.prefix + d.amount;
      const big = d.amount >= 1500;
      d.el.className = 'dmg ' + cls + (big ? ' crit' : '');
      d.life = big ? 1.0 : 0.85;
      return;
    }
    this.number(x, z, prefix + amount, cls);
    const n = this.dmg.find((q) => q.active && q.t === 0 && q.key === '');
    if (n) { n.key = key; n.amount = amount; n.prefix = prefix; }
  }

  /** Red wedge around the screen centre pointing toward an attacker (screen angle, radians). */
  hurtFrom(angle: number) {
    const w = document.createElement('div');
    w.className = 'hurt-dir';
    w.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    this.root.appendChild(w);
    setTimeout(() => w.remove(), 700);
  }

  number(x: number, z: number, text: string, cls: string) {
    const d = this.dmg.find((q) => !q.active) ?? this.dmg[0];
    d.key = ''; d.amount = 0; d.prefix = '';
    d.active = true; d.t = 0; d.life = cls.includes('crit') ? 1.0 : 0.8;
    d.x = x + (Math.random() - 0.5) * 0.5; d.y = 1.6; d.z = z; d.vx = (Math.random() - 0.5) * 0.8;
    d.el.className = 'dmg ' + cls;
    d.el.textContent = text;
    d.el.style.display = '';
  }

  banner(text: string, cls = '', ms = 1600) {
    const b = document.createElement('div');
    b.className = `banner stroke ${cls}`;
    b.textContent = text;
    b.style.animationDuration = `${ms}ms`;
    this.el.banners.appendChild(b);
    setTimeout(() => b.remove(), ms);
  }

  killfeed(killer: Fighter | null, victim: Fighter) {
    const k = document.createElement('div');
    const mine = killer?.id === this.localId || victim.id === this.localId;
    k.className = 'kf' + (mine ? ' me' : '');
    const img = (f: Fighter) => `<img src="${this.portraits[f.charId]}" style="width:1.6em;height:1.6em;object-fit:contain">`;
    k.innerHTML = killer ? `${img(killer)}<span>${escapeHtml(killer.name)}</span><span class="ar">➜</span>${img(victim)}<span>${escapeHtml(victim.name)}</span>` : `☠️<span class="ar">➜</span>${img(victim)}<span>${escapeHtml(victim.name)}</span>`;
    this.el.killfeed.prepend(k);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.lastChild!.remove();
    setTimeout(() => k.remove(), 4500);
  }

  emote(id: string, i: number) {
    const p = this.plates.get(id); if (!p) return;
    p.el.querySelector('.emote')?.remove();
    const e = document.createElement('div');
    e.className = 'emote';
    e.textContent = EMOTES[i] ?? '😆';
    p.el.appendChild(e);
    setTimeout(() => e.remove(), 1800);
  }

  scoreboard(show: boolean) {
    this.root.querySelector('.scoreboard')?.remove();
    if (!show) return;
    const sb = document.createElement('div');
    sb.className = 'scoreboard panel';
    const rows = [...this.world.fighters].sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.score - a.score);
    sb.innerHTML = `<h2 style="margin:0 0 .4em;text-align:center">${t('score')}</h2>` + rows.map((f, i) => `
      <div class="sb-row ${f.id === this.localId ? 'me' : ''} ${f.alive ? '' : 'dead'}">
        <span>${f.alive ? i + 1 : f.place ? '#' + f.place : ''}</span><img src="${this.portraits[f.charId]}"><span>${escapeHtml(f.name)}${f.id === this.world.crownId ? ' 👑' : ''}</span><span>⚔️${f.kills}</span><span>⭐${f.score}</span>
      </div>`).join('');
    this.root.appendChild(sb);
  }

  emoteWheel(show: boolean) {
    this.root.querySelector('.emote-wheel')?.remove();
    if (!show) return;
    const wh = document.createElement('div');
    wh.className = 'emote-wheel';
    EMOTES.forEach((e, i) => {
      const b = document.createElement('button');
      b.className = 'btn white';
      b.textContent = e;
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      b.style.left = `calc(50% + ${Math.cos(a) * 4.6}em - 2.1em)`;
      b.style.top = `calc(50% + ${Math.sin(a) * 4.6}em - 2.1em)`;
      b.addEventListener('pointerup', () => { this.onEmote?.(i); wh.remove(); });
      wh.appendChild(b);
    });
    const bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;z-index:-1';
    bg.addEventListener('pointerup', () => wh.remove());
    wh.appendChild(bg);
    this.root.appendChild(wh);
  }

  onEvent(e: GameEvent) {
    void e;
  }

  dispose() { this.root.remove(); }
}

/** Top-down map thumbnail in theme colours (minimap base + lobby map cards). */
export function drawMapPreview(g: CanvasRenderingContext2D, map: World['map'], size: number) {
  const half = map.half, k = size / (half * 2);
  const M = themeFor(map.theme).minimap;
  const X = (v: number) => (v + half) * k;
  g.fillStyle = M.base; g.fillRect(0, 0, size, size);
  g.strokeStyle = M.path; g.lineWidth = 2.4 * k; g.lineCap = 'round';
  for (const s of map.spawns) { g.beginPath(); g.moveTo(X(s.x), X(s.y)); g.lineTo(X(0), X(0)); g.stroke(); }
  g.fillStyle = M.path; g.beginPath(); g.arc(size / 2, size / 2, 7 * k, 0, Math.PI * 2); g.fill();
  for (const z of map.slipZones) { g.fillStyle = M.ice; g.beginPath(); g.arc(X(z.x), X(z.y), z.r * k, 0, Math.PI * 2); g.fill(); }
  for (const b of map.bushes) { g.fillStyle = M.bush; g.beginPath(); g.arc(X(b.x), X(b.y), b.r * k, 0, Math.PI * 2); g.fill(); }
  for (const o of map.obstacles) {
    g.fillStyle = o.type === 'water' ? M.water : o.type === 'tree' ? M.tree : o.type === 'crate' ? M.crate : M.rock;
    g.beginPath(); g.arc(X(o.x), X(o.y), Math.max(1.2, (o.shape === 'box' ? o.hw : o.r) * k), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#FFFFFF'; g.strokeStyle = 'rgba(74,59,92,0.6)'; g.lineWidth = 1;
  for (const s of map.spawns) { g.beginPath(); g.arc(X(s.x), X(s.y), Math.max(2, 1.4 * k), 0, Math.PI * 2); g.fill(); g.stroke(); }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
