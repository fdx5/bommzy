import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterId, ItemSlot } from '@pastel/shared';
import { outfitParts, slotsOf } from './outfit';
import { toonMaterial, outlineMaterial, type ToonMaterial } from './toon';
import { FACES, HEAD_Y, headSurfaceZ, type Face } from './face';
import { bananaGeometry, BANANA } from './banana';

/**
 * Procedural chibi (2.5-head) characters. Every part is rigidly bound to one bone and all parts
 * are merged into ONE SkinnedMesh (+1 outline hull sharing the skeleton) → 2 draw calls/character.
 */

export type BoneName =
  | 'root' | 'hips' | 'body' | 'head' | 'eyes' | 'earL' | 'earR' | 'armL' | 'armR' | 'weapon'
  | 'legL' | 'legR' | 'tail' | 'cape' | 't0' | 't1' | 't2' | 't3' | 't4' | 't5';

const BONES: [BoneName, BoneName | null, [number, number, number]][] = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.3, 0]],
  ['body', 'hips', [0, 0.3, 0]],
  ['head', 'body', [0, 0.6, 0]],
  ['eyes', 'head', [0, 0.86, 0.32]],
  ['earL', 'head', [0.22, 1.08, 0]],
  ['earR', 'head', [-0.22, 1.08, 0]],
  ['armL', 'body', [0.25, 0.52, 0]],
  ['armR', 'body', [-0.25, 0.52, 0]],
  ['weapon', 'armR', [-0.32, 0.36, 0.12]],
  ['legL', 'hips', [0.12, 0.22, 0]],
  ['legR', 'hips', [-0.12, 0.22, 0]],
  ['tail', 'hips', [0, 0.32, -0.24]],
  ['cape', 'body', [0, 0.62, -0.16]],
  ...([0, 1, 2, 3, 4, 5].map((i) => [`t${i}`, 'hips', [Math.sin((i / 6) * Math.PI * 2 + 0.52) * 0.2, 0.2, Math.cos((i / 6) * Math.PI * 2 + 0.52) * 0.2]]) as [BoneName, BoneName, [number, number, number]][]),
];
const BONE_INDEX = Object.fromEntries(BONES.map(([n], i) => [n, i])) as Record<BoneName, number>;

const C = {
  eye: '#3B2E4F', white: '#FFFFFF', cheek: '#FF9EBB', nose: '#4A3B5C', cream: '#FFF5E8',
  gold: '#F5D27A', metal: '#BDB6D9', metalDark: '#8E86B3', wood: '#D9A877', orange: '#FFB38A', glass: '#CFF1FF',
};

/**
 * `ol` = outline weight (0 = no line); `gloss` = specular dot (metal/jewellery);
 * `pattern` = baked vertex-colour pattern; `grp` = built-in gear removed when that slot is equipped.
 */
export interface PartSpec {
  geo: THREE.BufferGeometry; color: string; bone: BoneName; p?: number[]; r?: number[]; s?: number[] | number; ol?: number; gloss?: number;
  pattern?: { kind: 'stripes' | 'check' | 'bands3'; c2: string; c3?: string; freq: number };
  grp?: ItemSlot;
  /** extra scale about the model origin, applied after p/r/s (hats widened to the head shape) */
  post?: number[];
}

const sphere = (r: number, w = 20, h = 14) => new THREE.SphereGeometry(r, Math.max(w, 12), Math.max(h, 9));
const hemi = (r: number) => new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const capsule = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 6, 14);
const cyl = (rt: number, rb: number, h: number, s = 20) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 18) => new THREE.ConeGeometry(r, h, s);
const torus = (r: number, t: number, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 10, 28, arc);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z, 1, 1, 1);

const NO_LINE = new Set([C.eye, C.white, C.cheek, '#5B4A7A', '#3A2C3F']);

interface Baked { g: THREE.BufferGeometry; c: THREE.Vector3; r: number }

function bake(spec: PartSpec, out: Baked[]) {
  const g = spec.geo.index ? spec.geo.toNonIndexed() : spec.geo;
  const m = new THREE.Matrix4();
  const s = typeof spec.s === 'number' ? [spec.s, spec.s, spec.s] : spec.s ?? [1, 1, 1];
  const r = spec.r ?? [0, 0, 0], p = spec.p ?? [0, 0, 0];
  m.compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])), new THREE.Vector3(s[0], s[1], s[2]));
  g.applyMatrix4(m);
  if (spec.post) g.scale(spec.post[0], spec.post[1], spec.post[2]);
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  const bs = g.boundingSphere!;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), ol = new Float32Array(n), sp = new Float32Array(n);
  // one glossy dot per character: only big head-level shapes (head, helmet, hat crown) catch the specular
  const gloss = spec.gloss ?? ((spec.bone === 'head' || spec.bone === 'body') && bs.radius > 0.24 && !NO_LINE.has(spec.color) ? 1 : 0);
  const c = new THREE.Color(spec.color);
  const bi = BONE_INDEX[spec.bone];
  // line weight: tiny parts and facial details get none, small accessories a finer line
  const w = spec.ol ?? (NO_LINE.has(spec.color) || bs.radius < 0.04 ? 0 : THREE.MathUtils.clamp(bs.radius / 0.16, 0.45, 1));
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = bi; sw[i * 4] = 1; ol[i] = w; sp[i] = gloss; }
  // smoothed normals for the inverted-hull outline: hard-edged parts (cones, boxes) don't split their line
  const pos = g.attributes.position, nor = g.attributes.normal;
  const acc = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < n; i++) { const k = key(i); const v = acc.get(k) ?? new THREE.Vector3(); v.x += nor.getX(i); v.y += nor.getY(i); v.z += nor.getZ(i); acc.set(k, v); }
  const on = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = acc.get(key(i))!.clone().normalize(); on[i * 3] = v.x; on[i * 3 + 1] = v.y; on[i * 3 + 2] = v.z; }
  if (spec.pattern) {
    const pt = spec.pattern, c2 = new THREE.Color(pt.c2), c3 = new THREE.Color(pt.c3 ?? pt.c2);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let pick = 0;
      if (pt.kind === 'stripes') pick = Math.floor(y * pt.freq + 1000) % 2;
      else if (pt.kind === 'check') pick = (Math.floor(x * pt.freq + 1000) + Math.floor(y * pt.freq + 1000) + Math.floor(z * pt.freq * 0.5 + 1000)) % 2;
      else pick = Math.floor(y * pt.freq + 1000) % 3;
      const cc = pick === 1 ? c2 : pick === 2 ? c3 : c;
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aOutline', new THREE.BufferAttribute(ol, 1));
  g.setAttribute('aSpec', new THREE.BufferAttribute(sp, 1));
  g.setAttribute('oNormal', new THREE.BufferAttribute(on, 3));
  out.push({ g, c: bs.center.clone(), r: bs.radius });
}

/**
 * Baked shading for depth: contact occlusion where parts meet (under the head, arm pits, accessories)
 * tinted lavender like the art bible's shadow colour, plus a soft top-to-bottom gradient.
 */
function bakeOcclusion(parts: Baked[]) {
  const tint = new THREE.Color('#9C8CC8');
  const q = new THREE.Vector3();
  for (const a of parts) {
    const pos = a.g.attributes.position, nor = a.g.attributes.normal, col = a.g.attributes.color as THREE.BufferAttribute;
    const isFace = (a.g.attributes.aOutline as THREE.BufferAttribute).getX(0) === 0;
    for (let i = 0; i < pos.count; i++) {
      q.set(pos.getX(i) + nor.getX(i) * 0.035, pos.getY(i) + nor.getY(i) * 0.035, pos.getZ(i) + nor.getZ(i) * 0.035);
      let occ = 0;
      if (!isFace) for (const b of parts) {
        if (b === a || b.r < 0.07) continue;
        const d = q.distanceTo(b.c) - b.r * 0.86;
        if (d < 0.09) occ += ((0.09 - Math.max(d, 0)) / 0.09) * 0.55;
      }
      // facing the ground is darker too
      occ += Math.max(0, -nor.getY(i)) * 0.18;
      const ao = 1 - Math.min(0.5, occ);
      const grad = 0.88 + 0.14 * THREE.MathUtils.smoothstep(pos.getY(i), 0.0, 1.1);
      const k = grad;
      col.setXYZ(i,
        col.getX(i) * k * THREE.MathUtils.lerp(tint.r, 1, ao),
        col.getY(i) * k * THREE.MathUtils.lerp(tint.g, 1, ao),
        col.getZ(i) * k * THREE.MathUtils.lerp(tint.b, 1, ao));
    }
  }
}

