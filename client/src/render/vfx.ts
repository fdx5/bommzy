import * as THREE from 'three';
import { toonMaterial } from './toon';

/**
 * Pooled GPU-instanced particles: one InstancedMesh, one draw call, zero per-frame allocation.
 * Shapes: 0 soft glow · 1 star · 2 ring · 3 solid puff · 4 sparkle · 5 heart · 6 leaf · 7 plus
 */
export const SHAPE = { glow: 0, star: 1, ring: 2, puff: 3, sparkle: 4, heart: 5, leaf: 6, plus: 7, shell: 8, streak: 9 } as const;

interface P {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  g: number; drag: number; life: number; max: number;
  s0: number; s1: number; a0: number; r: number; gr: number; gb: number;
  shape: number; rot: number; vr: number; flat: number; align: number;
}

export interface Burst {
  count?: number; color?: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  speed?: [number, number]; up?: [number, number]; gravity?: number; drag?: number;
  life?: [number, number]; size?: [number, number]; endSize?: number; alpha?: number;
  shape?: number; spread?: number; angle?: number; flat?: boolean; spin?: number; jitter?: number; y?: number; align?: boolean;
}

export class VFX {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private active = 0;
  private aOffset: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aParams: THREE.InstancedBufferAttribute;
  private tmp = new THREE.Color();
  private debris: Debris;

