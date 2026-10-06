import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAR_BY_ID, superOf, weaponOf, type World, type Projectile, type CharacterId } from '@pastel/shared';
import { toonMaterial, outlineMaterial, radialTexture, globalUniforms } from './toon';
import type { VFX } from './vfx';
import { SHAPE } from './vfx';

const tmpObj = new THREE.Object3D();

class Pool {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number, scene: THREE.Object3D, readonly outline?: THREE.InstancedMesh) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    if (outline) { outline.instanceMatrix = this.mesh.instanceMatrix; outline.frustumCulled = false; outline.count = 0; scene.add(outline); }
  }
  begin() { this.n = 0; }
  push(x: number, y: number, z: number, s: number | THREE.Vector3, ry = 0, rx = 0, rz = 0, color?: THREE.Color) {
    if (this.n >= this.cap) return;
    tmpObj.position.set(x, y, z);
    tmpObj.rotation.set(rx, ry, rz, 'YXZ');
    if (typeof s === 'number') tmpObj.scale.setScalar(s); else tmpObj.scale.copy(s);
    tmpObj.updateMatrix();
    this.mesh.setMatrixAt(this.n, tmpObj.matrix);
    if (color) this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    if (this.outline) this.outline.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function bubbleMaterial(opacity = 0.55, tint?: THREE.ColorRepresentation) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    defines: tint === undefined ? {} : { USE_TINT: '' },
    uniforms: { uTime: globalUniforms.uTime, uOpacity: { value: opacity }, uTint: { value: new THREE.Color(tint ?? '#ffffff') } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity; uniform vec3 uTint; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), vV));
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (f * 1.4 + uTime * 0.25 + vec3(0.0, 0.33, 0.67)));
        float spec = smoothstep(0.92, 1.0, dot(normalize(vN), normalize(vec3(-0.4, 0.8, 0.4))));
        #ifdef USE_TINT
        // saturated body with a dark rim: stands out against the pastel ground
        vec3 col = mix(uTint, rainbow, 0.25);
        col = mix(col, uTint * 0.45, smoothstep(0.78, 0.92, f));
        float a = (0.42 + pow(f, 1.5) * 0.58) * uOpacity + spec;
        #else
        vec3 col = mix(vec3(0.85, 0.95, 1.0), rainbow, 0.55);
        float a = (0.12 + pow(f, 2.0) * 0.85) * uOpacity + spec;
        #endif
        gl_FragColor = vec4(col + spec, min(1.0, a));
        #include <colorspace_fragment>
      }`,
  });
  return m;
}

export class Entities {
  private bullets: Pool;
  private pellets: Pool;
  private arrows: Pool;
  private boomerangs: Pool;
  private bubbles: Pool;
  private bombs: Pool;
  private bigBubbles: Pool;
  private markers: Pool;
  private shadows: Pool;
  private cubes: Pool;
  private flowers: Pool;
  readonly aim: AimIndicator;
  private col = new THREE.Color();
  /** Last drawn position per projectile, for continuous tracers. */
  private lastPos = new Map<number, { x: number; z: number }>();
  private trailT = 0;

  constructor(scene: THREE.Scene, private vfx: VFX) {
    const basic = (c: string) => new THREE.MeshBasicMaterial({ color: c });
    const bulletGeo = new THREE.CapsuleGeometry(0.1, 0.28, 3, 8).rotateZ(Math.PI / 2);
    this.bullets = new Pool(bulletGeo, basic('#FFFFFF'), 220, scene);
    const pelletGeo = new THREE.SphereGeometry(0.16, 10, 8);
    this.pellets = new Pool(pelletGeo, basic('#FFFFFF'), 120, scene, new THREE.InstancedMesh(pelletGeo, outlineMaterial('#7A2410', 0.045), 120));
    // two-tone arrow: white shaft, saturated sky-blue head, lemon star fletching (reads on pastel ground)
    const tint = (g: THREE.BufferGeometry, c: string) => {
      const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const arrowGeo = mergeGeometries([
      tint(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6).rotateZ(Math.PI / 2).toNonIndexed(), '#FFFFFF'),
      tint(new THREE.ConeGeometry(0.14, 0.32, 8).rotateZ(-Math.PI / 2).translate(0.5, 0, 0).toNonIndexed(), '#3FA2FF'),
      tint(new THREE.OctahedronGeometry(0.17).scale(0.45, 1, 1).translate(-0.36, 0, 0), '#FFD84D'),
      tint(new THREE.OctahedronGeometry(0.17).scale(0.45, 1, 1).rotateX(Math.PI / 2).translate(-0.36, 0, 0), '#FFD84D'),
    ])!;
    this.arrows = new Pool(arrowGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), 40, scene, new THREE.InstancedMesh(arrowGeo, outlineMaterial('#2E4A7A', 0.035), 40));
    const rang = new THREE.TorusGeometry(0.32, 0.08, 6, 16, Math.PI * 0.8).rotateX(Math.PI / 2);
    this.boomerangs = new Pool(rang, toonMaterial({ color: '#FFE27A', rim: 0.6 }), 40, scene, new THREE.InstancedMesh(rang, outlineMaterial('#B88A3B', 0.03), 40));
    this.bubbles = new Pool(new THREE.SphereGeometry(1, 18, 12), bubbleMaterial(0.9, '#FF3FA0'), 120, scene);
    this.bubbles.mesh.renderOrder = 8;
    const bomb = mergeGeometries([
      new THREE.SphereGeometry(0.24, 14, 10),
      new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6).translate(0, 0.26, 0),
    ])!;
    this.bombs = new Pool(bomb, toonMaterial({ color: '#B9A6DE', rim: 0.6 }), 40, scene, new THREE.InstancedMesh(bomb, outlineMaterial('#5C4C86', 0.03), 40));
    this.bigBubbles = new Pool(new THREE.SphereGeometry(1, 24, 16), bubbleMaterial(0.8), 10, scene);
    this.bigBubbles.mesh.renderOrder = 9;
    const ring = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
    this.markers = new Pool(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }), 40, scene);
    const sh = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = new Pool(sh, new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false }), 80, scene);
    this.shadows.mesh.renderOrder = 1;
    const cube = new RoundedBoxGeometry(0.5, 0.5, 0.5, 2, 0.1);
    this.cubes = new Pool(cube, toonMaterial({ color: '#7ED9B6', rim: 0.8, emissive: '#1d4d3d' }), 60, scene, new THREE.InstancedMesh(cube, outlineMaterial('#3F8C72', 0.03), 60));
    const flower = mergeGeometries([
      ...[0, 1, 2, 3, 4].map((i) => new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.4, 0.7).translate(Math.cos(i * 1.257) * 0.22, 0, Math.sin(i * 1.257) * 0.22)),
      new THREE.SphereGeometry(0.14, 8, 6).translate(0, 0.05, 0),
    ])!;
    this.flowers = new Pool(flower, toonMaterial({ color: '#FFB3CF', rim: 0.6 }), 20, scene, new THREE.InstancedMesh(flower, outlineMaterial('#C0688E', 0.025), 20));
    this.aim = new AimIndicator(scene);
  }

  update(world: World, alpha: number, dt: number, localId: string | null) {
    const t = world.time / 1000;
    for (const p of [this.bullets, this.pellets, this.arrows, this.boomerangs, this.bubbles, this.bombs, this.bigBubbles, this.markers, this.shadows, this.cubes, this.flowers]) p.begin();
    this.trailT += dt;
    const doTrail = this.trailT > 0.03;
    if (doTrail) this.trailT = 0;

    for (const p of world.projectiles) this.drawProjectile(world, p, alpha, doTrail, localId);
    if (this.lastPos.size > 64) { const live = new Set(world.projectiles.map((p) => p.id)); for (const id of this.lastPos.keys()) if (!live.has(id)) this.lastPos.delete(id); }

    // fighter blob shadows & active supers
    for (const f of world.fighters) {
      if (!f.alive) continue;
      const x = f.px + (f.x - f.px) * alpha, z = f.py + (f.y - f.py) * alpha;
      if (world.visible(localId, f)) this.shadows.push(x, 0.02, z, 1.6);
      if (f.superKind === 'tornado' && world.time < f.superUntil) {
        const r = superOf(CHAR_BY_ID[f.charId]).radius * 0.8;
        for (let k = 0; k < 2; k++) {
          const a = t * 9 + k * Math.PI;
          this.boomerangs.push(x + Math.cos(a) * r, 0.7, z + Math.sin(a) * r, 2.6, -a * 3);
          if (doTrail) this.vfx.trail(x + Math.cos(a) * r, 0.6, z + Math.sin(a) * r, '#FFF5BA', 0.5, SHAPE.puff, 0.35);
        }
        if (doTrail) this.vfx.emit(x, 0.2, z, { count: 2, color: ['#FFFFFF', '#FFF5BA'], speed: [3, 5], up: [0.5, 1.5], life: [0.3, 0.5], size: [0.3, 0.5], shape: SHAPE.puff, drag: 2 });
      }
      if (f.superKind === 'gatling' && world.time < f.superUntil && doTrail) this.vfx.sparkle(x, 1.2, z, '#FFE27A', 1, 0.6);
    }

    // pickups
    for (const pk of world.pickups) {
      const bob = Math.sin(t * 3 + pk.id) * 0.12;
      const age = Math.min(1, (world.time - pk.spawnAt) / 300);
      const pop = age < 1 ? 1 + Math.sin(age * Math.PI) * 0.5 : 1;
      if (pk.kind === 'cube') {
        this.cubes.push(pk.x, 0.55 + bob + (1 - age) * 1.2, pk.y, pop, t * 1.6 + pk.id, 0.5, 0.3);
        if (doTrail && Math.random() < 0.3) this.vfx.sparkle(pk.x, 0.6, pk.y, '#A8E6CF', 1, 0.5);
      } else {
        this.flowers.push(pk.x, 0.15 + bob * 0.3, pk.y, pop * 1.1, t * 0.8 + pk.id);
        if (doTrail && Math.random() < 0.2) this.vfx.heal(pk.x, pk.y);
      }
      this.shadows.push(pk.x, 0.02, pk.y, 0.9);
    }

    // zones
    for (const zn of world.zones) {
      if (zn.kind === 'prison' && !zn.done) {
        const k = Math.min(1, (world.time - zn.start) / 200);
        const wob = 1 + Math.sin(t * 14) * 0.04;
        this.bigBubbles.push(zn.x, zn.r * 0.55, zn.y, new THREE.Vector3(zn.r * k * wob, zn.r * 0.8 * k / wob, zn.r * k * wob));
        this.markers.push(zn.x, 0.06, zn.y, zn.r, 0, 0, 0);
      } else if (zn.kind === 'supply' && !zn.done) {
        const left = Math.max(0, (zn.until - world.time) / (zn.until - zn.start));
        this.markers.push(zn.x, 0.06, zn.y, 1.8);
        this.markers.push(zn.x, 0.06, zn.y, 0.2 + 1.6 * left);
        // falling crate shadow grows
        this.shadows.push(zn.x, 0.03, zn.y, 3 * (1 - left) + 0.4);
      }
    }

    for (const p of [this.bullets, this.pellets, this.arrows, this.boomerangs, this.bubbles, this.bombs, this.bigBubbles, this.markers, this.shadows, this.cubes, this.flowers]) p.end();
  }

  private ownerColor(world: World, p: Projectile) {
    const f = world.byId.get(p.ownerId);
    return f ? CHAR_BY_ID[f.charId as CharacterId].colorPalette : ['#ffffff', '#ffffff'];
  }

  private drawProjectile(world: World, p: Projectile, alpha: number, doTrail: boolean, localId: string | null) {
    const x = p.px + (p.x - p.px) * alpha, z = p.py + (p.y - p.py) * alpha;
    const ang = Math.atan2(p.vy, p.vx);
    const mine = p.ownerId === localId;
    switch (p.kind) {
      case 'bullet': {
        const sup = p.isSuper;
        this.col.set(sup ? '#FFC94D' : '#FFE27A');
        this.bullets.push(x, 0.75, z, sup ? 1.5 : 1, -ang, 0, 0, this.col);
        if (doTrail) this.vfx.trail(x, 0.75, z, sup ? '#FFD36B' : '#FFF5BA', sup ? 0.3 : 0.18);
        break;
      }
      case 'pellet': {
        this.col.set(p.isSuper ? '#FF3D5A' : '#FF7A2E');
        this.pellets.push(x, 0.7, z, p.isSuper ? 1.4 : 1, 0, 0, 0, this.col);
        if (doTrail) this.vfx.trail(x, 0.7, z, p.isSuper ? '#FF8A8A' : '#FFB067', p.isSuper ? 0.4 : 0.26, SHAPE.glow, 0.16);
        break;
      }
      case 'arrow':
      case 'meteor': {
        const big = p.kind === 'meteor';
        this.col.set(big ? '#FFE27A' : '#FFFFFF');
        this.arrows.push(x, 0.85, z, big ? 2.8 : 1.7, -ang, 0, 0, this.col);
        this.shadows.push(x, 0.02, z, big ? 1.4 : 0.8);
        // unbroken ribbon along the path travelled since last frame + glowing head
        const lx = this.lastPos.get(p.id);
        if (lx) this.vfx.tracer(lx.x, lx.z, x, z, 0.85, big ? '#FFD84D' : '#5FB4FF', big ? 1.1 : 0.75, big ? 0.45 : 0.32);
        this.lastPos.set(p.id, { x, z });
        if (doTrail) {
          this.vfx.trail(x, 0.85, z, '#FFFFFF', big ? 1.6 : 0.75, SHAPE.glow, 0.12);
          this.vfx.trail(x, 0.85, z, big ? '#FFF5BA' : '#BFE3FF', big ? 0.6 : 0.26, SHAPE.star, big ? 0.6 : 0.4);
        }
        break;
      }
      case 'boomerang':
        this.boomerangs.push(x, 0.75, z, 1.2, -p.spin);
        if (doTrail) this.vfx.trail(x, 0.75, z, '#FFF5BA', 0.3, SHAPE.puff, 0.18);
        break;
      case 'bubble':
        this.bubbles.push(x, 0.7, z, p.radius * 0.95 * (1 + Math.sin(world.time * 0.02 + p.id) * 0.06));
        this.shadows.push(x, 0.02, z, 0.6);
        if (doTrail) this.vfx.trail(x, 0.7, z, '#FF8CC6', 0.24, SHAPE.glow, 0.18);
        break;
      case 'arc': {
        const isPrison = p.superKind === 'prison', isMega = p.superKind === 'megabomb';
        if (isPrison) this.bigBubbles.push(x, p.z, z, 0.9);
        else this.bombs.push(x, p.z, z, isMega ? 2.4 : 1, world.time * 0.01, world.time * 0.008);
        this.shadows.push(x, 0.02, z, isMega || isPrison ? 1.6 : 0.8);
        // landing marker (enemy throws are red-ish so you can dodge)
        const tt = Math.min(1, p.t);
        this.markers.push(p.tx, 0.05, p.ty, p.splash * (0.4 + 0.6 * tt));
        if (doTrail) this.vfx.sparkle(x, p.z + 0.3, z, isMega ? '#FFC94D' : '#FFAAA5', 1, 0.1);
        void mine;
        break;
      }
    }
  }
}

/** Ground aim preview: line / cone / arc target, for attacks and supers. */
export class AimIndicator {
  readonly group = new THREE.Group();
  private line: THREE.Mesh;
  private cone: THREE.Mesh;
  private target: THREE.Mesh;
  private ringRange: THREE.Mesh;
  private dots: THREE.InstancedMesh;
  private mat: THREE.MeshBasicMaterial;
  private dotMat: THREE.MeshBasicMaterial;
  private coneCache = new Map<string, THREE.BufferGeometry>();

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
    const lg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    this.line = new THREE.Mesh(lg, this.mat);
    this.cone = new THREE.Mesh(new THREE.CircleGeometry(1, 24, 0, 1).rotateX(-Math.PI / 2), this.mat);
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2), this.mat);
    this.ringRange = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), this.mat);
    this.dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), this.dotMat, 14);
    this.dots.frustumCulled = false;
    this.group.add(this.line, this.cone, this.target, this.ringRange, this.dots);
    this.group.renderOrder = 2;
    this.group.visible = false;
    scene.add(this.group);
  }

  show(charId: CharacterId, isSuper: boolean, x: number, z: number, angle: number, dist: number, strength: number) {
    const def = CHAR_BY_ID[charId];
    const w = weaponOf(def), s = superOf(def);
    this.group.visible = strength > 0.01;
    if (!this.group.visible) return;
    this.group.position.set(x, 0.04, z);
    this.mat.color.set(isSuper ? '#FFE27A' : '#FFFFFF');
    this.dotMat.color.copy(this.mat.color);
    this.mat.opacity = 0.42 * strength;
    this.line.visible = this.cone.visible = this.target.visible = this.dots.visible = this.ringRange.visible = false;
    const shape = isSuper ? s.aim : w.aim;
    const range = isSuper ? Math.min(s.range || w.range, 24) : w.range;
    if (isSuper && s.kind === 'tornado') {
      this.ringRange.visible = true; this.ringRange.scale.setScalar(s.radius); this.ringRange.rotation.y = 0;
      this.target.visible = true; this.target.position.set(0, 0, 0); this.target.scale.setScalar(s.radius);
      return;
    }
    if (shape === 'line') {
      this.line.visible = true;
      this.line.rotation.y = -angle;
      const width = isSuper ? (s.kind === 'meteor' ? 1.0 : 0.9) : w.projectileType === 'boomerang' ? 0.9 : 0.55;
      this.line.scale.set(range, 1, width);
    } else if (shape === 'cone') {
      this.cone.visible = true;
      const spread = THREE.MathUtils.degToRad(isSuper ? 52 : w.spreadDeg + 8);
      const key = spread.toFixed(3);
      let g = this.coneCache.get(key);
      if (!g) { g = new THREE.CircleGeometry(1, 20, -spread / 2, spread).rotateX(-Math.PI / 2); this.coneCache.set(key, g); }
      this.cone.geometry = g;
      this.cone.rotation.y = -angle;
      this.cone.scale.setScalar(range);
    } else {
      const d = Math.min(dist > 0.5 ? dist : range, range);
      const tx = Math.cos(angle) * d, tz = Math.sin(angle) * d;
      const splash = isSuper ? s.radius : w.splashRadius ?? 2;
      this.target.visible = true;
      this.target.position.set(tx, 0, tz);
      this.target.scale.setScalar(splash);
      this.ringRange.visible = true; this.ringRange.scale.setScalar(range);
      this.dots.visible = true;
      for (let i = 0; i < 14; i++) {
        const k = (i + 1) / 15;
        tmpObj.position.set(tx * k, 0.6 + 4 * 2.6 * k * (1 - k), tz * k);
        tmpObj.scale.setScalar(1); tmpObj.rotation.set(0, 0, 0); tmpObj.updateMatrix();
        this.dots.setMatrixAt(i, tmpObj.matrix);
      }
      this.dots.instanceMatrix.needsUpdate = true;
    }
  }

  hide() { this.group.visible = false; }
}