/** Eyes for one side (sg = +1 / -1), built on the head surface in the brawler's own style. */
function eyeParts(f: Face, sg: number): PartSpec[] {
  const es = f.eyeScale, x = sg * f.eyeX, y = f.eyeY;
  const z0 = headSurfaceZ(f, x, y) + f.faceZ;
  const face = (geo: THREE.BufferGeometry, color: string, p: number[], extra: Partial<PartSpec> = {}): PartSpec =>
    ({ geo, color, bone: 'eyes', p, ol: 0, gloss: 0, ...extra });
  // highlights always sit up-left so the light reads consistently across the cast
  const hl = (dx: number, dy: number, r: number, dz = 0.015) => face(sphere(r * es, 10, 8), C.white, [x + dx * es, y + dy * es, z0 + dz]);
  switch (f.eye) {
    case 'button': return [
      face(sphere(0.058 * es, 14, 10), C.eye, [x, y, z0 - 0.016], { s: [1, 1, 0.5] }),
      face(sphere(0.045 * es, 12, 10), '#5B4A7A', [x, y - 0.008 * es, z0 - 0.004], { s: [1, 1, 0.45] }),
      hl(-0.017, 0.02, 0.026), hl(0.02, -0.02, 0.012, 0.012),
    ];
    case 'tough': {
      const by = y + 0.085 * es, bx = x + sg * 0.005;
      return [
        face(sphere(0.052 * es, 12, 10), C.eye, [x, y, z0 - 0.014], { s: [1, 0.95, 0.5] }),
        hl(-0.014, 0.016, 0.02, 0.01),
        // stubby brows, inner ends a touch lower: a plucky (not grumpy) little bulldog (head bone, so blinks don't squash them)
        { geo: capsule(0.016, 0.045), color: C.nose, bone: 'head', p: [bx, by, headSurfaceZ(f, bx, by) + 0.004], r: [0, 0, sg * 0.16 - Math.PI / 2], s: [1, 1, 0.6], ol: 0, gloss: 0 },
      ];
    }
    case 'dot': return [
      face(sphere(0.044 * es, 12, 10), C.eye, [x, y, z0 - 0.008], { s: [1, 1.08, 0.6] }),
      hl(-0.012, 0.015, 0.018, 0.016), hl(0.013, -0.014, 0.008, 0.014),
    ];
    case 'almond': return [
      face(sphere(0.062 * es, 14, 10), C.eye, [x, y, z0 - 0.018], { s: [1.25, 0.82, 0.5], r: [0, 0, sg * 0.28] }),
      face(sphere(0.042 * es, 12, 10), '#5B4A7A', [x, y - 0.006 * es, z0 - 0.004], { s: [1, 1, 0.45] }),
      hl(-0.016, 0.014, 0.02, 0.012),
      // lash flick at the outer corner
      face(cone(0.016 * es, 0.06 * es, 6), C.eye, [x + sg * 0.072 * es, y + 0.03 * es, z0 - 0.008], { r: [0, 0, -sg * 1.0], s: [1, 1, 0.6] }),
    ];
    case 'sparkle': return [
      face(sphere(0.066 * es, 14, 12), C.eye, [x, y, z0 - 0.02], { s: [0.95, 1.12, 0.55] }),
      face(sphere(0.052 * es, 14, 10), '#6B58A0', [x, y - 0.008 * es, z0 - 0.006], { s: [0.9, 1, 0.45] }),
      face(sphere(0.028 * es, 10, 8), '#A893DD', [x, y - 0.034 * es, z0 + 0.004], { s: [1.25, 0.7, 0.4] }),
      hl(-0.02, 0.028, 0.028, 0.016), hl(0.022, -0.02, 0.013, 0.016),
      face(new THREE.OctahedronGeometry(0.017 * es, 0), C.white, [x + 0.02 * es, y + 0.034 * es, z0 + 0.012], { s: [1, 1, 0.3] }),
    ];
    case 'happy': {
      // closed, smiling "^^" eyes, turned to follow the curve of the head
      const yaw = Math.asin(THREE.MathUtils.clamp(x / (f.headR * f.headS[0]), -1, 1)) * 0.8;
      return [face(torus(0.046 * es, 0.013, Math.PI), C.eye, [x, y - 0.012, z0 + 0.002], { r: [0, yaw, 0], s: [1.1, 1, 1] })];
    }
    default: return [
      face(sphere(0.062 * es, 12, 10), C.eye, [x, y, z0 - 0.02], { s: [0.82, 1.18, 0.55] }),
      face(sphere(0.047 * es, 12, 10), '#5B4A7A', [x, y - 0.015, z0 - 0.005], { s: [0.8, 0.95, 0.45] }),
      hl(-0.018, 0.027, 0.024), hl(0.018, -0.023, 0.011, 0.017),
    ];
  }
}

/** Shared chibi base: face, body, limbs. */
function baseParts(pal: string[], o: { face: Face; bodyS?: number; noLegs?: boolean; bodyColor?: string; muzzle?: string | null; noArms?: boolean }): PartSpec[] {
  const f = o.face, body = pal[0], hr = f.headR, bs = o.bodyS ?? 1;
  const fz = hr / 0.36, cx = 0.225 * fz * (f.headS[0] / 1.04), cy = 0.79;
  const parts: PartSpec[] = [
    { geo: sphere(hr, 22, 16), color: body, bone: 'head', p: [0, HEAD_Y, 0], s: f.headS },
    { geo: sphere(0.27, 18, 12), color: o.bodyColor ?? body, bone: 'body', p: [0, 0.42, 0], s: [bs, bs * 1.02, bs * 0.9] },
    ...eyeParts(f, 1), ...eyeParts(f, -1),
    { geo: sphere(0.06, 10, 8), color: C.cheek, bone: 'head', p: [cx, cy, headSurfaceZ(f, cx, cy) - 0.008], s: [1, 0.62, 0.4] },
    { geo: sphere(0.06, 10, 8), color: C.cheek, bone: 'head', p: [-cx, cy, headSurfaceZ(f, cx, cy) - 0.008], s: [1, 0.62, 0.4] },
  ];
  const smile = (x: number, y: number, z: number, r: number) =>
    ({ geo: torus(r, 0.008, Math.PI).rotateZ(Math.PI), color: '#3A2C3F', bone: 'head' as BoneName, p: [x, y, z], ol: 0 });
  if (o.muzzle !== null) {
    parts.push({ geo: sphere(0.12, 18, 12), color: o.muzzle ?? C.cream, bone: 'head', p: [0, 0.76, 0.28], s: [1.25, 0.85, 0.7] });
    parts.push({ geo: sphere(0.038, 12, 10), color: C.nose, bone: 'head', p: [0, 0.8, 0.37], s: [1.3, 0.9, 0.8], ol: 0.35 });
    parts.push({ geo: sphere(0.012, 6, 4), color: C.white, bone: 'head', p: [-0.012, 0.812, 0.398] });
    // little "w" mouth under the nose
    parts.push(smile(0.019, 0.746, 0.36, 0.019), smile(-0.019, 0.746, 0.36, 0.019));
  } else if (f.mouth === 'o') {
    const my = 0.735, mz = headSurfaceZ(f, 0, my);
    parts.push(
      { geo: sphere(0.02, 10, 8), color: '#B0506E', bone: 'head', p: [0, my, mz - 0.002], s: [1, 1.1, 0.35], ol: 0 },
      { geo: torus(0.021, 0.008), color: '#3A2C3F', bone: 'head', p: [0, my, mz + 0.002], s: [1, 1.12, 1], ol: 0 },
    );
  } else {
    parts.push(smile(0, 0.722, headSurfaceZ(f, 0, 0.722) + 0.008, 0.028));
  }
  if (!o.noArms) {
    parts.push(
      { geo: capsule(0.07, 0.1), color: body, bone: 'armL', p: [0.31, 0.43, 0], r: [0, 0, 0.55] },
      { geo: capsule(0.07, 0.1), color: body, bone: 'armR', p: [-0.31, 0.43, 0], r: [0, 0, -0.55] },
      { geo: sphere(0.08, 10, 8), color: body, bone: 'armL', p: [0.36, 0.34, 0.02] },
      { geo: sphere(0.08, 10, 8), color: body, bone: 'armR', p: [-0.36, 0.34, 0.02] },
    );
  }
  if (!o.noLegs) {
    parts.push(
      { geo: capsule(0.09, 0.07), color: body, bone: 'legL', p: [0.12, 0.13, 0] },
      { geo: capsule(0.09, 0.07), color: body, bone: 'legR', p: [-0.12, 0.13, 0] },
      { geo: sphere(0.095, 10, 8), color: body, bone: 'legL', p: [0.12, 0.05, 0.04], s: [1, 0.6, 1.25] },
      { geo: sphere(0.095, 10, 8), color: body, bone: 'legR', p: [-0.12, 0.05, 0.04], s: [1, 0.6, 1.25] },
    );
  }
  return parts;
}