  constructor(scene: THREE.Scene, private cap: number) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOffset', this.aOffset);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aParams', this.aParams);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aOffset; attribute vec4 aColor; attribute vec4 aParams;
        varying vec2 vP; varying vec4 vColor; varying float vShape;
        void main() {
          float size = aParams.x, rot = aParams.w;
          vec2 q = position.xy;
          if (aParams.z > 8.5) q.x *= 3.0;
          float c = cos(rot), s = sin(rot);
          q = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
          vec4 mv;
          if (aColor.w > 0.5) mv = viewMatrix * vec4(aOffset + vec3(q.x, 0.0, q.y), 1.0);
          else { mv = viewMatrix * vec4(aOffset, 1.0); mv.xy += q; }
          gl_Position = projectionMatrix * mv;
          vP = position.xy * 2.0; vColor = vec4(aColor.rgb, aParams.y); vShape = aParams.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vP; varying vec4 vColor; varying float vShape;
        void main() {
          vec2 p = vP; float r = length(p); float a = 0.0; vec3 col = vColor.rgb;
          if (vShape < 0.5) { a = pow(max(0.0, 1.0 - r), 1.6); col *= 1.25; }
          else if (vShape < 1.5) { float an = atan(p.y, p.x); float k = 0.5 + 0.5 * cos(an * 5.0); float sr = mix(0.42, 1.0, pow(k, 3.0)); a = 1.0 - smoothstep(sr - 0.08, sr, r); col *= mix(1.15, 0.95, r); }
          else if (vShape < 2.5) { a = 1.0 - smoothstep(0.0, 0.12, abs(r - 0.82)); }
          else if (vShape < 3.5) { a = 1.0 - smoothstep(0.9, 1.0, r); col *= mix(0.84, 1.08, p.y * 0.5 + 0.5); }
          else if (vShape < 4.5) { float d = min(abs(p.x), abs(p.y)); a = (1.0 - smoothstep(0.0, 0.16, d)) * (1.0 - r) + pow(max(0.0, 1.0 - r * 1.6), 2.0); col *= 1.3; }
          else if (vShape < 5.5) { vec2 h = vec2(p.x, -p.y * 1.1 + 0.15); float hk = pow(h.x * h.x + h.y * h.y - 0.45, 3.0) - h.x * h.x * h.y * h.y * h.y; a = 1.0 - smoothstep(-0.02, 0.0, hk); }
          else if (vShape < 6.5) { vec2 l = vec2(p.x * 1.8, p.y); a = 1.0 - smoothstep(0.85, 1.0, length(l)); col *= mix(0.85, 1.1, p.x * 0.5 + 0.5); }
          else if (vShape < 7.5) { float b = step(abs(p.x), 0.28) * step(abs(p.y), 0.85) + step(abs(p.y), 0.28) * step(abs(p.x), 0.85); a = min(1.0, b); }
          else if (vShape < 8.5) { vec2 q = abs(p) - vec2(0.55, 0.22); float d = length(max(q, 0.0)) - 0.2; a = 1.0 - smoothstep(-0.05, 0.02, d); col *= mix(0.8, 1.15, p.y * 0.5 + 0.5); }
          else { float w = 1.0 - smoothstep(0.05, 0.32, abs(p.y)); float l = 1.0 - smoothstep(0.55, 1.0, abs(p.x)); a = w * l; col *= 1.3; }
          a *= vColor.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    for (let i = 0; i < cap; i++) this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, life: 0, max: 1, s0: 1, s1: 0, a0: 1, r: 1, gr: 1, gb: 1, shape: 0, rot: 0, vr: 0, flat: 0, align: 0 });
    this.debris = new Debris(scene);
  }

  private rnd(a: number, b: number) { return a + Math.random() * (b - a); }

  emit(x: number, y: number, z: number, o: Burst) {
    const n = o.count ?? 8;
    const cols = Array.isArray(o.color) ? o.color : [o.color ?? '#ffffff'];
    for (let i = 0; i < n; i++) {
      if (this.active >= this.cap) return;
      const p = this.ps[this.active++];
      const ang = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread ?? 0.6) : Math.random() * Math.PI * 2;
      const sp = this.rnd(...(o.speed ?? [1, 3]));
      const j = o.jitter ?? 0;
      p.x = x + (Math.random() - 0.5) * j; p.y = (o.y ?? y) + (Math.random() - 0.5) * j * 0.3; p.z = z + (Math.random() - 0.5) * j;
      p.vx = Math.cos(ang) * sp; p.vz = Math.sin(ang) * sp; p.vy = this.rnd(...(o.up ?? [0.5, 2]));
      p.g = o.gravity ?? 0; p.drag = o.drag ?? 2;
      p.max = p.life = this.rnd(...(o.life ?? [0.4, 0.8]));
      p.s0 = this.rnd(...(o.size ?? [0.2, 0.4])); p.s1 = p.s0 * (o.endSize ?? 0.2);
      p.a0 = o.alpha ?? 1;
      this.tmp.set(cols[i % cols.length]);
      p.r = this.tmp.r; p.gr = this.tmp.g; p.gb = this.tmp.b;
      p.shape = o.shape ?? SHAPE.puff; p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * (o.spin ?? 2);
      p.flat = o.flat ? 1 : 0;
      p.align = o.align ? 1 : 0;
    }
  }

  update(dt: number) {
    let n = this.active;
    const off = this.aOffset.array as Float32Array, col = this.aColor.array as Float32Array, par = this.aParams.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        n--; const last = this.ps[n]; this.ps[n] = p; this.ps[i] = last; i--; continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03 && p.g > 0) { p.y = 0.03; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
      if (p.align) p.rot = Math.atan2(p.vy * 0.8 - p.vz * 0.6, p.vx); // screen-space heading (camera looks down -z)
      else p.rot += p.vr * dt;
      const t = 1 - p.life / p.max;
      // pop-in then shrink: cute "boing"
      const grow = Math.min(1, t * 8);
      const size = (p.s0 + (p.s1 - p.s0) * t) * (0.6 + 0.4 * grow + Math.sin(Math.min(1, t * 6) * Math.PI) * 0.15);
      const alpha = p.a0 * Math.min(1, (1 - t) * 3);
      off[i * 3] = p.x; off[i * 3 + 1] = p.y; off[i * 3 + 2] = p.z;
      col[i * 4] = p.r; col[i * 4 + 1] = p.gr; col[i * 4 + 2] = p.gb; col[i * 4 + 3] = p.flat;
      par[i * 4] = size; par[i * 4 + 1] = alpha; par[i * 4 + 2] = p.shape; par[i * 4 + 3] = p.rot;
    }
    this.active = n;
    this.mesh.count = n;
    if (n) {
      this.aOffset.addUpdateRange(0, n * 3); this.aOffset.needsUpdate = true;
      this.aColor.addUpdateRange(0, n * 4); this.aColor.needsUpdate = true;
      this.aParams.addUpdateRange(0, n * 4); this.aParams.needsUpdate = true;
    }
    this.debris.update(dt);
  }

  // ─────────────────────────── recipes
  muzzle(x: number, z: number, angle: number, color: THREE.ColorRepresentation, big = false) {
    const hx = x + Math.cos(angle) * 0.7, hz = z + Math.sin(angle) * 0.7;
    this.emit(hx, 0.75, hz, { count: big ? 10 : 5, color: [color, '#ffffff'], angle, spread: 1.1, speed: [2, 5], up: [0.2, 1.2], life: [0.15, 0.3], size: [0.12, 0.26], shape: SHAPE.star, drag: 6 });
    this.emit(hx, 0.75, hz, { count: 1, color: '#ffffff', speed: [0, 0], up: [0, 0], life: [0.08, 0.1], size: [big ? 0.9 : 0.55, big ? 1 : 0.6], shape: SHAPE.glow, endSize: 1.4 });
  }
  /** Rapid-fire muzzle: short forward flame tongues on top of the regular flash. */
  gatlingFlash(x: number, z: number, angle: number, big = false) {
    const hx = x + Math.cos(angle) * 0.85, hz = z + Math.sin(angle) * 0.85;
    this.emit(hx, 0.75, hz, { count: big ? 4 : 2, color: ['#FFFFFF', '#FFD36B', '#FF9A2E'], angle, spread: 0.25, speed: [6, 10], up: [0, 0.3], drag: 12, life: [0.06, 0.1], size: [big ? 0.34 : 0.26, big ? 0.44 : 0.34], shape: SHAPE.streak, align: true });
  }
  shotgunPuff(x: number, z: number, angle: number) {
    const hx = x + Math.cos(angle) * 0.8, hz = z + Math.sin(angle) * 0.8;
    this.emit(hx, 0.7, hz, { count: 9, color: ['#FFFFFF', '#FFE9DC', '#F4E8FF'], angle, spread: 1.2, speed: [1.5, 4], up: [0.2, 1], life: [0.35, 0.6], size: [0.3, 0.55], endSize: 0.5, shape: SHAPE.puff, drag: 4 });
  }
  hit(x: number, z: number, color: THREE.ColorRepresentation, big = false) {
    this.emit(x, 0.8, z, { count: big ? 12 : 7, color: [color, '#ffffff'], speed: [2, big ? 6 : 4.5], up: [1, 3], gravity: 6, life: [0.25, 0.5], size: [0.12, 0.25], shape: SHAPE.star, drag: 3 });
    this.emit(x, 0.8, z, { count: 1, color: '#ffffff', speed: [0, 0], up: [0, 0], life: [0.12, 0.12], size: [0.9, 0.9], endSize: 1.6, shape: SHAPE.ring });
  }
  explosion(x: number, z: number, r: number, palette: THREE.ColorRepresentation[] = ['#FFFFFF', '#FFE3F0', '#FFE9C7', '#E9DEFF']) {
    this.emit(x, 0.4, z, { count: Math.round(10 + r * 6), color: palette, speed: [r * 1.2, r * 3], up: [0.5, 3], life: [0.5, 0.9], size: [0.5, 1.0 + r * 0.15], endSize: 0.3, shape: SHAPE.puff, drag: 3.5, jitter: r * 0.5 });
    this.emit(x, 0.1, z, { count: 1, color: '#ffffff', speed: [0, 0], up: [0, 0], life: [0.35, 0.35], size: [r * 1.2, r * 1.2], endSize: 2, shape: SHAPE.ring, flat: true });
    this.emit(x, 0.8, z, { count: 14, color: ['#FFF5BA', '#FFFFFF', '#FFC8DD'], speed: [r * 2, r * 4], up: [2, 5], gravity: 9, life: [0.4, 0.8], size: [0.15, 0.25], shape: SHAPE.star, drag: 1.5 });
    this.emit(x, 0.5, z, { count: 1, color: '#FFFFFF', speed: [0, 0], up: [0, 0], life: [0.15, 0.15], size: [r * 2.2, r * 2.2], endSize: 1.4, shape: SHAPE.glow });
  }
  dust(x: number, z: number, n = 2) {
    this.emit(x, 0.08, z, { count: n, color: ['#F4ECDD', '#EFE6F7'], speed: [0.3, 1], up: [0.3, 0.8], life: [0.35, 0.6], size: [0.18, 0.3], endSize: 0.6, shape: SHAPE.puff, drag: 4, jitter: 0.3 });
  }
  leaves(x: number, z: number, n = 10) {
    this.emit(x, 0.7, z, { count: n, color: ['#9ED79A', '#B8E6A8', '#86C98D'], speed: [1.5, 3.5], up: [1.5, 3.5], gravity: 4, life: [0.6, 1.1], size: [0.14, 0.24], endSize: 0.8, shape: SHAPE.leaf, drag: 2.5, spin: 8 });
  }
  heal(x: number, z: number) {
    this.emit(x, 0.6, z, { count: 6, color: ['#A8E6CF', '#C9F5DF'], speed: [0.2, 0.8], up: [1.2, 2.2], life: [0.6, 1], size: [0.2, 0.3], endSize: 0.6, shape: SHAPE.plus, drag: 1, jitter: 0.8 });
  }
  sparkle(x: number, y: number, z: number, color: THREE.ColorRepresentation = '#FFF5BA', n = 6, r = 0.6) {
    this.emit(x, y, z, { count: n, color: [color, '#ffffff'], speed: [0.2, 1.2], up: [0.2, 1.5], life: [0.4, 0.9], size: [0.12, 0.22], shape: SHAPE.sparkle, drag: 2, jitter: r });
  }
  trail(x: number, y: number, z: number, color: THREE.ColorRepresentation, size = 0.18, shape: number = SHAPE.glow, life = 0.25) {
    this.emit(x, y, z, { count: 1, color, speed: [0, 0.2], up: [0, 0.1], life: [life * 0.8, life], size: [size, size * 1.2], endSize: 0.1, shape, drag: 1 });
  }
  starPop(x: number, y: number, z: number, palette: THREE.ColorRepresentation[]) {
    this.emit(x, y, z, { count: 18, color: palette, speed: [2, 5], up: [2, 6], gravity: 5, life: [0.6, 1.1], size: [0.18, 0.34], shape: SHAPE.star, drag: 1.2, spin: 6 });
    this.emit(x, y, z, { count: 8, color: '#FFFFFF', speed: [1, 3], up: [0, 2], life: [0.4, 0.6], size: [0.5, 0.8], endSize: 0.2, shape: SHAPE.puff, drag: 3 });
  }
  hearts(x: number, z: number) {
    this.emit(x, 1.6, z, { count: 5, color: ['#FF9EBB', '#FFC8DD'], speed: [0.3, 1], up: [1, 2], life: [0.8, 1.2], size: [0.2, 0.3], shape: SHAPE.heart, drag: 1.5 });
  }
  rockBurst(x: number, z: number, r = 1) {
    this.emit(x, 0.5, z, { count: 14, color: ['#F2EEF8', '#E3DDF2', '#FFFFFF'], speed: [1, 3.5], up: [0.5, 2], life: [0.6, 1.2], size: [0.5, 0.9], endSize: 0.4, shape: SHAPE.puff, drag: 3, jitter: r });
    this.debris.burst(x, z, 8, 'rock');
  }
  crateBurst(x: number, z: number) {
    this.emit(x, 0.6, z, { count: 10, color: ['#FFF1E0', '#FFE3C9'], speed: [1, 3], up: [0.5, 2], life: [0.5, 0.9], size: [0.4, 0.7], endSize: 0.3, shape: SHAPE.puff, drag: 3, jitter: 0.8 });
    this.debris.burst(x, z, 7, 'wood');
  }
  /** Super cast: radial light streaks + double shockwave + core flash. */
  superBurst(x: number, z: number, color: THREE.ColorRepresentation, angle: number) {
    this.emit(x, 0.9, z, { count: 16, color: [color, '#FFFFFF', '#FFF5BA'], spread: Math.PI * 2, speed: [9, 15], up: [0, 0.6], drag: 6, life: [0.22, 0.35], size: [0.22, 0.32], shape: SHAPE.streak, align: true });
    this.emit(x, 0.9, z, { count: 10, color: [color, '#FFFFFF'], angle, spread: 0.5, speed: [10, 16], up: [0, 0.4], drag: 5, life: [0.18, 0.28], size: [0.3, 0.42], shape: SHAPE.streak, align: true });
    this.emit(x, 1.0, z, { count: 1, color: '#FFFFFF', speed: [0, 0], up: [0, 0], life: [0.18, 0.18], size: [2.6, 2.6], endSize: 1.6, shape: SHAPE.glow });
    this.shockRing(x, z, 2.6, '#FFFFFF', 0.3);
    this.shockRing(x, z, 3.6, color, 0.5);
  }
  /** Big super explosion add-on: a second, wider ring and a shower of hot sparks. */
  superBlast(x: number, z: number, r: number, color: THREE.ColorRepresentation) {
    this.emit(x, 0.6, z, { count: Math.round(14 + r * 4), color: [color, '#FFFFFF', '#FFE27A'], spread: Math.PI * 2, speed: [r * 3, r * 5.5], up: [3, 7], gravity: 14, drag: 1.2, life: [0.5, 0.9], size: [0.14, 0.24], shape: SHAPE.streak, align: true });
    this.shockRing(x, z, r * 1.6, color, 0.55);
    this.emit(x, 0.1, z, { count: 1, color: '#FFFFFF', speed: [0, 0], up: [0, 0], life: [0.5, 0.5], size: [r * 0.8, r * 0.8], endSize: 3.2, shape: SHAPE.ring, flat: true });
  }
  shockRing(x: number, z: number, r: number, color: THREE.ColorRepresentation = '#ffffff', life = 0.4) {
    this.emit(x, 0.08, z, { count: 1, color, speed: [0, 0], up: [0, 0], life: [life, life], size: [r * 0.3, r * 0.3], endSize: 6.5, shape: SHAPE.ring, flat: true });
  }
  /**
   * Continuous light trail along the segment a projectile just travelled: streaks every `step`
   * metres so fast shots leave an unbroken ribbon instead of dotted puffs.
   */
  tracer(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.ColorRepresentation, width = 0.3, life = 0.28, step = 0.3) {
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const ang = Math.atan2(dz, dx);
    const n = Math.min(12, Math.ceil(d / step));
    for (let i = 0; i < n; i++) {
      const k = (i + Math.random()) / n;
      this.emit(x0 + dx * k, y, z0 + dz * k, { count: 1, color, angle: ang, spread: 0, speed: [0.6, 0.6], up: [0, 0], drag: 0, life: [life * 0.85, life], size: [width, width], endSize: 0.25, shape: SHAPE.streak, align: true });
    }
  }
  /** Ejected casing: pops out sideways, bounces on the ground. */
  shell(x: number, z: number, angle: number, big = false) {
    const side = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    this.emit(x + Math.cos(angle) * 0.3, 0.9, z + Math.sin(angle) * 0.3, { count: 1, color: big ? '#FF9E9E' : '#FFD36B', angle: side, spread: 0.3, speed: [1.5, 2.6], up: [2.5, 3.5], gravity: 14, drag: 0.6, life: [0.7, 0.9], size: [big ? 0.16 : 0.11, big ? 0.18 : 0.13], endSize: 0.8, shape: SHAPE.shell, spin: 22 });
  }
  /** Weapon-specific impact burst; `ang` = direction the shot travelled. */
  impact(kind: string, x: number, z: number, ang: number, big = false) {
    const k = big ? 1.6 : 1;
    switch (kind) {
      case 'bullet': case 'gatling':
        this.emit(x, 0.8, z, { count: Math.round(9 * k), color: ['#FFB020', '#FFE27A', '#FFFFFF'], angle: ang, spread: 1.8, speed: [5, 10], up: [0.5, 3], gravity: 10, drag: 3.5, life: [0.14, 0.3], size: [0.12, 0.2], endSize: 0.3, shape: SHAPE.streak, align: true });
        this.emit(x, 0.8, z, { count: 1, color: '#FFD36B', speed: [0, 0], up: [0, 0], life: [0.1, 0.1], size: [0.5 * k, 0.5 * k], endSize: 2, shape: SHAPE.ring });
        break;
      case 'pellet': case 'bigbang':
        this.emit(x, 0.75, z, { count: Math.round(5 * k), color: ['#FFFFFF', '#FFE9DC'], angle: ang, spread: 1.4, speed: [1.5, 3.5], up: [0.5, 1.5], drag: 4, life: [0.25, 0.4], size: [0.25, 0.4], endSize: 0.4, shape: SHAPE.puff });
        this.emit(x, 0.8, z, { count: Math.round(5 * k), color: ['#FF7A2E', '#FFB067', '#FFFFFF'], angle: ang, spread: 1.2, speed: [5, 9], up: [0.5, 2], gravity: 6, drag: 4, life: [0.12, 0.22], size: [0.12, 0.18], shape: SHAPE.streak, align: true });
        break;
      case 'arrow': case 'meteor':
        this.emit(x, 0.85, z, { count: Math.round(8 * k), color: ['#B5DEFF', '#FFF5BA', '#FFFFFF'], speed: [2, 6], up: [1, 3], gravity: 6, drag: 3, life: [0.3, 0.55], size: [0.16, 0.28], shape: SHAPE.star, spin: 8 });
        this.emit(x, 0.85, z, { count: Math.round(5 * k), color: '#FFFFFF', angle: ang, spread: 0.7, speed: [7, 12], up: [0, 1], drag: 5, life: [0.12, 0.2], size: [0.14, 0.2], shape: SHAPE.streak, align: true });
        break;
      case 'boomerang': case 'tornado':
        this.emit(x, 0.8, z, { count: Math.round(7 * k), color: ['#FFF5BA', '#FFE27A', '#FFFFFF'], angle: ang + Math.PI / 2, spread: Math.PI, speed: [3, 6], up: [0.5, 2], drag: 4, life: [0.18, 0.32], size: [0.12, 0.18], shape: SHAPE.streak, align: true });
        break;
      case 'wave': case 'roar':
        for (let i = 0; i < 2; i++) this.emit(x, 0.8, z, { count: 1, color: '#FFE27A', speed: [0, 0], up: [0, 0], life: [0.25 + i * 0.1, 0.25 + i * 0.1], size: [0.6 + i * 0.5, 0.6 + i * 0.5], endSize: 2.4, shape: SHAPE.ring });
        this.emit(x, 0.8, z, { count: Math.round(7 * k), color: ['#FFF5BA', '#FFD98A', '#FFFFFF'], angle: ang, spread: 1.6, speed: [3, 7], up: [0.5, 2.5], drag: 4, life: [0.2, 0.4], size: [0.14, 0.22], shape: SHAPE.star, spin: 6 });
        break;
      case 'claw': case 'pounce':
        for (let i = -1; i <= 1; i++) this.emit(x + Math.cos(ang + Math.PI / 2) * i * 0.18, 0.85 + i * 0.12, z + Math.sin(ang + Math.PI / 2) * i * 0.18, { count: 1, color: '#FFFFFF', angle: ang + 0.7, spread: 0, speed: [6, 6], up: [-2, -2], drag: 10, life: [0.14, 0.14], size: [0.5 * k, 0.5 * k], shape: SHAPE.streak, align: true });
        this.emit(x, 0.8, z, { count: Math.round(6 * k), color: ['#FF7A8A', '#FFB870', '#FFFFFF'], angle: ang, spread: 1.4, speed: [3, 7], up: [0.5, 2], gravity: 6, drag: 4, life: [0.15, 0.3], size: [0.1, 0.16], shape: SHAPE.streak, align: true });
        break;
      case 'bubble': case 'prison':
        for (let i = 0; i < 2; i++) this.emit(x, 0.8, z, { count: 1, color: '#CFF1FF', speed: [0, 0], up: [0, 0], life: [0.3 + i * 0.12, 0.3 + i * 0.12], size: [0.5 + i * 0.4, 0.5 + i * 0.4], endSize: 2.2, shape: SHAPE.ring });
        this.emit(x, 0.8, z, { count: Math.round(8 * k), color: ['#FF3FA0', '#FF8CC6', '#FFFFFF'], speed: [1.5, 4], up: [1, 3], gravity: 9, drag: 2, life: [0.35, 0.6], size: [0.1, 0.18], shape: SHAPE.glow });
        break;
      default:
        this.emit(x, 0.8, z, { count: Math.round(8 * k), color: ['#FFFFFF', '#FFE3F0'], speed: [2, 5], up: [1, 3], gravity: 6, drag: 3, life: [0.25, 0.45], size: [0.14, 0.24], shape: SHAPE.star });
    }
    // white core flash
    this.emit(x, 0.85, z, { count: 1, color: '#FFFFFF', speed: [0, 0], up: [0, 0], life: [0.07, 0.07], size: [0.9 * k, 0.9 * k], endSize: 1.6, shape: SHAPE.glow });
  }
  bowSnap(x: number, z: number, angle: number) {
    const hx = x + Math.cos(angle) * 0.75, hz = z + Math.sin(angle) * 0.75;
    this.emit(hx, 0.8, hz, { count: 1, color: '#CFEAFF', speed: [0, 0], up: [0, 0], life: [0.18, 0.18], size: [0.4, 0.4], endSize: 3.2, shape: SHAPE.ring });
    this.emit(hx, 0.8, hz, { count: 6, color: ['#B5DEFF', '#FFFFFF'], angle, spread: 0.5, speed: [6, 10], up: [0, 0.5], drag: 6, life: [0.1, 0.18], size: [0.1, 0.14], shape: SHAPE.streak, align: true });
  }
  swoosh(x: number, z: number, angle: number, color: THREE.ColorRepresentation = '#FFF5BA') {
    for (let i = 0; i < 7; i++) {
      const a = angle - 1 + (i / 6) * 2;
      this.emit(x + Math.cos(a) * 0.9, 0.8, z + Math.sin(a) * 0.9, { count: 1, color, angle: a + Math.PI / 2, spread: 0.1, speed: [2, 3], up: [0, 0.2], drag: 4, life: [0.18, 0.26], size: [0.2, 0.26], endSize: 0.3, shape: SHAPE.streak, align: true });
    }
  }
  speedLines(x: number, z: number, angle: number) {
    this.emit(x, 0.7, z, { count: 3, color: ['#FFFFFF', '#E9DEFF'], angle: angle + Math.PI, spread: 0.5, speed: [5, 8], up: [0, 0.4], drag: 3, life: [0.15, 0.25], size: [0.14, 0.2], shape: SHAPE.streak, align: true, jitter: 0.6 });
  }
  /** Sparks converging on a point (super charge-up). */
  chargeGlow(x: number, z: number, color: THREE.ColorRepresentation) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 0.6;
      this.emit(x + Math.cos(a) * r, 0.9 + Math.random() * 0.8, z + Math.sin(a) * r, { count: 1, color: [color, '#FFFFFF'], angle: a + Math.PI, spread: 0, speed: [r / 0.28, r / 0.28], up: [-0.5, 0], drag: 0, life: [0.26, 0.28], size: [0.14, 0.2], endSize: 0.4, shape: SHAPE.streak, align: true });
    }
  }
  confetti(x: number, z: number) {
    this.emit(x, 2.5, z, { count: 40, color: ['#FFC8DD', '#A8E6CF', '#FFF5BA', '#B5DEFF', '#C3B1E1', '#FFAAA5'], speed: [1, 4], up: [3, 7], gravity: 5, life: [1.2, 2], size: [0.14, 0.24], shape: SHAPE.leaf, drag: 1.2, spin: 12, jitter: 1 });
  }
}

