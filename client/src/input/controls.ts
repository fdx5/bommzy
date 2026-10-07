import * as THREE from 'three';
import { emptyInput, type PlayerInput } from '@pastel/shared';

export interface ControlSettings {
  stickSize: number;     // px radius
  stickOpacity: number;  // 0..1
  leftHanded: boolean;
  aimSensitivity: number;
  vibration: boolean;
}

export interface AimPreview { active: boolean; isSuper: boolean; angle: number; dist: number; strength: number }

type StickMode = 'attack' | 'super' | 'gadget';

interface Drag {
  id: number; ox: number; oy: number; x: number; y: number; manual: boolean; t0: number; mode: StickMode; cancelled: boolean;
  /** started from the last fired direction (virtual stick origin offset so the thumb sits on that aim) */
  resumed: boolean; sx: number; sy: number;
}
type Aim = { angle: number; dist: number };
/** Hold this long without moving and release → fire along the resumed (last) aim instead of auto-aim. */
const RESUME_HOLD_MS = 180;

/** Unified keyboard/mouse · twin-stick touch · gamepad input. */
export class Controls {
  touchMode: boolean;
  private keys = new Set<string>();
  private mouse = new THREE.Vector2();
  private mouseIn = false;
  private mouseDown = false;
  private superHeld = false;
  private pendingFire = false;
  private pendingAuto = false;
  private pendingSuper = false;
  private pendingSuperAuto = false;
  private pendingGadget = false;
  pendingEmote = -1;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private aimWorld = new THREE.Vector3();
  private hasMouseAim = false;
  // touch
  readonly root: HTMLElement;
  private moveStick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private drag: Drag | null = null;
  private el: Record<string, HTMLElement> = {};
  private moveVec = new THREE.Vector2();
  private dragAim = { angle: 0, dist: 0 };
  private releaseAim: Aim | null = null;
  /** last manually fired aim per stick, so the next drag starts from it instead of re-centring */
  private lastAim: Partial<Record<StickMode, Aim>> = {};
  // gamepad
  private padFireHeld = false;
  private padPrev: boolean[] = [];
  private padAim = new THREE.Vector2();
  enabled = false;
  onScoreboard?: (show: boolean) => void;
  onEmoteWheel?: (show: boolean) => void;
  onPause?: () => void;

  constructor(private canvas: HTMLCanvasElement, private camera: THREE.Camera, uiRoot: HTMLElement, public settings: ControlSettings) {
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    uiRoot.appendChild(this.root);
    this.buildTouch();
    this.bindKeyboardMouse();
    this.applySettings();
  }

  applySettings() {
    const s = this.settings;
    this.root.style.setProperty('--stick', `${s.stickSize}px`);
    this.root.style.setProperty('--stick-opacity', `${s.stickOpacity}`);
    this.root.classList.toggle('left-handed', s.leftHanded);
    this.root.classList.toggle('hidden', !this.touchMode);
  }