/**
 * Thin slab that hugs the front of an ellipsoid (rx, ry, rz) centred at (0, cy, 0): clothing, aprons, patches.
 * x spans ±w/2 at the bottom and ±topW/2 at the top (tapered bib), y spans [y0, y1].
 */
function hugPanel(o: { y0: number; y1: number; w: number; topW?: number; cy: number; rx: number; ry: number; rz: number; lift?: number; thick?: number }) {
  const g = new THREE.BoxGeometry(1, 1, 1, 12, 8, 1);
  const pos = g.attributes.position;
  const lift = o.lift ?? 0.016, thick = o.thick ?? 0.014;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getY(i) + 0.5;                       // 0 bottom → 1 top
    const y = o.y0 + (o.y1 - o.y0) * u;
    const halfW = THREE.MathUtils.lerp(o.w, o.topW ?? o.w, u) / 2;
    const x = pos.getX(i) * 2 * halfW;
    const k = 1 - (x / o.rx) ** 2 - ((y - o.cy) / o.ry) ** 2;
    const zs = Math.sqrt(Math.max(0.02, k)) * o.rz;
    pos.setXYZ(i, x, y, zs + lift + (pos.getZ(i) > 0 ? thick : 0));
  }
  g.computeVertexNormals();
  return g;
}

const W = [-0.34, 0.33, 0.16]; // weapon anchor (right hand, slightly forward)
const wp = (x: number, y: number, z: number) => [W[0] + x, W[1] + y, W[2] + z];

/**
 * Boogie's denim apron: hugs the round belly, tapered bib with straps, darker hems with stitches,
 * a heart pocket — and a round cut-out so the belly button stays on show.
 */
function boogieApron(pal: string[]): PartSpec[] {
  const apron = pal[4] ?? '#8EC5F0';
  const trim = '#' + new THREE.Color(apron).offsetHSL(0, 0.06, -0.2).getHexString();
  const stitch = '#FFFFFF';
  const belly = { cy: 0.42, rx: 0.27 * 1.14, ry: 0.27 * 1.14 * 1.02, rz: 0.27 * 1.14 * 0.9 };
  const surf = (x: number, y: number, lift: number) => {
    const k = 1 - (x / belly.rx) ** 2 - ((y - belly.cy) / belly.ry) ** 2;
    return Math.sqrt(Math.max(0.02, k)) * belly.rz + lift;
  };
  const parts: PartSpec[] = [
    { geo: hugPanel({ ...belly, y0: 0.24, y1: 0.53, w: 0.42, topW: 0.27 }), color: apron, bone: 'body', ol: 0.55 },
    // hems
    { geo: hugPanel({ ...belly, y0: 0.235, y1: 0.272, w: 0.43, lift: 0.024, thick: 0.012 }), color: trim, bone: 'body', ol: 0.4 },
    { geo: hugPanel({ ...belly, y0: 0.505, y1: 0.535, w: 0.28, lift: 0.024, thick: 0.012 }), color: trim, bone: 'body', ol: 0.4 },
    // straps over the shoulders
    { geo: capsule(0.018, 0.16), color: trim, bone: 'body', p: [0.13, 0.6, 0.2], r: [-0.55, 0, -0.35], ol: 0.35 },
    { geo: capsule(0.018, 0.16), color: trim, bone: 'body', p: [-0.13, 0.6, 0.2], r: [-0.55, 0, 0.35], ol: 0.35 },
    { geo: sphere(0.022, 8, 6), color: '#F5D27A', bone: 'body', p: [0.125, 0.52, surf(0.125, 0.52, 0.04)], ol: 0 },
    { geo: sphere(0.022, 8, 6), color: '#F5D27A', bone: 'body', p: [-0.125, 0.52, surf(-0.125, 0.52, 0.04)], ol: 0 },
    // round cut-out: belly skin shows through, ringed by the trim, belly button on top
    { geo: cyl(0.056, 0.056, 0.012, 20), color: pal[0], bone: 'body', p: [0, 0.42, surf(0, 0.42, 0.028)], r: [Math.PI / 2, 0, 0], ol: 0 },
    { geo: torus(0.058, 0.011), color: trim, bone: 'body', p: [0, 0.42, surf(0, 0.42, 0.034)], ol: 0 },
    { geo: sphere(0.03, 10, 8), color: pal[3] ?? '#FFAAA5', bone: 'body', p: [0, 0.42, surf(0, 0.42, 0.036)], s: [1, 1, 0.45], ol: 0 },
    // heart pocket
    { geo: sphere(0.028, 10, 8), color: trim, bone: 'body', p: [-0.019, 0.322, surf(-0.019, 0.322, 0.03)], s: [1, 1, 0.4], ol: 0 },
    { geo: sphere(0.028, 10, 8), color: trim, bone: 'body', p: [0.019, 0.322, surf(0.019, 0.322, 0.03)], s: [1, 1, 0.4], ol: 0 },
    { geo: cone(0.04, 0.05, 12).rotateZ(Math.PI), color: trim, bone: 'body', p: [0, 0.297, surf(0, 0.297, 0.03)], s: [1, 1, 0.38], ol: 0 },
  ];
  // stitches along both hems
  for (let i = 0; i < 9; i++) {
    const x = -0.18 + i * 0.045;
    parts.push({ geo: sphere(0.006, 6, 4), color: stitch, bone: 'body', p: [x, 0.253, surf(x, 0.253, 0.04)], ol: 0 });
  }
  for (let i = 0; i < 5; i++) {
    const x = -0.1 + i * 0.05;
    parts.push({ geo: sphere(0.006, 6, 4), color: stitch, bone: 'body', p: [x, 0.52, surf(x, 0.52, 0.04)], ol: 0 });
  }
  return parts;
}