/** Physical chunks for rock/crate destruction: gravity + bounce, then shrink away. */
class Debris {
  private rock: THREE.InstancedMesh;
  private wood: THREE.InstancedMesh;
  private items: { m: THREE.InstancedMesh; i: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; vrx: number; vry: number; t: number; s: number }[] = [];
  private free: { rock: number[]; wood: number[] } = { rock: [], wood: [] };
  private d = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    const cap = 64;
    const rg = new THREE.IcosahedronGeometry(0.28, 0);
    this.rock = new THREE.InstancedMesh(rg, toonMaterial({ color: '#E3DDF2' }), cap);
    const wg = new THREE.BoxGeometry(0.5, 0.12, 0.2);
    this.wood = new THREE.InstancedMesh(wg, toonMaterial({ color: '#F2BE93' }), cap);
    for (const m of [this.rock, this.wood]) {
      m.frustumCulled = false;
      this.d.scale.setScalar(0); this.d.updateMatrix();
      for (let i = 0; i < cap; i++) m.setMatrixAt(i, this.d.matrix);
      scene.add(m);
    }
    for (let i = 0; i < cap; i++) { this.free.rock.push(i); this.free.wood.push(i); }
  }

  burst(x: number, z: number, n: number, kind: 'rock' | 'wood') {
    const m = kind === 'rock' ? this.rock : this.wood;
    for (let k = 0; k < n; k++) {
      const i = this.free[kind].pop();
      if (i === undefined) return;
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3.5;
      this.items.push({ m, i, x, y: 0.6, z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 4, vz: Math.sin(a) * sp, rx: 0, ry: 0, vrx: (Math.random() - 0.5) * 14, vry: (Math.random() - 0.5) * 14, t: 0, s: 0.7 + Math.random() * 0.7 });
    }
  }

  update(dt: number) {
    const d = this.d;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.t += dt;
      it.vy -= 18 * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (it.y < 0.1) { it.y = 0.1; it.vy *= -0.4; it.vx *= 0.6; it.vz *= 0.6; it.vrx *= 0.6; it.vry *= 0.6; }
      it.rx += it.vrx * dt; it.ry += it.vry * dt;
      const shrink = it.t > 1.5 ? Math.max(0, 1 - (it.t - 1.5) / 0.4) : 1;
      d.position.set(it.x, it.y, it.z); d.rotation.set(it.rx, it.ry, 0); d.scale.setScalar(it.s * shrink); d.updateMatrix();
      it.m.setMatrixAt(it.i, d.matrix);
      it.m.instanceMatrix.needsUpdate = true;
      if (shrink <= 0) { this.free[it.m === this.rock ? 'rock' : 'wood'].push(it.i); this.items.splice(k, 1); }
    }
  }
}