  setVisible(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  private buildTouch() {
    const mk = (cls: string, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; this.root.appendChild(d); return d; };
    this.el.moveZone = mk('tc-move-zone');
    this.el.moveBase = mk('tc-stick tc-move-base', '<div class="tc-knob"></div>');
    this.el.attack = mk('tc-btn tc-attack', '<div class="tc-ring"></div><div class="tc-knob"></div><span class="tc-ico">🎯</span>');
    this.el.super = mk('tc-btn tc-super', '<svg class="tc-gauge" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="bg"/><circle cx="50" cy="50" r="44" class="fg"/></svg><div class="tc-knob"></div><span class="tc-ico">⭐</span><b class="tc-count tc-stock"></b>');
    this.el.gadget = mk('tc-btn tc-gadget', '<span class="tc-ico">✨</span><b class="tc-count">3</b>');
    this.el.emote = mk('tc-btn tc-emote', '<span class="tc-ico">😊</span>');
    this.el.moveBase.style.opacity = '0';

    const opt = { passive: false } as AddEventListenerOptions;
    this.el.moveZone.addEventListener('pointerdown', (e) => {
      if (this.moveStick) return;
      e.preventDefault();
      this.el.moveZone.setPointerCapture(e.pointerId);
      this.moveStick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      const b = this.el.moveBase;
      b.style.left = `${e.clientX}px`; b.style.top = `${e.clientY}px`; b.style.opacity = '1';
      b.classList.add('active');
      this.updateKnob(b, 0, 0);
    }, opt);
    this.el.moveZone.addEventListener('pointermove', (e) => {
      const m = this.moveStick; if (!m || m.id !== e.pointerId) return;
      m.x = e.clientX; m.y = e.clientY;
      const R = this.settings.stickSize;
      let dx = m.x - m.ox, dy = m.y - m.oy;
      const d = Math.hypot(dx, dy);
      // drag the base along when the thumb overshoots (floating stick)
      if (d > R * 1.25) { const k = (d - R * 1.25) / d; m.ox += dx * k; m.oy += dy * k; dx = m.x - m.ox; dy = m.y - m.oy; this.el.moveBase.style.left = `${m.ox}px`; this.el.moveBase.style.top = `${m.oy}px`; }
      this.updateKnob(this.el.moveBase, dx, dy);
    }, opt);
    const endMove = (e: PointerEvent) => {
      if (!this.moveStick || this.moveStick.id !== e.pointerId) return;
      this.moveStick = null;
      this.el.moveBase.classList.remove('active');
      this.el.moveBase.style.opacity = '0.0';
    };
    this.el.moveZone.addEventListener('pointerup', endMove);
    this.el.moveZone.addEventListener('pointercancel', endMove);

    const bindStick = (el: HTMLElement, mode: StickMode) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.drag) return;
        el.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        let ox = r.left + r.width / 2, oy = r.top + r.height / 2;
        const last = mode === 'gadget' ? undefined : this.lastAim[mode];
        if (last) {
          // put the virtual stick origin behind the thumb so the stick already points along the last shot
          const R = this.settings.stickSize, dead = R * 0.22;
          const L = dead + Math.max(0.08, Math.min(1, last.dist / this.settings.aimSensitivity)) * (R - dead);
          ox = e.clientX - Math.cos(last.angle) * L; oy = e.clientY - Math.sin(last.angle) * L;
          this.dragAim.angle = last.angle; this.dragAim.dist = last.dist;
          this.updateKnob(el, Math.cos(last.angle) * Math.min(L, R) * 0.8, Math.sin(last.angle) * Math.min(L, R) * 0.8);
        }
        this.drag = { id: e.pointerId, ox, oy, x: e.clientX, y: e.clientY, manual: false, t0: performance.now(), mode, cancelled: false, resumed: !!last, sx: e.clientX, sy: e.clientY };
        el.classList.add('pressed');
        if (mode === 'gadget') { this.pendingGadget = true; this.vibrate(15); }
      }, opt);
      el.addEventListener('pointermove', (e) => {
        const d = this.drag; if (!d || d.id !== e.pointerId || d.mode === 'gadget') return;
        d.x = e.clientX; d.y = e.clientY;
        const dx = d.x - d.ox, dy = d.y - d.oy, len = Math.hypot(dx, dy);
        const dead = this.settings.stickSize * 0.22;
        // resumed drags: only count as manual once the thumb actually moves (a still tap stays auto-aim)
        const moved = !d.resumed || Math.hypot(d.x - d.sx, d.y - d.sy) > 6;
        if (len > dead) { if (moved) d.manual = true; d.cancelled = false; }
        else if (d.manual) d.cancelled = true; // dragged back to centre → cancel
        const R = this.settings.stickSize;
        const k = Math.min(1, len / R);
        if (len > 1) { this.dragAim.angle = Math.atan2(dy, dx); this.dragAim.dist = Math.min(1, (len - dead) / (R - dead)) * this.settings.aimSensitivity; }
        this.updateKnob(el, (dx / (len || 1)) * k * R * 0.8, (dy / (len || 1)) * k * R * 0.8);
        el.classList.toggle('cancel', d.cancelled);
      }, opt);
      const up = (e: PointerEvent) => {
        const d = this.drag; if (!d || d.id !== e.pointerId) return;
        this.drag = null;
        el.classList.remove('pressed', 'cancel');
        this.updateKnob(el, 0, 0);
        if (d.mode === 'gadget' || d.cancelled) return;
        if (!d.manual && d.resumed && performance.now() - d.t0 >= RESUME_HOLD_MS) d.manual = true; // held still → fire along last aim
        this.releaseAim = d.manual ? { ...this.dragAim } : null;
        if (d.manual) this.lastAim[d.mode] = { ...this.dragAim };
        if (d.mode === 'attack') { if (d.manual) this.pendingFire = true; else { this.pendingFire = true; this.pendingAuto = true; } }
        else { this.pendingSuper = true; this.pendingSuperAuto = !d.manual; }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', (e) => { if (this.drag?.id === e.pointerId) { this.drag = null; el.classList.remove('pressed'); this.updateKnob(el, 0, 0); } });
    };
    bindStick(this.el.attack, 'attack');
    bindStick(this.el.super, 'super');
    bindStick(this.el.gadget, 'gadget');
    this.el.emote.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onEmoteWheel?.(true); });
  }

  private updateKnob(base: HTMLElement, dx: number, dy: number) {
    const R = this.settings.stickSize;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    const k = base.querySelector('.tc-knob') as HTMLElement | null;
    if (k) k.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (base === this.el.moveBase) this.moveVec.set(dx / R, dy / R);
  }

  private bindKeyboardMouse() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'tab') { e.preventDefault(); this.onScoreboard?.(true); }
      if (k === 'e' && !e.repeat) this.superHeld = true;
      if ((k === ' ' || k === 'q' || k === 'shift') && !e.repeat) { e.preventDefault(); this.pendingGadget = true; }
      if (k === 't' && !e.repeat) this.onEmoteWheel?.(true);
      if (['1', '2', '3', '4'].includes(k)) this.pendingEmote = +k - 1;
      if (k === 'escape') this.onPause?.();
      if (this.touchMode && !e.repeat && 'wasd'.includes(k)) { this.touchMode = false; this.applySettings(); }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') this.onScoreboard?.(false);
      if (k === 't') this.onEmoteWheel?.(false);
      if (k === 'e' && this.superHeld) { this.superHeld = false; if (this.enabled) this.pendingSuper = true; }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.mouseIn = true; this.hasMouseAim = true;
      if (this.touchMode) { this.touchMode = false; this.applySettings(); }
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !this.enabled) return;
      if (e.button === 0) { this.mouseDown = true; this.pendingFire = true; }
      if (e.button === 2) this.superHeld = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2 && this.superHeld) { this.superHeld = false; if (this.enabled) this.pendingSuper = true; }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerleave', () => { this.mouseIn = false; });
  }

  vibrate(ms: number | number[]) { if (this.settings.vibration && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* ignore */ } }

  setSuperState(charge: number, ready: boolean, stock = 0) {
    const fg = this.el.super.querySelector('.fg') as SVGCircleElement;
    fg.style.strokeDashoffset = `${276.5 * (1 - charge)}`;
    this.el.super.classList.toggle('ready', ready);
    // total supers available right now: the full gauge + banked ones
    const badge = this.el.super.querySelector('.tc-stock') as HTMLElement;
    const txt = stock > 0 ? `×${stock + 1}` : '';
    if (badge.textContent !== txt) badge.textContent = txt;
    badge.classList.toggle('on', stock > 0);
  }
  setGadgetState(uses: number, cooling: boolean) {
    (this.el.gadget.querySelector('.tc-count') as HTMLElement).textContent = String(uses);
    this.el.gadget.classList.toggle('disabled', uses <= 0 || cooling);
  }

  private pollGamepad(): { move: THREE.Vector2; aim: THREE.Vector2 | null; fire: boolean } | null {
    const pads = navigator.getGamepads?.();
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) return null;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const move = new THREE.Vector2(dz(gp.axes[0]), dz(gp.axes[1]));
    const aim = new THREE.Vector2(dz(gp.axes[2] ?? 0), dz(gp.axes[3] ?? 0));
    const pressed = (i: number) => !!gp.buttons[i]?.pressed;
    const edge = (i: number) => { const p = pressed(i), was = this.padPrev[i]; this.padPrev[i] = p; return p && !was; };
    const fire = pressed(7) || pressed(0);
    if (edge(5)) this.pendingSuper = true;
    if (edge(4) || edge(2)) this.pendingGadget = true;
    if (edge(3)) this.pendingEmote = 0;
    if (edge(9)) this.onPause?.();
    if (aim.lengthSq() > 0.1) this.padAim.copy(aim);
    return { move, aim: aim.lengthSq() > 0.1 ? aim : null, fire };
  }

  /** Build this tick's input. `px/pz` = player world position, `range` for aim distance scaling. */
  sample(px: number, pz: number, range: number, seq: number): PlayerInput {
    const inp = emptyInput();
    inp.seq = seq;
    if (!this.enabled) return inp;
    // movement
    let mx = 0, my = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
    if (this.moveStick) {
      const dead = 0.12;
      const l = this.moveVec.length();
      if (l > dead) { const k = Math.min(1, (l - dead) / (1 - dead)) / l; mx += this.moveVec.x * k; my += this.moveVec.y * k; }
    }
    const pad = this.pollGamepad();
    if (pad) { mx += pad.move.x; my += pad.move.y; }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    inp.moveX = mx; inp.moveY = my;

    // aim
    if (this.releaseAim) {
      inp.aimX = Math.cos(this.releaseAim.angle); inp.aimY = Math.sin(this.releaseAim.angle); inp.aimDist = Math.max(0.6, this.releaseAim.dist * range);
      this.releaseAim = null;
    } else if (this.drag && this.drag.manual && this.drag.mode !== 'gadget') {
      inp.aimX = Math.cos(this.dragAim.angle); inp.aimY = Math.sin(this.dragAim.angle); inp.aimDist = Math.max(0.6, this.dragAim.dist * range);
    } else if (pad?.aim) {
      inp.aimX = pad.aim.x; inp.aimY = pad.aim.y; inp.aimDist = Math.min(1, pad.aim.length()) * range;
    } else if (!this.touchMode && this.hasMouseAim) {
      this.ray.setFromCamera(this.mouse, this.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.aimWorld.copy(this.hit);
        inp.aimX = this.hit.x - px; inp.aimY = this.hit.z - pz; inp.aimDist = Math.hypot(inp.aimX, inp.aimY);
      }
    } else if (ml > 0.1) { inp.aimX = mx; inp.aimY = my; }

    // actions
    inp.fire = this.pendingFire || (this.mouseDown && !this.touchMode) || !!pad?.fire;
    inp.autoAim = this.pendingAuto;
    inp.superFire = this.pendingSuper;
    if (this.pendingSuper && this.pendingSuperAuto) inp.autoAim = true;
    inp.gadget = this.pendingGadget;
    if (inp.fire && this.pendingFire) this.vibrate(8);
    this.pendingFire = this.pendingAuto = this.pendingSuper = this.pendingSuperAuto = this.pendingGadget = false;
    return inp;
  }

  aimPreview(): AimPreview {
    const d = this.drag;
    if (d && d.mode !== 'gadget' && (d.manual || (d.resumed && performance.now() - d.t0 >= RESUME_HOLD_MS))) {
      return { active: true, isSuper: d.mode === 'super', angle: this.dragAim.angle, dist: this.dragAim.dist, strength: d.cancelled ? 0.25 : 1 };
    }
    if (this.padAim.lengthSq() > 0.1 && navigator.getGamepads?.()?.some((p) => p?.connected)) {
      return { active: true, isSuper: false, angle: Math.atan2(this.padAim.y, this.padAim.x), dist: Math.min(1, this.padAim.length()), strength: 0.8 };
    }
    if (!this.touchMode && this.mouseIn) return { active: true, isSuper: this.superHeld, angle: NaN, dist: NaN, strength: this.superHeld || this.mouseDown ? 1 : 0.45 };
    return { active: false, isSuper: false, angle: 0, dist: 0, strength: 0 };
  }

  get mouseWorld() { return this.aimWorld; }

  reset() {
    this.keys.clear(); this.mouseDown = false; this.superHeld = false; this.drag = null; this.moveStick = null; this.moveVec.set(0, 0); this.lastAim = {};
    this.pendingFire = this.pendingAuto = this.pendingSuper = this.pendingGadget = false; this.pendingEmote = -1;
  }
}