function characterParts(id: CharacterId, pal: string[]): PartSpec[] {
  const [main, acc, det, extra] = pal;
  const face = FACES[id];
  switch (id) {
    case 'toto': return [
      ...baseParts(pal, { face }),
      { geo: sphere(0.1), color: main, bone: 'earL', p: [0.27, 1.14, -0.03], s: [1, 1, 0.7] },
      { geo: sphere(0.1), color: main, bone: 'earR', p: [-0.27, 1.14, -0.03], s: [1, 1, 0.7] },
      { geo: sphere(0.055), color: extra, bone: 'earL', p: [0.28, 1.15, 0.03], s: [1, 1, 0.5] },
      { geo: sphere(0.055), color: extra, bone: 'earR', p: [-0.28, 1.15, 0.03], s: [1, 1, 0.5] },
      { geo: hemi(0.375), color: acc, bone: 'head', p: [0, 0.92, -0.01], s: [1.05, 0.9, 1.05], grp: 'hat' },
      { geo: cyl(0.4, 0.4, 0.035, 20), color: acc, bone: 'head', p: [0, 0.93, 0.02], grp: 'hat' },
      { geo: torus(0.07, 0.024), color: C.metalDark, bone: 'head', p: [0.11, 1.04, 0.35], r: [-0.35, 0, 0], grp: 'hat' },
      { geo: torus(0.07, 0.024), color: C.metalDark, bone: 'head', p: [-0.11, 1.04, 0.35], r: [-0.35, 0, 0], grp: 'hat' },
      { geo: sphere(0.062, 10, 8), color: C.glass, bone: 'head', p: [0.11, 1.04, 0.345], s: [1, 1, 0.4], r: [-0.35, 0, 0], grp: 'hat' },
      { geo: sphere(0.062, 10, 8), color: C.glass, bone: 'head', p: [-0.11, 1.04, 0.345], s: [1, 1, 0.4], r: [-0.35, 0, 0], grp: 'hat' },
      { geo: box(0.3, 0.3, 0.16), color: det, bone: 'body', p: [0, 0.46, -0.25] },
      { geo: cyl(0.1, 0.1, 0.28, 14), color: acc, bone: 'body', p: [0, 0.62, -0.26], r: [0, 0, Math.PI / 2] },
      { geo: cyl(0.07, 0.08, 0.34, 12), color: C.metal, bone: 'weapon', p: wp(0, 0.02, 0.08), r: [Math.PI / 2, 0, 0] },
      ...[0, 1, 2].map((i): PartSpec => ({ geo: cyl(0.022, 0.022, 0.24, 6), color: C.metalDark, bone: 'weapon', p: wp(Math.cos(i * 2.09) * 0.035, 0.02 + Math.sin(i * 2.09) * 0.035, 0.32), r: [Math.PI / 2, 0, 0] })),
      { geo: cyl(0.085, 0.085, 0.06, 12), color: acc, bone: 'weapon', p: wp(0, 0.02, -0.07), r: [Math.PI / 2, 0, 0] },
    ];
    case 'boogie': return [
      ...baseParts(pal, { face, bodyS: 1.14, muzzle: null }),
      { geo: sphere(0.13), color: det, bone: 'head', p: [0.1, 0.74, 0.25], s: [1, 0.8, 0.8] },
      { geo: sphere(0.13), color: det, bone: 'head', p: [-0.1, 0.74, 0.25], s: [1, 0.8, 0.8] },
      { geo: sphere(0.055), color: C.nose, bone: 'head', p: [0, 0.83, 0.35], s: [1.4, 1, 1] },
      { geo: sphere(0.03, 8, 6), color: C.white, bone: 'head', p: [0.05, 0.69, 0.33] },
      { geo: sphere(0.03, 8, 6), color: C.white, bone: 'head', p: [-0.05, 0.69, 0.33] },
      { geo: sphere(0.11), color: acc, bone: 'earL', p: [0.32, 0.97, 0], s: [0.55, 1, 0.45], r: [0, 0, 0.7] },
      { geo: sphere(0.11), color: acc, bone: 'earR', p: [-0.32, 0.97, 0], s: [0.55, 1, 0.45], r: [0, 0, -0.7] },
      { geo: cyl(0.44, 0.44, 0.04, 22), color: acc, bone: 'head', p: [0, 1.12, -0.02], r: [-0.12, 0, 0], s: [1, 1, 0.92], grp: 'hat' },
      { geo: cyl(0.21, 0.26, 0.22, 16), color: acc, bone: 'head', p: [0, 1.24, -0.03], r: [-0.12, 0, 0], grp: 'hat' },
      { geo: cyl(0.265, 0.265, 0.05, 16), color: extra, bone: 'head', p: [0, 1.16, -0.02], r: [-0.12, 0, 0], grp: 'hat' },
      ...boogieApron(pal).map((p): PartSpec => ({ ...p, grp: 'top' })),
      { geo: cyl(0.035, 0.035, 0.42, 8), color: C.metal, bone: 'weapon', p: wp(0.035, 0.03, 0.18), r: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.035, 0.035, 0.42, 8), color: C.metal, bone: 'weapon', p: wp(-0.035, 0.03, 0.18), r: [Math.PI / 2, 0, 0] },
      { geo: box(0.1, 0.11, 0.22), color: C.wood, bone: 'weapon', p: wp(0, -0.01, -0.06) },
    ];
    case 'popo': return [
      ...baseParts(pal, { face, muzzle: null, noArms: true }),
      { geo: sphere(0.22), color: det, bone: 'body', p: [0, 0.4, 0.12], s: [1, 1.1, 0.62], grp: 'top' },
      { geo: sphere(0.3, 18, 12), color: det, bone: 'head', p: [0, 0.8, 0.16], s: [1.02, 0.78, 0.66] },
      { geo: cone(0.06, 0.13, 10), color: extra, bone: 'head', p: [0, 0.8, 0.39], r: [Math.PI / 2, 0, 0], s: [1.2, 1, 0.8] },
      { geo: sphere(0.14), color: main, bone: 'armL', p: [0.31, 0.42, 0], s: [0.32, 1, 0.62], r: [0, 0, 0.45] },
      { geo: sphere(0.14), color: main, bone: 'armR', p: [-0.31, 0.42, 0], s: [0.32, 1, 0.62], r: [0, 0, -0.45] },
      { geo: hemi(0.38), color: acc, bone: 'head', p: [0, 0.94, -0.01], s: [1.04, 0.85, 1.04], grp: 'hat' },
      { geo: cyl(0.42, 0.42, 0.03, 20), color: acc, bone: 'head', p: [0, 0.95, 0.03], s: [1, 1, 1.05], grp: 'hat' },
      { geo: cyl(0.07, 0.07, 0.06, 10), color: C.white, bone: 'head', p: [0, 1.17, 0.27], r: [1.1, 0, 0], grp: 'hat' },
      { geo: sphere(0.09), color: extra, bone: 'legL', p: [0.12, 0.04, 0.07], s: [1.1, 0.5, 1.5], grp: 'shoes' },
      { geo: sphere(0.09), color: extra, bone: 'legR', p: [-0.12, 0.04, 0.07], s: [1.1, 0.5, 1.5], grp: 'shoes' },
      { geo: sphere(0.1), color: C.metalDark, bone: 'weapon', p: wp(0.0, 0.0, 0.0) },
      { geo: torus(0.035, 0.012), color: C.gold, bone: 'weapon', p: wp(0, 0.11, 0) },
    ];
    case 'luna': return [
      ...baseParts(pal, { face, muzzle: null }),
      { geo: cone(0.11, 0.32, 10), color: main, bone: 'earL', p: [0.19, 1.22, -0.02], r: [0, 0, -0.28] },
      { geo: cone(0.11, 0.32, 10), color: main, bone: 'earR', p: [-0.19, 1.22, -0.02], r: [0, 0, 0.28] },
      { geo: cone(0.065, 0.2, 8), color: det, bone: 'earL', p: [0.185, 1.2, 0.03], r: [0, 0, -0.28] },
      { geo: cone(0.065, 0.2, 8), color: det, bone: 'earR', p: [-0.185, 1.2, 0.03], r: [0, 0, 0.28] },
      { geo: cone(0.12, 0.2, 12), color: det, bone: 'head', p: [0, 0.77, 0.36], r: [Math.PI / 2, 0, 0], s: [1.15, 1, 0.8] },
      { geo: sphere(0.035), color: C.nose, bone: 'head', p: [0, 0.78, 0.46] },
      { geo: sphere(0.14), color: det, bone: 'head', p: [0.2, 0.72, 0.18], s: [1, 0.7, 0.8] },
      { geo: sphere(0.14), color: det, bone: 'head', p: [-0.2, 0.72, 0.18], s: [1, 0.7, 0.8] },
      { geo: sphere(0.17, 14, 10), color: main, bone: 'tail', p: [0, 0.42, -0.42], s: [0.85, 0.85, 1.7], r: [0.7, 0, 0] },
      { geo: sphere(0.12, 12, 8), color: det, bone: 'tail', p: [0, 0.6, -0.6], s: [0.9, 0.9, 1.2], r: [0.7, 0, 0] },
      { geo: cone(0.36, 0.5, 5), color: extra, bone: 'cape', p: [0, 0.42, -0.06], r: [0.12, Math.PI / 5, 0], s: [1, 1, 0.75] },
      { geo: new THREE.OctahedronGeometry(0.07), color: acc, bone: 'body', p: [0, 0.6, 0.24], s: [1, 1, 0.5], grp: 'necklace' },
      { geo: box(0.06, 0.07, 0.38), color: C.wood, bone: 'weapon', p: wp(0, 0, 0.1) },
      { geo: torus(0.2, 0.025, Math.PI), color: acc, bone: 'weapon', p: wp(0, 0.0, 0.26), r: [Math.PI / 2, 0, 0] },
      { geo: new THREE.OctahedronGeometry(0.05), color: acc, bone: 'weapon', p: wp(0, 0, 0.32) },
    ];
    case 'kiki': return [
      ...baseParts(pal, { face }),
      { geo: sphere(0.25, 18, 12), color: acc, bone: 'head', p: [0, 0.82, 0.17], s: [1.15, 0.85, 0.62] },
      { geo: sphere(0.11), color: main, bone: 'earL', p: [0.37, 0.88, 0], s: [0.6, 1, 1] },
      { geo: sphere(0.11), color: main, bone: 'earR', p: [-0.37, 0.88, 0], s: [0.6, 1, 1] },
      { geo: sphere(0.06), color: det, bone: 'earL', p: [0.4, 0.88, 0.02], s: [0.5, 1, 1] },
      { geo: sphere(0.06), color: det, bone: 'earR', p: [-0.4, 0.88, 0.02], s: [0.5, 1, 1] },
      { geo: hemi(0.33), color: '#E8D2A6', bone: 'head', p: [0, 1.0, -0.02], s: [1.05, 0.75, 1.05], grp: 'hat' },
      { geo: cyl(0.43, 0.43, 0.03, 20), color: '#E8D2A6', bone: 'head', p: [0, 1.0, 0], grp: 'hat' },
      { geo: cyl(0.335, 0.335, 0.05, 18), color: extra, bone: 'head', p: [0, 1.03, -0.02], grp: 'hat' },
      { geo: cyl(0.25, 0.27, 0.12, 14), color: '#E8D2A6', bone: 'hips', p: [0, 0.27, 0], grp: 'pants' },
      { geo: torus(0.17, 0.04, Math.PI * 1.4), color: main, bone: 'tail', p: [0, 0.48, -0.36], r: [0, Math.PI / 2, 0.4] },
      { geo: cone(0.07, 0.12, 8), color: det, bone: 'tail', p: [0.05, 0.64, -0.42], r: [0, 0, -1.4] },
      { geo: cone(0.07, 0.12, 8), color: det, bone: 'tail', p: [-0.05, 0.64, -0.42], r: [0, 0, 1.4] },
      { geo: bananaGeometry(0.06, 0.87), color: BANANA.body, bone: 'weapon', p: wp(0.02, 0, 0.12), r: [0, Math.PI / 2, 0.5], s: 0.48 },
      { geo: bananaGeometry(0, 0.07), color: BANANA.tip, bone: 'weapon', p: wp(0.02, 0, 0.12), r: [0, Math.PI / 2, 0.5], s: 0.48, ol: 0.4 },
      { geo: bananaGeometry(0.86, 1), color: BANANA.stem, bone: 'weapon', p: wp(0.02, 0, 0.12), r: [0, Math.PI / 2, 0.5], s: 0.48, ol: 0.4 },
    ];
    case 'mongle': {
      const tentacles: PartSpec[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.52;
        const x = Math.sin(a), z = Math.cos(a);
        tentacles.push(
          { geo: capsule(0.075, 0.16), color: main, bone: `t${i}` as BoneName, p: [x * 0.26, 0.12, z * 0.26], r: [z * 1.1, 0, -x * 1.1] },
          { geo: sphere(0.065, 8, 6), color: main, bone: `t${i}` as BoneName, p: [x * 0.36, 0.06, z * 0.36], s: [1, 0.7, 1] },
          { geo: sphere(0.028, 6, 4), color: det, bone: `t${i}` as BoneName, p: [x * 0.31, 0.06, z * 0.31] },
        );
      }
      return [
        ...baseParts(pal, { face, noLegs: true, muzzle: null, noArms: true }).filter((p) => p.bone !== 'body'),
        { geo: sphere(0.24, 14, 10), color: main, bone: 'body', p: [0, 0.32, 0], s: [1.2, 0.75, 1.2] },
        ...tentacles,
        { geo: torus(0.36, 0.055), color: acc, bone: 'body', p: [0, 0.48, 0], r: [Math.PI / 2, 0, 0] },
        { geo: torus(0.3, 0.04), color: acc, bone: 'head', p: [0, 0.85, 0.3], s: [1.15, 0.95, 1] },
        { geo: cyl(0.08, 0.08, 0.3, 10), color: det, bone: 'body', p: [0.11, 0.62, -0.38] },
        { geo: cyl(0.08, 0.08, 0.3, 10), color: det, bone: 'body', p: [-0.11, 0.62, -0.38] },
        { geo: sphere(0.08, 10, 6), color: acc, bone: 'body', p: [0.11, 0.77, -0.38] },
        { geo: sphere(0.08, 10, 6), color: acc, bone: 'body', p: [-0.11, 0.77, -0.38] },
        { geo: sphere(0.07), color: main, bone: 'armR', p: [-0.38, 0.38, 0.06], s: [0.8, 1.3, 0.8] },
        { geo: sphere(0.07), color: main, bone: 'armL', p: [0.38, 0.38, 0.06], s: [0.8, 1.3, 0.8] },
        { geo: sphere(0.1, 12, 8), color: det, bone: 'weapon', p: wp(-0.04, 0.02, 0) },
        { geo: cyl(0.03, 0.04, 0.2, 8), color: acc, bone: 'weapon', p: wp(-0.04, 0.02, 0.15), r: [Math.PI / 2, 0, 0] },
      ];
    }
  }
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function characterGeometry(id: CharacterId, palette: string[], items: string[] = []) {
  const outfit = [...items].sort();
  const key = id + palette.join() + '|' + outfit.join(',');
  let g = geoCache.get(key);
  if (!g) {
    const list: Baked[] = [];
    const worn = slotsOf(outfit);
    const [hx, , hz] = FACES[id].headS;
    const specs = characterParts(id, palette).filter((p) => !p.grp || !worn.has(p.grp))
      .map((p) => (p.grp === 'hat' ? { ...p, post: [hx / 1.04, 1, hz] } : p))
      .concat(outfitParts(id, outfit));
    for (const spec of specs) bake(spec, list);
    bakeOcclusion(list);
    g = mergeGeometries(list.map((b) => b.g), false)!;
    g.computeBoundingSphere();
    g.boundingSphere!.radius = 1.6; // animated, keep generous for culling
    geoCache.set(key, g);
  }
  return g;
}

