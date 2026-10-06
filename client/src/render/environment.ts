import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RNG, BUSH, type MapData, type Obstacle, type World } from '@pastel/shared';
import { toonMaterial, outlineMaterial, globalUniforms } from './toon';
import type { Quality } from './quality';

import { themeFor, lightFor, type Theme, type TimeOfDay, type TreeKind, type LightPreset } from './themes';

export type { TimeOfDay };

const vcolor = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation, grad?: { bottom: THREE.ColorRepresentation; y0: number; y1: number }) => {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(color), b = grad ? new THREE.Color(grad.bottom) : c, tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const y = geo.attributes.position.getY(i);
    const t = grad ? THREE.MathUtils.clamp((y - grad.y0) / (grad.y1 - grad.y0), 0, 1) : 1;
    tmp.copy(b).lerp(c, t);
    arr.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
};
/** Rotate (x then z) before placing — for tilted leaves, arms and crystals. */
const tilt = (g: THREE.BufferGeometry, rx: number, rz: number) => g.rotateX(rx).rotateZ(rz);
const moved = (g: THREE.BufferGeometry, x: number, y: number, z: number, s: number | [number, number, number] = 1, ry = 0) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s));
  return g.applyMatrix4(m);
};

/** Instanced prop with optional outline hull and per-instance dither fade. */
class Props {
  readonly mesh: THREE.InstancedMesh;
  readonly outline?: THREE.InstancedMesh;
  readonly fade: THREE.InstancedBufferAttribute;
  rustle?: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, outline?: THREE.Material, rustle = false) {
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    geo.setAttribute('aFade', this.fade);
    if (rustle) { this.rustle = new THREE.InstancedBufferAttribute(new Float32Array(count), 1); geo.setAttribute('aRustle', this.rustle); }
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (outline) {
      this.outline = new THREE.InstancedMesh(geo, outline, count);
      this.outline.instanceMatrix = this.mesh.instanceMatrix;
    }
  }
  set(i: number, x: number, y: number, z: number, s: number | THREE.Vector3, ry = 0, rx = 0) {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(rx, ry, 0);
    if (typeof s === 'number') d.scale.setScalar(Math.max(s, 1e-4)); else d.scale.copy(s);
    d.updateMatrix();
    this.mesh.setMatrixAt(i, d.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  color(i: number, c: THREE.Color) { this.mesh.setColorAt(i, c); this.mesh.instanceColor!.needsUpdate = true; }
  add(parent: THREE.Object3D) { parent.add(this.mesh); if (this.outline) parent.add(this.outline); }
  finish() { this.mesh.computeBoundingSphere(); if (this.outline) this.outline.boundingSphere = this.mesh.boundingSphere; }
}

export class Environment {
  readonly root = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private preset: LightPreset;
  private lightBasis!: { fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 };
  private snapTmp = new THREE.Vector3();
  readonly theme: Theme;
  private rng = new RNG(99);
  private trees: Props[] = [];
  private treeCanopies: Props[] = [];
  private treeIndex = new Map<number, { v: number; i: number }>();
  private rocks!: Props;
  private rockIndex = new Map<number, number>();
  private rubble!: Props;
  private rubbleCount = 0;
  private crates!: Props;
  private crateIndex = new Map<number, number>();
  private bushes!: Props;
  private bushScale: Float32Array;
  private hitT = new Map<number, number>();
  private poisonMesh!: THREE.Mesh;
  private poisonWall!: THREE.Mesh;
  private poisonMat!: THREE.ShaderMaterial;
  private cloudMat!: THREE.ShaderMaterial;
  private waters: THREE.ShaderMaterial[] = [];
  private grassMat?: THREE.Material;
  private obstacleState = new Map<number, boolean>();
  private sunOffset: THREE.Vector3;

  constructor(private scene: THREE.Scene, private map: MapData, private quality: Quality, readonly tod: TimeOfDay) {
    this.theme = themeFor(map.theme);
    const P = (this.preset = lightFor(this.theme, tod));
    scene.background = new THREE.Color(P.fog);
    scene.fog = new THREE.Fog(P.fog, 62, 150);
    this.hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiI);
    this.sun = new THREE.DirectionalLight(P.sun, P.sunI);
    this.sunOffset = new THREE.Vector3(...P.sunDir).normalize().multiplyScalar(40);
    this.sun.position.copy(this.sunOffset);
    {
      const fwd = this.sunOffset.clone().normalize().negate();
      const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
      this.lightBasis = { fwd, right, up: new THREE.Vector3().crossVectors(right, fwd) };
    }
    if (quality.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -20; cam.right = cam.top = 20; cam.near = 5; cam.far = 90;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
      this.sun.shadow.radius = 3;
    }
    scene.add(this.hemi, this.sun, this.sun.target, this.root);
    this.bushScale = new Float32Array(map.bushes.length).fill(1);

    this.buildGround();
    this.buildIsland();
    this.buildClouds();
    this.buildFence();
    this.buildTrees();
    this.buildRocks();
    this.buildCrates();
    this.buildBushes();
    this.buildPonds();
    this.buildIce();
    this.buildFoliage();
    this.buildPoison();
  }

  // ─────────────────────────────────────────── ground & backdrop
  private buildGround() {
    const size = this.quality.level === 'low' ? 1024 : 2048;
    const half = this.map.half + 0.5;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const ppm = size / (half * 2);
    const X = (x: number) => (x + half) * ppm;
    const T = this.theme.ground;
    g.fillStyle = T.base;
    g.fillRect(0, 0, size, size);
    // soft tonal noise
    const blob = (x: number, y: number, r: number, col: string) => {
      const grd = g.createRadialGradient(X(x), X(y), 0, X(x), X(y), r * ppm);
      grd.addColorStop(0, col); grd.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = grd; g.beginPath(); g.arc(X(x), X(y), r * ppm, 0, Math.PI * 2); g.fill();
    };
    for (let i = 0; i < 160; i++) blob(this.rng.range(-half, half), this.rng.range(-half, half), this.rng.range(2, 7), this.rng.next() < 0.5 ? T.light : T.dark);
    if (T.ripples) {
      // wind-carved dune ripples
      g.strokeStyle = 'rgba(205,160,110,0.22)'; g.lineWidth = 0.12 * ppm;
      for (let k = 0; k < 140; k++) {
        const y0 = this.rng.range(-half, half), x0 = this.rng.range(-half, half), len = this.rng.range(3, 8);
        g.beginPath();
        for (let t = 0; t <= 1; t += 0.1) { const x = x0 + t * len; const y = y0 + Math.sin(t * Math.PI * 2 + k) * 0.35; t === 0 ? g.moveTo(X(x), X(y)) : g.lineTo(X(x), X(y)); }
        g.stroke();
      }
    }
    // subtle checker tiles (2m) help read motion
    g.fillStyle = `rgba(255,255,255,${T.checker})`;
    for (let ty = -40; ty < 40; ty += 2) for (let tx = -40; tx < 40; tx += 2) if (((tx + ty) / 2) % 2 === 0) g.fillRect(X(tx), X(ty), 2 * ppm, 2 * ppm);
    // cream paths: spokes from spawns + plaza ring
    g.lineCap = 'round';
    const path = (w: number, col: string) => {
      g.strokeStyle = col; g.lineWidth = w * ppm;
      for (const s of this.map.spawns) { g.beginPath(); g.moveTo(X(s.x), X(s.y)); g.quadraticCurveTo(X(s.x * 0.5 + s.y * 0.12), X(s.y * 0.5 - s.x * 0.12), X(0), X(0)); g.stroke(); }
      g.beginPath(); g.arc(X(0), X(0), 9 * ppm, 0, Math.PI * 2); g.stroke();
    };
    path(3.4, T.pathEdge);
    path(2.6, T.path);
    g.fillStyle = T.plaza;
    g.beginPath(); g.arc(X(0), X(0), 6.5 * ppm, 0, Math.PI * 2); g.fill();
    // plaza tiles
    g.strokeStyle = 'rgba(210,190,160,0.5)'; g.lineWidth = 0.08 * ppm;
    for (let r = 2; r <= 6; r += 2) { g.beginPath(); g.arc(X(0), X(0), r * ppm, 0, Math.PI * 2); g.stroke(); }
    // spawn pads
    for (const s of this.map.spawns) {
      g.fillStyle = T.pad; g.beginPath(); g.arc(X(s.x), X(s.y), 2.2 * ppm, 0, Math.PI * 2); g.fill();
      g.strokeStyle = T.padRing; g.lineWidth = 0.18 * ppm; g.setLineDash([0.4 * ppm, 0.35 * ppm]);
      g.beginPath(); g.arc(X(s.x), X(s.y), 1.7 * ppm, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // painted flowers
    const fl = T.dots;
    for (let i = 0; i < T.dotCount; i++) {
      g.fillStyle = this.rng.pick(fl);
      g.globalAlpha = 0.75;
      g.beginPath(); g.arc(X(this.rng.range(-half, half)), X(this.rng.range(-half, half)), this.rng.range(0.05, 0.11) * ppm, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // baked contact AO under props (purple, never black)
    for (const o of this.map.obstacles) {
      const r = o.type === 'tree' ? 1.9 : o.type === 'water' ? o.r + 0.6 : (o.shape === 'box' ? o.hw * 1.6 : o.r * 1.5);
      blob(o.x, o.y, r, o.type === 'water' ? 'rgba(140,120,190,0.25)' : 'rgba(110,90,170,0.3)');
    }
    for (const b of this.map.bushes) blob(b.x, b.y, b.r * 1.25, 'rgba(110,90,170,0.18)');
    // pond banks
    // frosty halo under the ice lakes
    for (const z of this.map.slipZones) blob(z.x, z.y, z.r + 1.4, 'rgba(190,225,255,0.85)');
    for (const o of this.map.obstacles) if (o.type === 'water') { g.fillStyle = this.theme.water.bank; g.beginPath(); g.arc(X(o.x), X(o.y), (o.r + 0.45) * ppm, 0, Math.PI * 2); g.fill(); }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.quality.anisotropy;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), toonMaterial({ map: tex, rim: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false; ground.updateMatrix();
    this.root.add(ground);
  }

  private buildIsland() {
    const h = this.map.half + 1.2, r = 3, depth = 3.2;
    const s = new THREE.Shape();
    s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r); s.lineTo(h, h - r);
    s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.5, bevelSegments: 2, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2);
    const top = vcolor(geo, this.theme.island.top, { bottom: this.theme.island.side, y0: depth - 0.2, y1: depth + 0.3 });
    // brown bands
    const col = top.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      const y = top.attributes.position.getY(i);
      if (y < depth - 0.2) { const k = 0.82 + 0.18 * Math.sin(y * 3.2); col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * (k + 0.04)); }
    }
    const island = new THREE.Mesh(top, toonMaterial({ vertexColors: true, rim: 0.2 }));
    island.position.y = -depth - 0.55;
    this.root.add(island);

    const under = vcolor(new THREE.ConeGeometry(h * 1.32, 30, 8, 3), this.theme.island.under, { bottom: this.theme.island.underBottom, y0: -15, y1: 14 });
    under.rotateX(Math.PI); under.rotateY(Math.PI / 8);
    const um = new THREE.Mesh(under, toonMaterial({ vertexColors: true, rim: 0.15 }));
    um.position.y = -depth - 15.5;
    this.root.add(um);

    // distant mini islands
    const mini = mergeGeometries([
      vcolor(moved(new THREE.ConeGeometry(4, 7, 7).rotateX(Math.PI), 0, -3.5, 0), this.theme.island.under, { bottom: this.theme.island.underBottom, y0: -7, y1: 0 }),
      vcolor(moved(new THREE.CylinderGeometry(4.1, 4.1, 0.7, 7), 0, 0.2, 0), this.theme.island.miniTop),
      vcolor(moved(new THREE.SphereGeometry(1.6, 10, 8), 0.8, 2.6, 0.4), this.theme.island.miniBlob),
      vcolor(moved(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6), 0.8, 1.1, 0.4), '#C9A27E'),
    ])!;
    const mm = new THREE.InstancedMesh(mini, toonMaterial({ vertexColors: true }), 5);
    const d = new THREE.Object3D();
    [[-70, -6, -30, 1.2], [75, -10, 10, 1.5], [-20, -12, 72, 1.1], [40, -8, -78, 1.3], [-82, -14, 50, 1.8]].forEach(([x, y, z, sc], i) => {
      d.position.set(x, y, z); d.scale.setScalar(sc); d.rotation.y = i; d.updateMatrix(); mm.setMatrixAt(i, d.matrix);
    });
    this.root.add(mm);
  }

  private buildClouds() {
    const P = this.preset;
    this.cloudMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uA: { value: new THREE.Color(P.cloudA) }, uB: { value: new THREE.Color(P.cloudB) } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec2 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 uA; uniform vec3 uB; uniform float uTime;
        varying vec2 vW;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec2 p = vW * 0.035 + vec2(uTime * 0.012, uTime * 0.006);
          float n = fbm(p);
          float puff = smoothstep(0.42, 0.52, n) * 0.6 + smoothstep(0.6, 0.66, n) * 0.4;
          vec3 col = mix(uB, uA, puff);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    Object.assign(this.cloudMat.uniforms, globalUniforms);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), this.cloudMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -18;
    this.root.add(sea);

    // puffy cloud clusters hugging the island edge
    const puff = vcolor(new THREE.IcosahedronGeometry(1, 2), P.cloudA, { bottom: P.cloudB, y0: -0.8, y1: 0.6 });
    const n = this.quality.level === 'low' ? 60 : 140;
    const clouds = new THREE.InstancedMesh(puff, toonMaterial({ vertexColors: true, rim: 0.5 }), n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const side = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const r = (this.map.half + this.rng.range(4, 22)) / side;
      d.position.set(Math.cos(a) * r, this.rng.range(-9, -3.5), Math.sin(a) * r);
      const s = this.rng.range(2.2, 5.5);
      d.scale.set(s * this.rng.range(1, 1.8), s * 0.62, s);
      d.rotation.y = this.rng.range(0, 3);
      d.updateMatrix();
      clouds.setMatrixAt(i, d.matrix);
    }
    this.root.add(clouds);
  }

  private buildFence() {
    const half = this.map.half + 0.35;
    const posts: THREE.Vector3[] = [];
    for (let t = -half; t <= half + 0.01; t += 2.2) {
      posts.push(new THREE.Vector3(t, 0, -half), new THREE.Vector3(t, 0, half), new THREE.Vector3(-half, 0, t), new THREE.Vector3(half, 0, t));
    }
    const postGeo = mergeGeometries([
      vcolor(moved(new THREE.CylinderGeometry(0.13, 0.15, 0.85, 8), 0, 0.42, 0), this.theme.fence.post),
      vcolor(moved(new THREE.ConeGeometry(0.15, 0.2, 8), 0, 0.95, 0), this.theme.fence.cap),
    ])!;
    const mat = toonMaterial({ vertexColors: true });
    const pm = new THREE.InstancedMesh(postGeo, mat, posts.length);
    const d = new THREE.Object3D();
    posts.forEach((p, i) => { d.position.copy(p); d.updateMatrix(); pm.setMatrixAt(i, d.matrix); });
    const rails: THREE.BufferGeometry[] = [];
    for (const [x, z, ry] of [[0, -half, 0], [0, half, 0], [-half, 0, Math.PI / 2], [half, 0, Math.PI / 2]] as const) {
      for (const y of [0.35, 0.65]) rails.push(vcolor(moved(new THREE.BoxGeometry(half * 2, 0.09, 0.07), x, y, z, 1, ry), this.theme.fence.rail));
    }
    const rm = new THREE.Mesh(mergeGeometries(rails)!, mat);
    const ol = outlineMaterial(this.theme.fence.outline, 0.025);
    const pmo = new THREE.InstancedMesh(postGeo, ol, posts.length);
    pmo.instanceMatrix = pm.instanceMatrix;
    this.root.add(pm, pmo, rm);
  }

  // ─────────────────────────────────────────── props
  /** Trunk + canopy geometry for each tree kind (canopy carries wind sway, trunk stays rigid). */
  private treeKit(kind: TreeKind): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry; wind: number; windBase: number } {
    const bark = (h: number, r0 = 0.18, r1 = 0.3, top = '#C9A27E', bot = '#A8849A') => vcolor(moved(new THREE.CylinderGeometry(r0, r1, h, 8), 0, h / 2, 0), top, { bottom: bot, y0: 0, y1: h });
    const mound = (c: string, d: string) => vcolor(moved(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0, [1, 0.32, 1]), c, { bottom: d, y0: 0, y1: 0.2 });
    const blob = (r: number, x: number, y: number, z: number, top = '#FFFFFF', bot = '#D9D3EE', s: [number, number, number] = [1, 1, 1]) => vcolor(moved(new THREE.IcosahedronGeometry(r, 2), x, y, z, s), top, { bottom: bot, y0: y - r * s[1], y1: y + r * s[1] * 0.8 });
    switch (kind) {
      case 'round': return {
        trunk: bark(1.6), wind: 0.014, windBase: 1.2,
        canopy: mergeGeometries([blob(1.15, 0, 2.35, 0), blob(0.85, 0.75, 1.95, 0.2), blob(0.8, -0.65, 2.05, -0.3), blob(0.7, 0.1, 3.0, -0.35, '#FFFFFF', '#E6E1F5')])!,
      };
      case 'pine': return {
        trunk: bark(1.2), wind: 0.014, windBase: 1.2,
        canopy: mergeGeometries([0, 1, 2].map((i) => vcolor(moved(new THREE.ConeGeometry(1.35 - i * 0.3, 1.4, 9), 0, 1.6 + i * 0.85, 0), '#FFFFFF', { bottom: '#D9D4EE', y0: 1 + i * 0.85, y1: 2.2 + i * 0.85 })))!,
      };
      case 'apple': {
        const parts = [blob(1.25, 0, 2.3, 0, '#A9DC92', '#7FBF8A')];
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2, y = 2.0 + (i % 3) * 0.35, rr = Math.sqrt(1.25 ** 2 - (y - 2.3) ** 2) * 0.98;
          parts.push(vcolor(moved(new THREE.SphereGeometry(0.13, 8, 6), Math.cos(a) * rr, y, Math.sin(a) * rr), '#FF8F8F'));
        }
        return { trunk: bark(1.6), canopy: mergeGeometries(parts)!, wind: 0.014, windBase: 1.2 };
      }
      case 'broadleaf': {
        // jungle giant: buttress roots, thick trunk, wide layered canopy with hanging vines
        const roots = [0, 1, 2, 3].map((i) => vcolor(moved(tilt(new THREE.ConeGeometry(0.16, 0.9, 5), 0, -0.6), 0.32, 0.35, 0, 1, i * Math.PI / 2 + 0.4), '#A8846A', { bottom: '#8C7088', y0: 0, y1: 0.7 }));
        const vines = [0, 1, 2, 3, 4].map((i) => vcolor(moved(new THREE.CylinderGeometry(0.03, 0.03, 0.9 + (i % 2) * 0.5, 4), Math.cos(i * 1.3) * 1.25, 1.95 - (i % 2) * 0.25, Math.sin(i * 1.3) * 1.25), '#6FB07A', { bottom: '#5A9468', y0: 1.3, y1: 2.4 }));
        return {
          trunk: mergeGeometries([bark(2.3, 0.26, 0.42, '#B89270', '#8C7088'), ...roots])!, wind: 0.01, windBase: 1.8,
          canopy: mergeGeometries([blob(1.75, 0, 2.95, 0, '#FFFFFF', '#C9D9CC', [1, 0.5, 1]), blob(1.0, 1.0, 2.55, 0.35, '#FFFFFF', '#C9D9CC', [1, 0.6, 1]), blob(0.95, -0.9, 2.6, -0.4, '#FFFFFF', '#C9D9CC', [1, 0.6, 1]), blob(0.85, 0.1, 3.45, 0.2, '#FFFFFF', '#DCE7DC', [1, 0.6, 1]), ...vines])!,
        };
      }
      case 'palm': {
        const segs: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 6; i++) {
          const k = i / 5;
          segs.push(vcolor(moved(new THREE.CylinderGeometry(0.15 - k * 0.03, 0.18 - k * 0.03, 0.55, 8), k * k * 0.6, 0.27 + i * 0.5, 0), i % 2 ? '#D9B48A' : '#C79E78'));
        }
        const top: [number, number, number] = [0.6, 3.05, 0];
        const leaves: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 7; i++) {
          const g = new THREE.SphereGeometry(1, 10, 6).scale(1.25, 0.08, 0.3).translate(1.05, 0, 0).rotateZ(-0.5 - (i % 2) * 0.15).rotateY((i / 7) * Math.PI * 2);
          leaves.push(vcolor(moved(g, top[0], top[1], top[2]), '#93D88A', { bottom: '#6DB98A', y0: top[1] - 0.8, y1: top[1] + 0.1 }));
        }
        for (let i = 0; i < 3; i++) leaves.push(vcolor(moved(new THREE.SphereGeometry(0.14, 8, 6), top[0] + Math.cos(i * 2.1) * 0.18, top[1] - 0.18, Math.sin(i * 2.1) * 0.18), '#A57A55'));
        return { trunk: mergeGeometries(segs)!, canopy: mergeGeometries(leaves)!, wind: 0.025, windBase: 2.4 };
      }
      case 'cactus': {
        const green = (g: THREE.BufferGeometry) => vcolor(g, '#8ACB8B', { bottom: '#6AAE7E', y0: 0, y1: 2 });
        return {
          trunk: mound('#EED3A0', '#D9B583'), wind: 0, windBase: 0,
          canopy: mergeGeometries([
            green(moved(new THREE.CapsuleGeometry(0.3, 1.5, 4, 10), 0, 1.05, 0)),
            green(moved(new THREE.CapsuleGeometry(0.17, 0.5, 4, 8), 0.52, 1.35, 0)),
            green(moved(tilt(new THREE.CapsuleGeometry(0.16, 0.25, 4, 8), 0, Math.PI / 2), 0.33, 1.02, 0)),
            green(moved(new THREE.CapsuleGeometry(0.15, 0.35, 4, 8), -0.48, 1.65, 0)),
            green(moved(tilt(new THREE.CapsuleGeometry(0.14, 0.2, 4, 8), 0, Math.PI / 2), -0.31, 1.4, 0)),
            vcolor(moved(new THREE.SphereGeometry(0.11, 8, 6), 0, 1.98, 0, [1, 0.6, 1]), '#FF9EBB'),
            vcolor(moved(new THREE.SphereGeometry(0.08, 8, 6), 0.52, 1.72, 0, [1, 0.6, 1]), '#FFE27A'),
          ])!,
        };
      }
      case 'barrel': {
        const body = new THREE.CylinderGeometry(0.48, 0.52, 0.75, 12, 2);
        const pos = body.attributes.position;
        for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); const k = 1 + Math.cos(a * 12) * 0.05; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
        body.computeVertexNormals();
        return {
          trunk: mound('#EED3A0', '#D9B583'), wind: 0, windBase: 0,
          canopy: mergeGeometries([
            vcolor(moved(body, 0, 0.4, 0), '#9BD18A', { bottom: '#79B783', y0: 0, y1: 0.8 }),
            vcolor(moved(new THREE.SphereGeometry(0.48, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.77, 0, [1, 0.5, 1]), '#A6D894'),
            ...[0, 1, 2].map((i) => vcolor(moved(new THREE.SphereGeometry(0.09, 8, 6), Math.cos(i * 2.1) * 0.18, 0.98, Math.sin(i * 2.1) * 0.18, [1, 0.6, 1]), i === 1 ? '#FFE27A' : '#FF9EBB')),
          ])!,
        };
      }
      case 'snowpine': {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 3; i++) {
          const r = 1.35 - i * 0.3, y = 1.6 + i * 0.85;
          parts.push(vcolor(moved(new THREE.ConeGeometry(r, 1.4, 9), 0, y, 0), '#7FC2A6', { bottom: '#5E9E8E', y0: y - 0.7, y1: y + 0.6 }));
          parts.push(vcolor(moved(new THREE.ConeGeometry(r * 0.66, 0.66, 9), 0, y + 0.4, 0), '#FFFFFF', { bottom: '#E2EEFA', y0: y + 0.1, y1: y + 0.7 }));
        }
        return { trunk: bark(1.2, 0.18, 0.3, '#A88A7A', '#8C7EA0'), canopy: mergeGeometries(parts)!, wind: 0.01, windBase: 1.2 };
      }
      case 'crystal': {
        const spike = (x: number, y: number, z: number, h: number, rx: number, rz: number) => vcolor(moved(tilt(new THREE.OctahedronGeometry(1, 0).scale(0.32, h, 0.32), rx, rz), x, y, z), '#E4F6FF', { bottom: '#95CDEF', y0: y - h, y1: y + h });
        return {
          trunk: mound('#F4F9FF', '#D3E3F5'), wind: 0, windBase: 0,
          canopy: mergeGeometries([spike(0, 1.55, 0, 1.55, 0, 0), spike(0.5, 1.0, 0.15, 1.0, 0.1, -0.45), spike(-0.45, 0.95, -0.2, 0.95, -0.15, 0.5), spike(0.1, 0.8, -0.5, 0.8, 0.5, 0), spike(-0.1, 0.75, 0.5, 0.7, -0.5, 0.1)])!,
        };
      }
    }
  }

  private buildTrees() {
    const th = this.theme;
    const list = this.map.obstacles.filter((o) => o.type === 'tree');
    const outlineC = th.treeOutline;
    for (let v = 0; v < 3; v++) {
      const items = list.filter((o) => o.variant === v);
      const kit = this.treeKit(th.trees[v]);
      const tr = new Props(kit.trunk, toonMaterial({ vertexColors: true, fade: true }), Math.max(1, items.length), outlineMaterial(outlineC, 0.03, { fade: true }));
      const cn = new Props(kit.canopy, toonMaterial({ vertexColors: true, wind: kit.wind, windBase: kit.windBase, fade: true, rim: 0.4 }), Math.max(1, items.length), outlineMaterial(outlineC, 0.04, { wind: kit.wind, windBase: kit.windBase, fade: true }));
      items.forEach((o, i) => {
        tr.set(i, o.x, 0, o.y, o.scale, o.rot);
        cn.set(i, o.x, 0, o.y, o.scale, o.rot);
        cn.color(i, new THREE.Color(this.rng.pick(th.treeTints[v])));
        this.treeIndex.set(o.id, { v, i });
      });
      if (!items.length) { tr.mesh.count = 0; cn.mesh.count = 0; if (tr.outline) tr.outline.count = 0; if (cn.outline) cn.outline.count = 0; }
      tr.mesh.castShadow = cn.mesh.castShadow = true;
      tr.finish(); cn.finish();
      tr.add(this.root); cn.add(this.root);
      this.trees.push(tr); this.treeCanopies.push(cn);
    }
  }

  private rockGeometry(seed: number) {
    const R = this.theme.rock;
    if (R.shape === 'mesa') {
      // layered sandstone: three stacked jittered slabs with colour bands
      const r = new RNG(seed);
      const slab = (rt: number, rb: number, h: number, y: number, c: string, d: string) => {
        const g = new THREE.CylinderGeometry(rt, rb, h, 7, 1);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) { const k = 0.92 + ((Math.sin(i * 12.9898 + seed) * 43758.5) % 1 + 1) % 1 * 0.16; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
        return vcolor(moved(g, 0, y, 0, 1, r.range(0, 1)), c, { bottom: d, y0: y - h / 2, y1: y + h / 2 });
      };
      const g = mergeGeometries([slab(0.98, 1.05, 0.42, 0.21, R.accent, R.bottom), slab(0.8, 0.9, 0.36, 0.6, R.top, R.accent), slab(0.62, 0.72, 0.28, 0.92, R.top, R.top)])!;
      g.computeVertexNormals();
      return g;
    }
    if (R.shape === 'crystal') {
      const spike = (x: number, y: number, z: number, h: number, w: number, rx: number, rz: number) => vcolor(moved(tilt(new THREE.OctahedronGeometry(1, 0).scale(w, h, w), rx, rz), x, y, z), R.top, { bottom: R.bottom, y0: y - h, y1: y + h });
      return mergeGeometries([
        vcolor(moved(new THREE.IcosahedronGeometry(0.75, 0), 0, 0.12, 0, [1, 0.4, 1]), R.bottom, { bottom: R.bottom, y0: 0, y1: 0.3 }),
        spike(0, 0.75, 0, 0.85, 0.36, 0, 0), spike(0.42, 0.5, 0.15, 0.6, 0.27, 0.15, -0.55), spike(-0.38, 0.48, -0.2, 0.55, 0.25, -0.2, 0.5), spike(0.05, 0.42, -0.45, 0.48, 0.24, 0.55, 0),
      ])!;
    }
    const g = new THREE.IcosahedronGeometry(1, 1);
    const r = new RNG(seed);
    const pos = g.attributes.position;
    const cache = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!cache.has(k)) cache.set(k, r.range(0.85, 1.12));
      const sc = cache.get(k)!;
      pos.setXYZ(i, pos.getX(i) * sc, Math.max(-0.2, pos.getY(i) * sc * 0.78), pos.getZ(i) * sc);
    }
    g.computeVertexNormals();
    const out = vcolor(g, R.top, { bottom: R.bottom, y0: -0.2, y1: 0.75 });
    out.computeVertexNormals();
    if (R.shape === 'mossy') {
      // moss caps on the upward faces
      const moss = new THREE.Color(R.accent), col = out.attributes.color as THREE.BufferAttribute, nor = out.attributes.normal;
      for (let i = 0; i < col.count; i++) if (nor.getY(i) > 0.55) col.setXYZ(i, moss.r, moss.g, moss.b);
    }
    return moved(out, 0, 0.18, 0);
  }

  private buildRocks() {
    const list = this.map.obstacles.filter((o) => o.type === 'rock');
    const geo = this.rockGeometry(5);
    this.rocks = new Props(geo, toonMaterial({ vertexColors: true, rim: 0.35 }), list.length, outlineMaterial(this.theme.rock.outline, 0.035));
    list.forEach((o, i) => {
      this.rockIndex.set(o.id, i);
      this.rocks.set(i, o.x, 0, o.y, o.r * 1.08, o.rot);
      const t = 0.92 + this.rng.next() * 0.12;
      this.rocks.color(i, new THREE.Color(t, t * (0.97 + this.rng.next() * 0.05), t * 1.02));
    });
    this.rocks.mesh.castShadow = true;
    this.rocks.finish();
    this.rocks.add(this.root);
    // rubble left behind by destroyed rocks
    const peb = mergeGeometries([0, 1, 2, 3, 4].map((i) => {
      const a = i * 1.3;
      return vcolor(moved(new THREE.IcosahedronGeometry(0.22 + (i % 2) * 0.1, 0), Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.5, [1, 0.6, 1]), this.theme.rock.rubble[0], { bottom: this.theme.rock.rubble[1], y0: 0, y1: 0.2 });
    }))!;
    this.rubble = new Props(peb, toonMaterial({ vertexColors: true }), Math.max(1, list.length));
    this.rubble.mesh.count = 0;
    this.rubble.add(this.root);
  }

  private crateTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const CT = this.theme.crate;
    g.fillStyle = CT.body; g.fillRect(0, 0, 256, 256);
    g.fillStyle = CT.plank;
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 64 + 58, 256, 6);
    g.strokeStyle = CT.frame; g.lineWidth = 16; g.strokeRect(8, 8, 240, 240);
    // power cube emblem
    g.fillStyle = '#7ED9B6';
    g.beginPath(); g.roundRect(84, 84, 88, 88, 18); g.fill();
    g.fillStyle = '#B9F2DA'; g.beginPath(); g.roundRect(98, 96, 34, 30, 8); g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildCrates() {
    const geo = new RoundedBoxGeometry(1.6, 1.4, 1.6, 3, 0.18);
    geo.translate(0, 0.7, 0);
    const cap = 24;
    this.crates = new Props(geo, toonMaterial({ map: this.crateTexture(), rim: 0.35 }), cap, outlineMaterial('#9A6F63', 0.035));
    this.crates.mesh.count = 0;
    if (this.crates.outline) this.crates.outline.count = 0;
    this.crates.mesh.castShadow = true;
    for (const o of this.map.obstacles) if (o.type === 'crate') this.addCrate(o);
    this.crates.add(this.root);
  }

  addCrate(o: Obstacle) {
    const i = this.crates.mesh.count;
    if (i >= 24) return;
    this.crateIndex.set(o.id, i);
    this.crates.mesh.count = i + 1;
    if (this.crates.outline) this.crates.outline.count = i + 1;
    this.crates.set(i, o.x, 0, o.y, o.scale, Math.round(o.rot / (Math.PI / 2)) * (Math.PI / 2) + 0.12);
    this.crates.color(i, new THREE.Color(o.variant === 1 ? '#FFE0A6' : '#FFFFFF'));
    this.crates.finish();
    this.crates.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
    if (this.crates.outline) this.crates.outline.boundingSphere = this.crates.mesh.boundingSphere;
  }

  private buildBushes() {
    const B = this.theme.bush;
    const parts: THREE.BufferGeometry[] = [];
    // snowy bushes carry their real colours in vertices (white caps must stay white); others are tinted per instance
    const base = B.kind === 'snowy' ? B.colors[0] : '#FFFFFF';
    const shade = B.kind === 'snowy' ? '#5E9E8E' : '#BFD3C8';
    const detail = B.kind === 'spiky' ? 0 : 2;
    const sc = B.kind === 'spiky' ? 0.88 : 1;
    const leaf = (x: number, y: number, z: number, r: number) => parts.push(vcolor(moved(new THREE.IcosahedronGeometry(r * sc, detail), x * sc, y * sc, z * sc), base, { bottom: shade, y0: (y - r) * sc, y1: (y + r * 0.8) * sc }));
    leaf(0, 0.55, 0, 0.75);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; leaf(Math.cos(a) * 0.62, 0.42, Math.sin(a) * 0.62, 0.55); }
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.6; leaf(Math.cos(a) * 0.3, 0.92, Math.sin(a) * 0.3, 0.4); }
    if (B.kind === 'spiky') for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      parts.push(vcolor(moved(tilt(new THREE.ConeGeometry(0.06, 0.55, 4), Math.sin(a) * 0.6, -Math.cos(a) * 0.6), Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55), '#FFFFFF', { bottom: shade, y0: 0.6, y1: 1.1 }));
    }
    if (B.kind === 'snowy') {
      for (const g of parts) {
        const pos = g.attributes.position, col = g.attributes.color as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.78 + Math.sin(pos.getX(i) * 9) * 0.06) col.setXYZ(i, 1, 1, 1);
      }
    }
    if (B.blossoms) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      parts.push(vcolor(moved(new THREE.SphereGeometry(0.07, 6, 4), Math.cos(a) * 0.72 * sc, 0.78 * sc, Math.sin(a) * 0.72 * sc), B.blossoms[i % B.blossoms.length]));
    }
    const geo = mergeGeometries(parts)!;
    const n = this.map.bushes.length;
    this.bushes = new Props(geo, toonMaterial({ vertexColors: true, wind: 0.05, windBase: 0.2, fade: true, rustle: true, rim: 0.45 }), n, outlineMaterial(B.outline, 0.03, { wind: 0.05, windBase: 0.2, fade: true }), true);
    const tints = B.kind === 'snowy' ? ['#FFFFFF', '#F2FFF8', '#EAF6FF'] : B.colors;
    this.map.bushes.forEach((b, i) => {
      this.bushes.set(i, b.x, 0, b.y, b.r * 0.95, this.rng.range(0, 6));
      this.bushes.color(i, new THREE.Color(this.rng.pick(tints)));
    });
    this.bushes.mesh.castShadow = this.quality.level === 'high';
    this.bushes.finish();
    this.bushes.add(this.root);
  }

  private buildPonds() {
    for (const o of this.map.obstacles) {
      if (o.type !== 'water') continue;
      const mat = new THREE.ShaderMaterial({
        transparent: false,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          uDeep: { value: new THREE.Color(this.theme.water.deep) }, uShallow: { value: new THREE.Color(this.theme.water.shallow) }, uFoam: { value: new THREE.Color(this.theme.water.foam) },
        }]),
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          varying vec2 vUv; varying vec2 vW;
          void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform float uTime;
          varying vec2 vUv; varying vec2 vW;
          float h2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
          void main() {
            vec2 c = vUv - 0.5;
            float r = length(c) * 2.0;
            float ang = atan(c.y, c.x);
            float wob = sin(ang * 7.0 + uTime * 1.5) * 0.02 + sin(ang * 13.0 - uTime * 2.0) * 0.012;
            vec3 col = mix(uDeep, uShallow, smoothstep(0.1, 0.85, r));
            // concentric ripples
            float rip = smoothstep(0.92, 1.0, sin(r * 22.0 - uTime * 2.2) * 0.5 + 0.5) * 0.18 * (1.0 - r);
            col += rip;
            float foam = smoothstep(0.86 + wob, 0.9 + wob, r);
            col = mix(col, uFoam, foam);
            // sparkles
            vec2 g = floor(vW * 3.0);
            float s = step(0.985, h2(g)) * (0.5 + 0.5 * sin(uTime * 4.0 + h2(g + 3.1) * 30.0));
            col += s * 0.6 * (1.0 - foam);
            if (r > 1.0) discard;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      });
      Object.assign(mat.uniforms, globalUniforms);
      this.waters.push(mat);
      const m = new THREE.Mesh(new THREE.CircleGeometry(o.r + 0.15, 48), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(o.x, 0.03, o.y);
      this.root.add(m);
      if (!this.theme.water.lily) continue;
      // lily pads
      const pad = mergeGeometries([
        vcolor(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 14, 1, false, 0.4, Math.PI * 1.8), '#9ED79A'),
        vcolor(moved(new THREE.SphereGeometry(0.12, 8, 6), 0.1, 0.08, 0.05), '#FFC8DD'),
      ])!;
      const pm = new THREE.InstancedMesh(pad, toonMaterial({ vertexColors: true }), 3);
      const d = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        const a = this.rng.range(0, Math.PI * 2), rr = this.rng.range(0.6, o.r - 0.8);
        d.position.set(o.x + Math.cos(a) * rr, 0.06, o.y + Math.sin(a) * rr); d.rotation.y = a; d.scale.setScalar(this.rng.range(0.8, 1.2)); d.updateMatrix();
        pm.setMatrixAt(i, d.matrix);
      }
      this.root.add(pm);
    }
  }

  /** Slippery ice lakes (glacier): glossy disc with cracks, frosted rim and a travelling glint. */
  private buildIce() {
    for (const z of this.map.slipZones) {
      const mat = new THREE.ShaderMaterial({
        fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uR: { value: z.r } }]),
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          varying vec2 vUv; varying vec2 vW;
          void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          uniform float uTime; uniform float uR;
          varying vec2 vUv; varying vec2 vW;
          vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
          float cracks(vec2 p) {
            vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y)); vec2 o = h22(i + g); float d = length(g + o - f);
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
            }
            return 1.0 - smoothstep(0.0, 0.06, d2 - d1);
          }
          void main() {
            vec2 c = vUv - 0.5; float r = length(c) * 2.0;
            if (r > 1.0) discard;
            vec3 col = mix(vec3(0.80, 0.92, 1.0), vec3(0.70, 0.86, 0.98), smoothstep(0.0, 1.0, r));
            col = mix(col, vec3(0.96, 0.99, 1.0), cracks(vW * 0.55) * 0.55);
            float glint = smoothstep(0.92, 1.0, sin((vW.x + vW.y) * 0.35 - uTime * 1.6) * 0.5 + 0.5);
            col += glint * 0.25;
            float rim = smoothstep(0.86, 0.97, r);
            col = mix(col, vec3(1.0), rim);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      });
      Object.assign(mat.uniforms, globalUniforms);
      const m = new THREE.Mesh(new THREE.CircleGeometry(z.r + 0.25, 64), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(z.x, 0.022, z.y);
      m.receiveShadow = false;
      this.root.add(m);
    }
  }

  private isFree(x: number, y: number, pad: number) {
    for (const z of this.map.slipZones) if (Math.hypot(z.x - x, z.y - y) < z.r + pad) return false;
    for (const o of this.map.obstacles) {
      const r = o.shape === 'circle' ? o.r : o.hw * 1.4;
      if (Math.abs(o.x - x) < r + pad && Math.abs(o.y - y) < r + pad && Math.hypot(o.x - x, o.y - y) < r + pad) return false;
    }
    return true;
  }

  private buildFoliage() {
    const q = this.quality.level;
    // grass tufts: 3 crossed blades
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.ConeGeometry(0.05, 0.38, 3, 1);
      g.translate(0, 0.19, 0);
      g.rotateZ((i - 1) * 0.35);
      g.rotateY(i * 2.1);
      g.translate(Math.cos(i * 2.1) * 0.06, 0, Math.sin(i * 2.1) * 0.06);
      blades.push(vcolor(g, '#FFFFFF', { bottom: this.theme.grass?.base ?? '#9FBF9A', y0: 0, y1: 0.35 }));
    }
    const grassGeo = mergeGeometries(blades)!.scale(1, this.theme.grass?.height ?? 1, 1);
    const count = this.theme.grass ? Math.round((q === 'low' ? 900 : q === 'medium' ? 2600 : 5200) * this.theme.grass.mult) : 0;
    this.grassMat = toonMaterial({ vertexColors: true, wind: 1.6, windBase: 0, push: true, rim: 0.2 });
    const grass = new THREE.InstancedMesh(grassGeo, this.grassMat, count);
    const d = new THREE.Object3D();
    const greens = (this.theme.grass?.colors ?? ['#B3E09D']).map((c) => new THREE.Color(c));
    let placed = 0, guard = 0;
    const h = this.map.half - 0.8;
    while (placed < count && guard++ < count * 6) {
      const x = this.rng.range(-h, h), y = this.rng.range(-h, h);
      if (Math.hypot(x, y) < 9.5) continue;
      if (!this.isFree(x, y, 0.4)) continue;
      d.position.set(x, 0, y);
      d.rotation.y = this.rng.range(0, 6);
      d.scale.setScalar(this.rng.range(0.7, 1.35));
      d.updateMatrix();
      grass.setMatrixAt(placed, d.matrix);
      grass.setColorAt(placed, greens[placed % greens.length]);
      placed++;
    }
    grass.count = placed;
    grass.frustumCulled = false;
    if (placed) this.root.add(grass);

    // flowers & mushrooms
    const flower = mergeGeometries([
      vcolor(moved(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 4), 0, 0.16, 0), '#8CC48A'),
      ...[0, 1, 2, 3, 4].map((i) => vcolor(moved(new THREE.SphereGeometry(0.065, 6, 4), Math.cos(i * 1.257) * 0.08, 0.34, Math.sin(i * 1.257) * 0.08, [1, 0.45, 1]), '#FFFFFF')),
      vcolor(moved(new THREE.SphereGeometry(0.05, 6, 4), 0, 0.36, 0), '#FFE27A'),
    ])!;
    const fc = this.theme.flowers ? Math.round((q === 'low' ? 120 : 320) * (this.theme.flowers.count / 320)) : 0;
    const fm = new THREE.InstancedMesh(flower, toonMaterial({ vertexColors: true, wind: 0.8, windBase: 0.05 }), fc);
    const petals = (this.theme.flowers?.colors ?? ['#FFFFFF']).map((c) => new THREE.Color(c));
    placed = 0; guard = 0;
    while (placed < fc && guard++ < fc * 8) {
      const x = this.rng.range(-h, h), y = this.rng.range(-h, h);
      if (!this.isFree(x, y, 0.5) || Math.hypot(x, y) < 7) continue;
      d.position.set(x, 0, y); d.rotation.y = this.rng.range(0, 6); d.scale.setScalar(this.rng.range(0.8, 1.4)); d.updateMatrix();
      fm.setMatrixAt(placed, d.matrix); fm.setColorAt(placed, this.rng.pick(petals)); placed++;
    }
    fm.count = placed;
    fm.frustumCulled = false;
    if (placed) this.root.add(fm);
    if (!this.theme.mushrooms) return;

    const mush = mergeGeometries([
      vcolor(moved(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8), 0, 0.11, 0), '#FFF5E8'),
      vcolor(moved(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.2, 0, [1, 0.8, 1]), '#FF9EAF'),
      ...[0, 1, 2].map((i) => vcolor(moved(new THREE.SphereGeometry(0.035, 5, 4), Math.cos(i * 2.1) * 0.1, 0.32, Math.sin(i * 2.1) * 0.1), '#FFFFFF')),
    ])!;
    const trees = this.map.obstacles.filter((o) => o.type === 'tree');
    const mm = new THREE.InstancedMesh(mush, toonMaterial({ vertexColors: true }), trees.length);
    trees.forEach((t, i) => {
      const a = this.rng.range(0, 6);
      d.position.set(t.x + Math.cos(a) * 1.05, 0, t.y + Math.sin(a) * 1.05); d.scale.setScalar(this.rng.range(0.8, 1.3)); d.updateMatrix();
      mm.setMatrixAt(i, d.matrix);
    });
    this.root.add(mm);
  }

  private buildPoison() {
    this.poisonMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uR: { value: 99 }, uColor: { value: new THREE.Color('#B28BE0') } },
      vertexShader: `varying vec2 vW; void main(){ vec4 wp = modelMatrix*vec4(position,1.); vW = wp.xz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: /* glsl */ `
        uniform float uR; uniform vec3 uColor; uniform float uTime; varying vec2 vW;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),u.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x),u.y); }
        void main(){
          float d = max(abs(vW.x), abs(vW.y)) - uR;
          if (d < 0.0) discard;
          float n = n2(vW*0.35 + uTime*0.3) * 0.6 + n2(vW*0.9 - uTime*0.5) * 0.4;
          float a = smoothstep(0.0, 1.2, d) * (0.38 + n * 0.22);
          vec3 col = mix(uColor, vec3(0.92, 0.82, 1.0), n * 0.5);
          float edge = 1.0 - smoothstep(0.0, 0.35, d);
          col = mix(col, vec3(1.0, 0.9, 1.0), edge * 0.8);
          gl_FragColor = vec4(col, max(a, edge * 0.7));
          #include <colorspace_fragment>
        }`,
    });
    Object.assign(this.poisonMat.uniforms, { uTime: globalUniforms.uTime });
    this.poisonMesh = new THREE.Mesh(new THREE.PlaneGeometry(this.map.half * 2 + 4, this.map.half * 2 + 4), this.poisonMat);
    this.poisonMesh.rotation.x = -Math.PI / 2;
    this.poisonMesh.position.y = 0.6;
    this.poisonMesh.renderOrder = 5;
    this.poisonMesh.visible = false;
    this.root.add(this.poisonMesh);
    // translucent wall at the boundary (unit square ring, scaled each frame)
    const wallGeo = new THREE.BoxGeometry(2, 2.4, 2, 1, 1, 1);
    wallGeo.translate(0, 1.2, 0);
    // drop top/bottom faces: groups 2/3 are ±Y in BoxGeometry
    wallGeo.clearGroups(); wallGeo.addGroup(0, 12, 0); wallGeo.addGroup(24, 12, 0);
    const wallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: globalUniforms.uTime },
      vertexShader: `varying float vY; varying vec2 vUv; void main(){ vY = position.y; vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; varying float vY; varying vec2 vUv; void main(){ float a = (1.0 - smoothstep(0.0, 2.4, vY)) * (0.45 + 0.15*sin(vUv.x*40.0 + uTime*3.0)); gl_FragColor = vec4(0.82,0.65,0.98,a);
        #include <colorspace_fragment>
      }`,
    });
    this.poisonWall = new THREE.Mesh(wallGeo, [wallMat]);
    this.poisonWall.visible = false;
    this.poisonWall.renderOrder = 6;
    this.root.add(this.poisonWall);
  }

  // ─────────────────────────────────────────── runtime
  onObstacleHit(id: number) { this.hitT.set(id, 0); }
  onRustle(bushId: number) { if (this.bushes.rustle) { this.bushes.rustle.setX(bushId, 1); this.bushes.rustle.needsUpdate = true; } }
  rustleAt(x: number, y: number) {
    this.map.bushes.forEach((b, i) => { if (Math.hypot(b.x - x, b.y - y) < b.r + 0.8) this.onRustle(i); });
  }

  update(dt: number, time: number, world: World | null, focus: THREE.Vector3, localCluster: number) {
    // shadow camera follows the action, snapped to whole shadow-map texels so edges don't shimmer while moving
    let fx = focus.x, fz = focus.z;
    if (this.sun.castShadow) {
      const { right, up, fwd } = this.lightBasis;
      const cam = this.sun.shadow.camera;
      const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
      const p = this.snapTmp.set(fx, 0, fz);
      const r = Math.round(p.dot(right) / texel) * texel, u = Math.round(p.dot(up) / texel) * texel, f = p.dot(fwd);
      // rebuild in light space, then slide along the light ray back onto the ground plane
      p.copy(right).multiplyScalar(r).addScaledVector(up, u).addScaledVector(fwd, f);
      p.addScaledVector(fwd, -p.y / fwd.y);
      fx = p.x; fz = p.z;
    }
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    if (!world) return;

    // rocks & crates: destruction / hit wobble
    for (const o of world.map.obstacles) {
      if (o.type === 'rock' || o.type === 'crate') {
        const was = this.obstacleState.get(o.id);
        const ht = this.hitT.get(o.id);
        if (was === o.alive && ht === undefined) continue;
        this.obstacleState.set(o.id, o.alive);
        let wob = 0;
        if (ht !== undefined) {
          const nt = ht + dt * 6;
          if (nt >= 1) this.hitT.delete(o.id); else this.hitT.set(o.id, nt);
          wob = Math.sin(nt * Math.PI * 3) * (1 - nt) * 0.12;
        }
        if (o.type === 'rock') {
          const i = this.rockIndex.get(o.id)!;
          const worn = 0.86 + 0.14 * Math.max(0, o.hp / o.maxHp); // chipped rocks shrink a little
          const s = o.alive ? o.r * 1.08 * worn * (1 + wob) : 0;
          this.rocks.set(i, o.x, 0, o.y, s, o.rot);
          if (!o.alive && was) {
            const r = this.rubbleCount++;
            this.rubble.mesh.count = this.rubbleCount;
            this.rubble.set(r, o.x, 0, o.y, o.r * 1.1, o.rot);
            this.rubble.finish();
          }
        } else {
          let i = this.crateIndex.get(o.id);
          if (i === undefined) { this.addCrate(o); i = this.crateIndex.get(o.id)!; }
          const s = o.alive ? o.scale : 0;
          const sv = new THREE.Vector3(s * (1 + wob), s * (1 - wob * 1.4), s * (1 + wob));
          this.crates.set(i, o.x, 0, o.y, sv, Math.round(o.rot / (Math.PI / 2)) * (Math.PI / 2) + 0.12);
        }
      }
    }

    // bushes: destroyed / regrowing / withered / own-cluster see-through / rustle decay
    const now = world.time;
    const withered = new THREE.Color(this.theme.bush.withered);
    let colorsDirty = false, fadeDirty = false;
    world.map.bushes.forEach((b, i) => {
      const s = world.bushStates[i];
      let target = 1;
      if (!s.alive) target = 0;
      else if (now < s.regrowAt + BUSH.growDurationMs) target = THREE.MathUtils.clamp((now - s.regrowAt) / BUSH.growDurationMs, 0.15, 1);
      const cur = this.bushScale[i];
      const next = target === 0 ? Math.max(0, cur - dt * 6) : cur + (target - cur) * Math.min(1, dt * 8);
      const rus = this.bushes.rustle!.getX(i);
      if (Math.abs(next - cur) > 1e-3 || rus > 0) {
        this.bushScale[i] = next;
        this.bushes.set(i, b.x, 0, b.y, b.r * 0.95 * next * (1 + rus * 0.08), (b.id * 1.7) % 6);
      }
      if (rus > 0) { this.bushes.rustle!.setX(i, Math.max(0, rus - dt * 2.2)); this.bushes.rustle!.needsUpdate = true; }
      if (s.withered && !(this.bushes.mesh.userData['w' + i])) { this.bushes.mesh.userData['w' + i] = 1; this.bushes.mesh.setColorAt(i, withered); colorsDirty = true; }
      const wantFade = localCluster >= 0 && b.cluster === localCluster ? 0.38 : 1;
      const f = this.bushes.fade.getX(i);
      if (Math.abs(f - wantFade) > 0.01) { this.bushes.fade.setX(i, f + (wantFade - f) * Math.min(1, dt * 10)); fadeDirty = true; }
    });
    if (colorsDirty) this.bushes.mesh.instanceColor!.needsUpdate = true;
    if (fadeDirty) this.bushes.fade.needsUpdate = true;

    // trees between camera and the local player turn see-through
    for (const o of world.map.obstacles) {
      if (o.type !== 'tree') continue;
      const ti = this.treeIndex.get(o.id)!;
      const dz = o.y - focus.z, dx = Math.abs(o.x - focus.x);
      const occl = dz > -1.2 && dz < 4.5 && dx < 2.4 ? 0.3 : 1;
      const fa = this.treeCanopies[ti.v].fade;
      const cur = fa.getX(ti.i);
      if (Math.abs(cur - occl) > 0.01) {
        const nv = cur + (occl - cur) * Math.min(1, dt * 8);
        fa.setX(ti.i, nv); fa.needsUpdate = true;
        this.trees[ti.v].fade.setX(ti.i, nv); this.trees[ti.v].fade.needsUpdate = true;
      }
    }

    // poison
    if (world.poisonActive) {
      this.poisonMesh.visible = this.poisonWall.visible = true;
      this.poisonMat.uniforms.uR.value = world.poisonRadius;
      const r = Math.min(world.poisonRadius, this.map.half + 1);
      this.poisonWall.scale.set(r, 1, r);
    }
    void time;
  }

  /** Grass pushers: up to 8 character positions. */
  setPushers(list: { x: number; z: number; s: number }[]) {
    const arr = globalUniforms.uPushers.value;
    for (let i = 0; i < 8; i++) { const p = list[i]; if (p) arr[i].set(p.x, p.z, p.s); else arr[i].set(9999, 9999, 0); }
  }
}