/** One cosmetic on its own (fitted to Toto's proportions) — used for shop thumbnails. */
export function itemPreviewGeometry(itemId: string): THREE.BufferGeometry | null {
  const parts = outfitParts('toto', [itemId]);
  if (!parts.length) return null;
  const list: Baked[] = [];
  for (const spec of parts) bake(spec, list);
  return mergeGeometries(list.map((b) => b.g), false);
}

function darker(hex: string, k = 0.45) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.7 + 0.15), hsl.l * k);
}

export type AttackStyle = 'rapid' | 'shotgun' | 'throw' | 'bow' | 'boomerang' | 'bubble';
export type SuperStyle = 'gatling' | 'bigbang' | 'megabomb' | 'meteor' | 'tornado' | 'prison';

export const STYLE_FOR: Record<string, AttackStyle> = { bullet: 'rapid', pellet: 'shotgun', arc: 'throw', arrow: 'bow', boomerang: 'boomerang', bubble: 'bubble' };

export interface AnimState {
  dt: number;
  time: number;
  speed: number;        // 0..1 of run speed
  facing?: number;      // legacy: single yaw for lobby/portraits
  moveYaw?: number;     // world yaw of movement (three.js rotation.y)
  aimYaw?: number;      // world yaw of aim
  aiming?: boolean;     // upper body locks to aim
  dashing?: boolean;
  superActive?: SuperStyle | null; // continuous supers (gatling / tornado)
  lowHp?: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** 0→1 quickly, then 1→0 slowly: strike + recover envelope. */
const strike = (t: number, peak = 0.12) => (t < peak ? easeOut(t / peak) : Math.pow(Math.max(0, 1 - (t - peak) / (1 - peak)), 2));

/** Damped spring integrated in fixed sub-steps (stable at any frame rate). */
class Spring {
  v = 0; x = 0;
  constructor(public k: number, public d: number) {}
  step(dt: number, target = 0) {
    for (let rem = dt; rem > 1e-6; rem -= 1 / 120) {
      const h = Math.min(rem, 1 / 120);
      this.v += (-(this.x - target) * this.k - this.v * this.d) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/**
 * Procedural animation: lower body follows movement, upper body twists toward the aim,
 * weapon-specific attack actions, super poses, directional jelly hit reactions and
 * spring-driven secondary motion (ears, tail, cape, tentacles).
 */
export class ChibiModel {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly outline: THREE.SkinnedMesh;
  readonly material: ToonMaterial;
  readonly outlineMat: THREE.ShaderMaterial;
  private bones: Record<BoneName, THREE.Bone>;
  private rest: Record<string, THREE.Vector3> = {};
  private runPhase = Math.random() * 10;
  private lowerYaw = 0;
  private twist = 0;
  private runDir = 1;
  private act: { style: AttackStyle; t: number; dur: number; power: number } | null = null;
  private sup: { style: SuperStyle; t: number; dur: number } | null = null;
  private weaponHideT = 0;
  private squash = new Spring(260, 14);
  private recoil = new Spring(520, 26);
  private hitX = new Spring(170, 9);
  private hitZ = new Spring(170, 9);
  private hop = new Spring(90, 9);
  private ear = new Spring(120, 9);
  private lean = new Spring(60, 12);
  private lastSpeed = 0;
  private lastMoveYaw = 0;
  private blinkT = 2 + Math.random() * 3;
  private flash = 0;
  private dropT = 1;
  private dropH = 0;
  private stepSign = 0;
  dead = false;
  deathT = 0;
  deathDir = new THREE.Vector2(0, 1);
  victory = false;
  stunned = false;
  weaponAway = false; // boomerang in flight
  onStep?: () => void;
  onLand?: () => void;

  constructor(readonly charId: CharacterId, palette: string[], outlineColor?: THREE.ColorRepresentation, readonly items: string[] = []) {
    const geo = characterGeometry(charId, palette, items);
    this.material = toonMaterial({ vertexColors: true, rim: 0.5, spec: 0.38, specMask: true, shadowTint: '#B7A6E6' });
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    // fine coloured line art: each part's own colour darkened, weight per part, smoothed hull normals
    this.outlineMat = outlineMaterial(outlineColor ?? darker(palette[0], 0.3), 0.017, { lineArt: true });
    this.outline = new THREE.SkinnedMesh(geo, this.outlineMat);
    const bones = {} as Record<BoneName, THREE.Bone>;
    for (const [name, parent, pos] of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      const pp = parent ? BONES.find(([n]) => n === parent)![2] : [0, 0, 0];
      b.position.set(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]);
      if (parent) bones[parent].add(b);
      bones[name] = b;
      this.rest[name] = b.position.clone();
    }
    this.bones = bones;
    const list = BONES.map(([n]) => bones[n]);
    const skeleton = new THREE.Skeleton(list);
    this.mesh.add(bones.root);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(skeleton);
    this.outline.bind(skeleton, this.mesh.bindMatrix);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = this.outline.frustumCulled = true;
    // SkinnedMesh would lazily compute bounds from the first pose (e.g. mid-air during the spawn
    // drop) and then get culled on the ground. A fixed generous sphere covers every pose.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.6);
    this.outline.boundingSphere = this.mesh.boundingSphere;
    this.group.add(this.mesh, this.outline);
  }

  // ───────────────────────── triggers
  /** Start of an attack (one per trigger pull). */
  triggerAttack(style: AttackStyle = 'rapid', power = 1) {
    const dur = { rapid: 0.5, shotgun: 0.6, throw: 0.55, bow: 0.55, boomerang: 0.5, bubble: 0.45 }[style];
    this.act = { style, t: 0, dur, power };
    if (style === 'throw') this.weaponHideT = 0.42;
    if (style === 'shotgun') { this.hop.v += 1.2 * power; this.squash.v -= 3 * power; }
    if (style === 'bubble') this.squash.v += 3.5;
    this.recoil.v += { rapid: 0, shotgun: 16, throw: 4, bow: 10, boomerang: 6, bubble: 6 }[style] * power;
  }
  /** Every projectile volley (each bullet of a burst): small kick. */
  kick(amount = 1) {
    this.recoil.v += 7 * amount;
    this.squash.v -= 0.6 * amount;
  }
  triggerSuper(style: SuperStyle | string = 'bigbang') {
    const st = style as SuperStyle;
    const dur = ({ gatling: 0.35, bigbang: 0.9, megabomb: 1.0, meteor: 0.95, tornado: 0.4, prison: 0.9 } as Record<string, number>)[st] ?? 0.9;
    this.sup = { style: st, t: 0, dur };
    this.squash.v += 6;
    if (st === 'megabomb') this.hop.v += 4;
    if (st === 'bigbang' || st === 'meteor') this.recoil.v += 30;
    this.flash = 0.6;
  }
  /** `dx,dz` = world direction the hit travels (from attacker toward target). */
  triggerHit(dx = 0, dz = 0, power = 1) {
    this.flash = 1;
    // world → model-local (model faces +z, yawed by lowerYaw)
    const c = Math.cos(this.lowerYaw), s = Math.sin(this.lowerYaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const p = clamp(power, 0.4, 2.5);
    this.hitX.v += -lx * 7 * p; // top of the body moves along the hit
    this.hitZ.v += -lz * 7 * p;
    this.squash.v -= 4 * p;
    if (p > 1.4) this.hop.v += 1.5 * p;
    this.deathDir.set(dx, dz);
  }
  triggerJump() { this.squash.v += 5; this.hop.v += 3; }
  /** Spawn: fall from the sky and land with a squash. */
  drop(height = 7, delay = 0) { this.dropT = -delay * 1.6; this.dropH = height; }

  setOpacity(v: number) {
    this.material.uniforms.uOpacityDither.value = v;
    (this.outlineMat.uniforms.uOpacityDither as { value: number }).value = v;
  }

  // ───────────────────────── per-frame
  update(s: AnimState) {
    const { dt, time } = s;
    const B = this.bones;
    for (const k in this.rest) { B[k as BoneName].position.copy(this.rest[k]); B[k as BoneName].rotation.set(0, 0, 0); B[k as BoneName].scale.set(1, 1, 1); }
    this.flash = Math.max(0, this.flash - dt * 8);
    this.material.uniforms.uFlash.value = this.flash * 0.85;

    const moveYaw = s.moveYaw ?? s.facing ?? 0;
    const aimYaw = s.aimYaw ?? s.facing ?? moveYaw;
    const sp = s.speed;

    // lower body heading: follow movement (backpedal when aiming behind), else settle toward aim
    let lowerTarget = sp > 0.1 ? moveYaw : aimYaw;
    this.runDir = 1;
    if (sp > 0.1 && s.aiming && Math.abs(wrap(aimYaw - moveYaw)) > 1.95) { lowerTarget = moveYaw + Math.PI; this.runDir = -1; }
    this.lowerYaw += wrap(lowerTarget - this.lowerYaw) * Math.min(1, dt * (sp > 0.1 ? 16 : 6));
    // upper-body twist toward aim (clamped; feet catch up beyond the limit)
    let tw = wrap(aimYaw - this.lowerYaw);
    const lim = 1.35;
    if (Math.abs(tw) > lim) { this.lowerYaw += tw - Math.sign(tw) * lim; tw = Math.sign(tw) * lim; }
    this.twist += (tw - this.twist) * Math.min(1, dt * 22);
    this.group.rotation.y = this.lowerYaw;
    const turnRate = wrap(moveYaw - this.lastMoveYaw) / Math.max(dt, 1e-3);
    this.lastMoveYaw = moveYaw;
    const bank = this.lean.step(dt, clamp(turnRate * 0.04 * sp, -0.35, 0.35));

    const accel = (sp - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = sp;
    const sq = clamp(this.squash.step(dt), -0.4, 0.4);
    const rc = clamp(this.recoil.step(dt), -0.6, 0.9);
    const hx = clamp(this.hitX.step(dt), -0.7, 0.7);
    const hz = clamp(this.hitZ.step(dt), -0.7, 0.7);
    const hp = Math.max(0, this.hop.step(dt));
    const earS = this.ear.step(dt, clamp(accel, -40, 40) * -0.004);

    if (this.dead) { this.updateDeath(dt); return; }

    // spawn drop
    let dropY = 0;
    if (this.dropT < 1) {
      this.dropT = Math.min(1, this.dropT + dt * 1.6);
      const k = Math.max(0, this.dropT);
      dropY = this.dropH * (1 - k * k);
      if (this.dropT >= 1) { this.squash.v -= 9; this.hop.v += 1.5; this.onLand?.(); }
    }

    // locomotion
    const runK = sp > 0.05 ? 1 : 0;
    this.runPhase += dt * (8 + sp * 8) * runK * this.runDir;
    const ph = this.runPhase;
    const idle = 1 - sp;
    const stepBounce = runK ? Math.abs(Math.sin(ph)) : 0;
    const sgn = Math.sign(Math.sin(ph));
    if (runK && sgn !== this.stepSign) { this.stepSign = sgn; if (sp > 0.4) this.onStep?.(); }
    const breathe = Math.sin(time * (s.lowHp ? 7 : 2.6)) * (s.lowHp ? 0.035 : 0.02);
    const sqTotal = sq + (runK ? (stepBounce - 0.5) * 0.09 * sp : breathe);
    B.root.scale.set(1 - sqTotal * 0.5, 1 + sqTotal, 1 - sqTotal * 0.5);
    B.root.position.y = dropY + hp * 0.25;

    B.hips.position.y += stepBounce * 0.07 * sp + Math.sin(time * 2.6) * 0.008 * idle;
    B.hips.rotation.z = bank * 0.6;
    B.body.rotation.x = 0.18 * sp * this.runDir;
    B.body.rotation.y = this.twist * 0.75 + Math.sin(ph) * 0.1 * sp;
    B.body.rotation.z = -bank * 0.4;
    B.head.rotation.y = this.twist * 0.25;
    B.head.rotation.x = -0.1 * sp + Math.sin(time * 1.7) * 0.03 * idle + (s.lowHp ? 0.12 : 0);
    B.head.rotation.z = Math.sin(time * 1.3) * 0.05 * idle;
    B.legL.rotation.x = Math.sin(ph) * 0.85 * sp;
    B.legR.rotation.x = -Math.sin(ph) * 0.85 * sp;
    B.legL.position.y += Math.max(0, -Math.cos(ph)) * 0.06 * sp;
    B.legR.position.y += Math.max(0, Math.cos(ph)) * 0.06 * sp;
    B.armL.rotation.x = -Math.sin(ph) * 0.9 * sp;
    B.armL.rotation.z = 0.15 + Math.sin(time * 2) * 0.05 * idle;
    B.armR.rotation.x = s.aiming ? -1.35 : -0.9 - 0.2 * sp;
    B.armR.rotation.z = -0.05;

    if (s.dashing) {
      B.body.rotation.x += 0.7; B.head.rotation.x -= 0.4;
      B.armL.rotation.x = 1.2; B.armR.rotation.x = 0.6;
      B.legL.rotation.x = 0.9; B.legR.rotation.x = 0.7;
    }

    // weapon recoil (all weapons)
    B.armR.rotation.x += rc * 0.55;
    B.weapon.position.z -= rc * 0.12;
    B.body.rotation.x -= rc * 0.12;
    B.root.position.z -= rc * 0.06;

    if (this.act) {
      const a = this.act;
      a.t += dt / a.dur;
      this.applyAttack(a.style, Math.min(1, a.t), a.power, time);
      if (a.t >= 1) this.act = null;
    }
    if (this.sup) {
      const u = this.sup;
      u.t += dt / u.dur;
      this.applySuper(u.style, Math.min(1, u.t), time);
      if (u.t >= 1) this.sup = null;
    }
    if (s.superActive === 'gatling') {
      B.legL.rotation.z = 0.28; B.legR.rotation.z = -0.28;
      B.body.rotation.x -= 0.15;
      B.armL.rotation.x = -1.25; B.armL.rotation.z = -0.55;
      B.root.position.x += (Math.random() - 0.5) * 0.035;
      B.root.position.z += (Math.random() - 0.5) * 0.035;
      B.weapon.rotation.z = time * 40;
    } else if (s.superActive === 'tornado') {
      B.root.rotation.y = time * 16;
      B.armL.rotation.z = 1.5; B.armR.rotation.z = -1.5; B.armR.rotation.x = 0;
      B.hips.position.y += Math.abs(Math.sin(time * 8)) * 0.12;
    }

    // directional jelly hit reaction
    B.body.rotation.x -= hz * 0.9;
    B.body.rotation.z += hx * 0.9;
    B.head.rotation.x -= hz * 0.6;
    B.head.rotation.z += hx * 0.5;
    const hitMag = Math.min(1, Math.hypot(hx, hz) * 2.5);
    B.eyes.scale.y = Math.min(B.eyes.scale.y, 1 - hitMag * 0.8);
    B.armL.rotation.z += hitMag * 0.8; B.armR.rotation.z -= hitMag * 0.5;

    if (this.stunned) {
      B.root.rotation.z = Math.sin(time * 10) * 0.12;
      B.head.rotation.y += Math.sin(time * 6) * 0.3;
      B.eyes.scale.y = 0.25;
    }
    if (this.victory) {
      const j = Math.abs(Math.sin(time * 5));
      B.hips.position.y += j * 0.3;
      B.armL.rotation.z = 2.4 + Math.sin(time * 10) * 0.3;
      B.armR.rotation.x = -2.6;
      B.root.rotation.y = Math.sin(time * 2.5) * 0.4;
      B.root.scale.set(1 - j * 0.05, 1 + j * 0.08, 1 - j * 0.05);
    }

    // weapon thrown / in flight
    this.weaponHideT = Math.max(0, this.weaponHideT - dt);
    if (this.weaponAway || this.weaponHideT > 0) B.weapon.scale.setScalar(0.001);
    else if (this.act?.style === 'throw') B.weapon.scale.setScalar(Math.max(0.001, easeOutBack(clamp((this.act.t * this.act.dur - 0.42) / 0.12, 0, 1))));

    this.blinkT -= dt;
    if (this.blinkT < 0.12) B.eyes.scale.y = Math.min(B.eyes.scale.y, 0.15);
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;

    // secondary motion
    const flop = earS + Math.sin(time * 3) * 0.04 + stepBounce * 0.14 * sp + hitMag * 0.4 + (s.lowHp ? 0.35 : 0);
    B.earL.rotation.z -= flop * 0.6; B.earR.rotation.z += flop * 0.6;
    B.earL.rotation.x += flop * 0.4 - hz * 0.8; B.earR.rotation.x += flop * 0.4 - hz * 0.8;
    B.tail.rotation.x = 0.2 + flop * 0.8 + Math.sin(time * 4) * 0.08;
    B.tail.rotation.y = Math.sin(time * 2.2 + ph * 0.5) * 0.35 - this.twist * 0.3;
    B.cape.rotation.x = -0.2 - sp * 0.65 - flop * 0.3 - (s.dashing ? 0.8 : 0) + hz * 0.6;
    B.cape.rotation.z = -bank * 0.8;
    for (let i = 0; i < 6; i++) {
      const tt = B[`t${i}` as BoneName];
      tt.rotation.x = Math.sin(time * 6 + i * 1.1 + ph) * (0.15 + 0.35 * sp) + hz * 0.4;
      tt.rotation.z = Math.cos(time * 5 + i * 0.9) * 0.15;
    }
  }

  private applyAttack(style: AttackStyle, t: number, power: number, time: number) {
    const B = this.bones;
    switch (style) {
      case 'rapid': {
        // braced two-hand stance while the burst rattles out
        const k = t < 0.85 ? 1 : (1 - t) / 0.15;
        B.armL.rotation.x = -1.2 * k + B.armL.rotation.x * (1 - k); B.armL.rotation.z = -0.45 * k;
        B.body.rotation.x -= 0.08 * k;
        B.legL.rotation.z += 0.12 * k; B.legR.rotation.z -= 0.12 * k;
        B.weapon.rotation.z = time * 30 * k;
        B.root.position.x += (Math.random() - 0.5) * 0.02 * k;
        break;
      }
      case 'shotgun': {
        const k = strike(t, 0.08);
        B.armR.rotation.x += k * 0.75 * power;     // muzzle climb
        B.body.rotation.x -= k * 0.35;
        B.head.rotation.x -= k * 0.25;
        B.root.position.z -= k * 0.12;
        const pump = t > 0.35 && t < 0.8 ? Math.sin(((t - 0.35) / 0.45) * Math.PI) : 0; // pump action
        B.armL.rotation.x = -1.1 + pump * 0.6; B.armL.rotation.z = -0.4;
        B.weapon.position.z += pump * 0.05;
        break;
      }
      case 'throw': {
        // overhand: arm whips from behind the head down through the release
        const swing = t < 0.22 ? easeOut(t / 0.22) : 1;
        const back = 1 - Math.min(1, Math.max(0, (t - 0.22) / 0.6));
        B.armR.rotation.x = THREE.MathUtils.lerp(-3.0, -0.35, swing) * back + B.armR.rotation.x * (1 - back);
        B.armR.rotation.z = -0.25 * back;
        B.body.rotation.x += 0.35 * strike(t, 0.2);
        B.body.rotation.y += -0.5 * strike(t, 0.2);
        B.armL.rotation.x = -0.6 * back; B.armL.rotation.z = 0.7 * back;
        B.hips.position.y += 0.06 * strike(t, 0.2);
        break;
      }
      case 'bow': {
        const snap = strike(t, 0.06);
        B.armR.rotation.x += snap * 0.5;
        B.body.rotation.x -= snap * 0.18;
        const cock = t > 0.3 ? Math.sin(((t - 0.3) / 0.7) * Math.PI) : 0; // re-cock the string
        B.armL.rotation.x = -1.3 + cock * 0.5; B.armL.rotation.z = -0.5 - cock * 0.3;
        B.earL.rotation.x -= snap * 0.6; B.earR.rotation.x -= snap * 0.6;
        break;
      }
      case 'boomerang': {
        // side-arm whip with a full torso twist
        const k = t < 0.18 ? easeOut(t / 0.18) : 1;
        const rec = 1 - Math.max(0, (t - 0.25) / 0.75);
        B.body.rotation.y += THREE.MathUtils.lerp(-1.0, 0.75, k) * rec;
        B.armR.rotation.x = -1.4 * rec + B.armR.rotation.x * (1 - rec);
        B.armR.rotation.z = THREE.MathUtils.lerp(-1.2, 0.6, k) * rec;
        B.armL.rotation.z = 0.9 * rec;
        B.legL.rotation.x += 0.4 * strike(t, 0.15);
        break;
      }
      case 'bubble': {
        // puff: inflate, then push both arms forward
        const inflate = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.25);
        B.body.scale.set(1 + inflate * 0.18, 1 - inflate * 0.08, 1 + inflate * 0.18);
        B.head.scale.setScalar(1 + inflate * 0.06);
        const push = strike(t, 0.2);
        B.armL.rotation.x = -1.4 * push; B.armR.rotation.x -= 0.4 * push;
        B.head.rotation.x -= push * 0.2;
        break;
      }
    }
  }

  private applySuper(style: SuperStyle, t: number, time: number) {
    const B = this.bones;
    switch (style) {
      case 'bigbang': {
        const k = strike(t, 0.08);
        B.body.rotation.x -= k * 0.7; B.head.rotation.x -= k * 0.5;
        B.armR.rotation.x += k * 1.4; B.armL.rotation.z = 1.4 * k;
        B.legL.rotation.x = 0.6 * k; B.legR.rotation.x = -0.3 * k;
        B.root.position.z -= k * 0.35;
        break;
      }
      case 'megabomb': {
        const k = Math.sin(t * Math.PI);
        B.hips.position.y += k * 0.55;
        const swing = t < 0.45 ? 0 : easeOut(Math.min(1, (t - 0.45) / 0.2));
        const arm = THREE.MathUtils.lerp(-3.1, -0.3, swing);
        B.armR.rotation.x = arm; B.armL.rotation.x = arm;
        B.body.rotation.x += swing * 0.4 * (1 - t);
        B.legL.rotation.x = -0.6 * k; B.legR.rotation.x = -0.6 * k;
        break;
      }
      case 'meteor': {
        // charge (lean back, flicker), then release with a heroic recoil
        const charge = t < 0.35 ? t / 0.35 : 0;
        const k = t >= 0.35 ? strike((t - 0.35) / 0.65, 0.1) : 0;
        B.body.rotation.x -= charge * 0.25 + k * 0.5;
        B.armL.rotation.x = -1.3; B.armL.rotation.z = -0.6 - charge * 0.4;
        B.legL.rotation.z = 0.3; B.legR.rotation.z = -0.3;
        B.armR.rotation.x += k * 1.0;
        B.root.position.z -= k * 0.3;
        if (charge > 0) this.material.uniforms.uFlash.value = Math.max(this.material.uniforms.uFlash.value, Math.sin(time * 40) * 0.25 + 0.25);
        break;
      }
      case 'prison': {
        const inflate = t < 0.4 ? easeOut(t / 0.4) : Math.max(0, 1 - (t - 0.4) / 0.2);
        B.body.scale.set(1 + inflate * 0.35, 1 - inflate * 0.12, 1 + inflate * 0.35);
        B.head.scale.setScalar(1 + inflate * 0.15);
        B.head.rotation.x -= inflate * 0.3;
        const push = t > 0.4 ? strike((t - 0.4) / 0.6, 0.12) : 0;
        B.armL.rotation.x = -1.5 * push; B.armR.rotation.x -= 0.6 * push;
        break;
      }
      case 'gatling':
      case 'tornado': {
        const k = Math.sin(t * Math.PI);
        B.hips.position.y += k * 0.3;
        B.armL.rotation.z = 1.2 * k;
        break;
      }
    }
  }

  private updateDeath(dt: number) {
    // "뿅!" — pop, then spin away along the killing blow as a little star
    this.deathT += dt;
    const t = this.deathT;
    const B = this.bones;
    const pop = Math.min(1, t / 0.15);
    B.root.scale.setScalar(t < 0.15 ? 1 + pop * 0.45 : Math.max(0.001, 1.45 * (1 - (t - 0.15) / 0.95)));
    const ft = Math.max(0, t - 0.15);
    const c = Math.cos(this.lowerYaw), s = Math.sin(this.lowerYaw);
    const lx = this.deathDir.x * c - this.deathDir.y * s, lz = this.deathDir.x * s + this.deathDir.y * c;
    const l = Math.hypot(lx, lz) || 1;
    B.root.position.set((lx / l) * ft * 3, ft * 7 + ft * ft * 4, (lz / l) * ft * 3);
    B.root.rotation.set(ft * 9, ft * 20, ft * 6);
    B.eyes.scale.y = 0.15;
    this.material.uniforms.uFlash.value = Math.min(1, t * 2.2);
  }

  dispose() {
    this.material.dispose();
    this.outlineMat.dispose();
    this.mesh.skeleton.dispose();
  }
}

export function weaponTipOffset(): THREE.Vector3 { return new THREE.Vector3(W[0], W[1] + 0.05, W[2] + 0.45); }
