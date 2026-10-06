import * as THREE from 'three';
import { ITEM_BY_ID, type CharacterId, type ItemDef, type ItemSlot } from '@pastel/shared';
import type { BoneName, PartSpec } from './chibi';
import { FACES, HEAD_Y, eyeAnchor } from './face';

/**
 * Wearable items, fitted per character. Every item is generated from anatomical anchors (head, eyes,
 * neck crease, torso ellipsoid, wrist, feet / tentacle tips) so one recipe fits all six brawlers.
 * Parts are merged into the character's SkinnedMesh (no extra draw calls) and ride the right bones.
 */

interface Ellipsoid { cy: number; rx: number; ry: number; rz: number }
export interface Fit {
  head: { y: number; r: number; sx: number; sy: number; sz: number };
  eye: { x: number; y: number; z: number; s: number };
  body: Ellipsoid;
  neck: { y: number; r: number };
  arms: 'normal' | 'flipper' | 'nub';
  legs: boolean;
  wrist: { x: number; y: number; z: number; r: number; tilt: number };
}

const headEllipsoid = (h: Fit['head']): Ellipsoid => ({ cy: h.y, rx: h.r * h.sx, ry: h.r * h.sy, rz: h.r * h.sz });
const radAt = (e: Ellipsoid, y: number) => { const k = 1 - ((y - e.cy) / e.ry) ** 2; return k > 0 ? Math.sqrt(k) * e.rx : 0; };
const zAt = (e: Ellipsoid, x: number, y: number) => Math.sqrt(Math.max(0.02, 1 - (x / e.rx) ** 2 - ((y - e.cy) / e.ry) ** 2)) * e.rz;

/** Where head and torso meet (the visible "neck" crease) — scanned numerically. */
function crease(head: Fit['head'], body: Ellipsoid) {
  const he = headEllipsoid(head);
  let best = { y: body.cy + body.ry * 0.6, r: body.rx * 0.8 }, err = 1e9;
  for (let y = body.cy; y < body.cy + body.ry; y += 0.004) {
    const d = Math.abs(radAt(he, y) - radAt(body, y));
    if (radAt(he, y) > 0 && d < err) { err = d; best = { y, r: radAt(body, y) }; }
  }
  return best;
}

const FITS = {} as Record<CharacterId, Fit>;
function fitOf(id: CharacterId): Fit {
  if (FITS[id]) return FITS[id];
  const mongle = id === 'mongle';
  const bs = id === 'boogie' ? 1.14 : 1;
  const face = FACES[id];
  const head = { y: HEAD_Y, r: face.headR, sx: face.headS[0], sy: face.headS[1], sz: face.headS[2] };
  const body: Ellipsoid = mongle ? { cy: 0.32, rx: 0.24 * 1.2, ry: 0.24 * 0.75, rz: 0.24 * 1.2 } : { cy: 0.42, rx: 0.27 * bs, ry: 0.27 * bs * 1.02, rz: 0.27 * bs * 0.9 };
  const fit: Fit = {
    head, body,
    eye: eyeAnchor(face),
    neck: mongle ? { y: 0.405, r: 0.27 } : crease(head, body),
    arms: id === 'popo' ? 'flipper' : mongle ? 'nub' : 'normal',
    legs: !mongle,
    wrist: id === 'popo' ? { x: 0.33, y: 0.33, z: 0.0, r: 0.06, tilt: 0.45 } : mongle ? { x: 0.38, y: 0.335, z: 0.06, r: 0.062, tilt: 0 } : { x: 0.345, y: 0.375, z: 0.015, r: 0.072, tilt: 0.55 },
  };
  return (FITS[id] = fit);
}

// ───────────────────────────── geometry helpers
const sph = (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const tor = (r: number, t: number, rs = 8, ts = 28, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const cyl = (rt: number, rb: number, h: number, s = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const cone = (r: number, h: number, s = 14) => new THREE.ConeGeometry(r, h, s);
const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 12);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

/** Ellipsoid band shell between two heights (clothes). */
function band(e: Ellipsoid, yTop: number, yBot: number, grow = 1.07) {
  const t0 = Math.acos(THREE.MathUtils.clamp((yTop - e.cy) / e.ry, -1, 1));
  const t1 = Math.acos(THREE.MathUtils.clamp((yBot - e.cy) / e.ry, -1, 1));
  return new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, t0, t1 - t0).scale(e.rx * grow, e.ry * grow, e.rz * grow).translate(0, e.cy, 0);
}
/** Place a geometry along a segment (for temples, straps, chains). */
function along(g: THREE.BufferGeometry, a: THREE.Vector3, b: THREE.Vector3) {
  const dir = b.clone().sub(a), len = dir.length();
  g.scale(1, len, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
function heartShape(r: number) {
  const s = new THREE.Shape();
  s.moveTo(0, -r * 0.9);
  s.bezierCurveTo(r * 1.3, -r * 0.1, r * 0.9, r * 1.0, 0, r * 0.45);
  s.bezierCurveTo(-r * 0.9, r * 1.0, -r * 1.3, -r * 0.1, 0, -r * 0.9);
  return s;
}
function starShape(r: number, inner = 0.5) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  return s;
}
function polyShape(r: number, n: number, rot = 0) {
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  return s;
}
const extrude = (s: THREE.Shape, d: number) => new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -d / 2);
/** Frame ring from a shape: outer shape with a scaled copy as the hole. */
function frameFrom(make: (r: number) => THREE.Shape, r: number, thick: number, depth: number) {
  const outer = make(r);
  const hole = make(r - thick);
  outer.holes.push(new THREE.Path(hole.getPoints(24).reverse()));
  return extrude(outer, depth);
}

const isMetal = (c: string) => ['#F2C94C', '#FFE58A', '#D9DEE8'].includes(c.toUpperCase());
type P = PartSpec;
const part = (geo: THREE.BufferGeometry, color: string, bone: BoneName, extra: Partial<P> = {}): P => ({ geo, color, bone, ol: extra.ol ?? 0.3, gloss: isMetal(color) ? 1 : 0, ...extra });

// ───────────────────────────── per-slot builders
function eyewear(it: ItemDef, f: Fit): P[] {
  const [frame, lens, deco] = it.colors;
  const sunglasses = it.kind === 'sunglasses';
  const R = 0.074 * f.eye.s, z = f.eye.z + 0.035, y = f.eye.y + 0.005;
  const out: P[] = [];
  const he = headEllipsoid(f.head);
  const lensAt = (x: number, shape: string) => {
    let fr: THREE.BufferGeometry, fill: THREE.BufferGeometry | null = null;
    switch (shape) {
      case 'square': case 'wayfarer': case 'shutter':
        fr = frameFrom((r) => polyShape(r * 1.1, 4, Math.PI / 4), R, shape === 'wayfarer' ? 0.026 : 0.016, 0.02);
        fill = extrude(polyShape(R * 1.02, 4, Math.PI / 4), 0.008); break;
      case 'hex': fr = frameFrom((r) => polyShape(r, 6), R, 0.016, 0.02); fill = extrude(polyShape(R * 0.9, 6), 0.008); break;
      case 'heart': fr = frameFrom((r) => heartShape(r), R * 1.05, 0.018, 0.02); fill = extrude(heartShape(R * 0.9), 0.008); break;
      case 'star': fr = frameFrom((r) => starShape(r, 0.55), R * 1.25, 0.022, 0.02); fill = extrude(starShape(R * 1.05, 0.55), 0.008); break;
      case 'aviator': fr = tor(R * 1.02, 0.011, 6, 24).scale(1.05, 0.95, 1).translate(0, -0.01, 0); fill = sph(R, 16, 10).scale(1.02, 0.95, 0.18).translate(0, -0.012, 0); break;
      case 'thick': fr = tor(R * 0.98, 0.022, 8, 24); fill = sph(R * 0.95, 16, 10).scale(1, 1, 0.12); break;
      default: fr = tor(R * 0.95, 0.013, 8, 24); fill = sph(R * 0.93, 16, 10).scale(1, 1, 0.12);
    }
    out.push(part(fr.translate(x, y, z), frame, 'head', { ol: 0 }));
    if (sunglasses && fill) {
      out.push(part(fill.translate(x, y, z - 0.002), lens, 'head', { ol: 0, gloss: 1 }));
      out.push(part(sph(R * 0.18, 8, 6).scale(1, 1, 0.3).translate(x - R * 0.35, y + R * 0.35, z + 0.012), '#FFFFFF', 'head', { ol: 0 }));
      if (shape === 'shutter') for (let k = -2; k <= 2; k++) out.push(part(box(R * 1.9, 0.01, 0.012).translate(x, y + k * R * 0.38, z + 0.006), frame, 'head', { ol: 0 }));
    }
  };
  if (it.style === 'visor') {
    // one wraparound lens
    const g = new THREE.CylinderGeometry(f.eye.z + 0.06, f.eye.z + 0.06, R * 1.6, 28, 1, true, -0.62, 1.24).rotateY(Math.PI / 2 - Math.PI / 2);
    out.push(part(g.translate(0, y, 0), lens, 'head', { ol: 0, gloss: 1 }));
    out.push(part(box(R * 0.6, 0.02, 0.02).translate(0, y + R * 0.95, f.eye.z + 0.06), deco, 'head', { ol: 0 }));
  } else if (it.style === 'monocle') {
    lensAt(-f.eye.x, 'round');
    const a = new THREE.Vector3(-f.eye.x - R * 0.7, y - R * 0.7, z), b = new THREE.Vector3(-f.eye.x - R * 1.2, y - 0.25, z - 0.04);
    out.push(part(along(cyl(0.006, 0.006, 1, 5), a, b), deco, 'head', { ol: 0 }));
  } else {
    const shape = it.style === 'rainbow' ? 'round' : it.style;
    lensAt(f.eye.x, shape); lensAt(-f.eye.x, shape);
    if (it.style === 'rainbow') { out[0].color = it.colors[0]; out[out.length - 1].color = it.colors[1]; }
    // bridge
    out.push(part(tor(f.eye.x - R * 0.92, 0.01, 6, 12, Math.PI * 0.6).rotateZ(Math.PI * 0.2).translate(0, y - 0.005, z + 0.004), frame, 'head', { ol: 0 }));
  }
  // temples back to the side of the head
  if (it.style !== 'monocle') for (const sx of [1, -1]) {
    const a = new THREE.Vector3(sx * (f.eye.x + R * 0.95), y, z - 0.01);
    const backY = y + 0.02, bx = radAt(he, backY) * 0.98;
    const b = new THREE.Vector3(sx * bx, backY, zAt(he, bx * 0.9, backY) * 0.15);
    out.push(part(along(cyl(0.009, 0.009, 1, 5), a, b), frame, 'head', { ol: 0 }));
  }
  return out;
}

function hat(it: ItemDef, f: Fit): P[] {
  const [a, b, c] = it.colors;
  const h = f.head, r = h.r, top = h.y + r * h.sy;
  const he = headEllipsoid(h);
  const baseY = h.y + r * 0.5, baseR = radAt(he, baseY);
  const T = (g: THREE.BufferGeometry) => g.scale(h.sx / 1.04, 1, h.sz).rotateX(-0.08); // fit head shape, slight cheeky tilt back
  const out: P[] = [];
  const push = (g: THREE.BufferGeometry, col: string, extra: Partial<P> = {}) => out.push(part(T(g), col, 'head', extra));
  switch (it.style) {
    case 'cap':
      push(new THREE.SphereGeometry(r * 1.0, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.06, 0.72, 1.06).translate(0, baseY - 0.01, 0), a, { ol: 0.7 });
      push(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.028, 24, 1, false, -Math.PI / 2, Math.PI).scale(1.2, 1, 1.05).rotateX(0.12).translate(0, baseY - 0.005, baseR * 0.86), c, { ol: 0.5 });
      push(sph(0.03).translate(0, baseY + r * 0.72, 0), b, { ol: 0 });
      break;
    case 'beanie':
      push(new THREE.SphereGeometry(r * 1.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.95, 1.05).translate(0, baseY - 0.02, 0), a, { ol: 0.7, pattern: { kind: 'stripes', c2: c, freq: 38 } });
      push(tor(baseR * 1.04, 0.045, 10, 32).rotateX(Math.PI / 2).translate(0, baseY, 0), c, { ol: 0.5 });
      push(sph(0.085, 14, 10).translate(0, baseY + r * 0.98, 0), b, { ol: 0.4 });
      break;
    case 'bucket':
      push(cyl(r * 0.8, baseR * 1.08, r * 0.55, 24).translate(0, baseY + r * 0.24, 0), a, { ol: 0.7 });
      push(cyl(baseR * 1.08, baseR * 1.55, 0.06, 28, true).translate(0, baseY - 0.02, 0), b, { ol: 0.5 });
      push(tor(baseR * 1.06, 0.018, 6, 28).rotateX(Math.PI / 2).translate(0, baseY + 0.03, 0), c, { ol: 0 });
      break;
    case 'beret':
      push(sph(r * 1.08, 24, 12).scale(1.08, 0.32, 1.08).rotateZ(0.22).translate(0.05, baseY + r * 0.45, -0.01), a, { ol: 0.7 });
      push(cyl(0.015, 0.02, 0.06, 8).rotateZ(0.22).translate(0.02, baseY + r * 0.8, 0), b, { ol: 0 });
      break;
    case 'party':
      push(cone(r * 0.5, r * 1.15, 18).rotateZ(-0.18).translate(0.06, top + r * 0.45, -0.02), a, { ol: 0.6, pattern: { kind: 'stripes', c2: c, freq: 20 } });
      push(sph(0.06, 12, 8).translate(0.06 + 0.1, top + r * 1.0, -0.02), b, { ol: 0.3 });
      push(tor(r * 0.48, 0.02, 6, 24).rotateX(Math.PI / 2).rotateZ(-0.18).translate(0.05, top - 0.07, -0.02), b, { ol: 0 });
      break;
    case 'straw':
      push(cyl(r * 1.55, r * 1.55, 0.025, 32).translate(0, baseY, 0), a, { ol: 0.6 });
      push(cyl(r * 0.72, r * 0.8, r * 0.42, 24).translate(0, baseY + r * 0.21, 0), a, { ol: 0.6 });
      push(cyl(r * 0.81, r * 0.81, 0.06, 24).translate(0, baseY + 0.05, 0), b, { ol: 0 });
      push(sph(0.05, 10, 8).scale(1, 0.7, 0.5).translate(r * 0.62, baseY + 0.05, r * 0.45), b, { ol: 0 });
      break;
    case 'bunny': {
      push(tor(baseR * 1.02, 0.022, 6, 24, Math.PI).scale(1, (top - baseY + 0.03) / (baseR * 1.02), 1).rotateY(Math.PI / 2).translate(0, baseY, 0), a, { ol: 0.4 });
      for (const sx of [1, -1]) {
        push(cap(0.055, 0.26).rotateZ(-sx * 0.25).translate(sx * r * 0.42, top + 0.12, 0), a, { ol: 0.6 });
        push(cap(0.028, 0.2).scale(1, 1, 0.5).rotateZ(-sx * 0.25).translate(sx * r * 0.42, top + 0.12, 0.035), b, { ol: 0 });
      }
      break;
    }
    case 'tophat':
      push(cyl(r * 1.15, r * 1.15, 0.03, 32).scale(1, 1, 0.92).translate(0, baseY + 0.05, 0), a, { ol: 0.6 });
      push(cyl(r * 0.62, r * 0.6, r * 0.95, 24).translate(0, baseY + 0.05 + r * 0.48, 0), a, { ol: 0.7 });
      push(cyl(r * 0.625, r * 0.625, 0.07, 24).translate(0, baseY + 0.12, 0), b, { ol: 0 });
      break;
    case 'flowers': {
      push(tor(baseR * 0.98, 0.022, 6, 32).rotateX(Math.PI / 2).translate(0, baseY + 0.06, 0), '#8CC48A', { ol: 0 });
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2, x = Math.sin(ang) * baseR * 0.98, z = Math.cos(ang) * baseR * 0.98;
        const col = [a, b, c][i % 3];
        for (let k = 0; k < 5; k++) { const pa = (k / 5) * Math.PI * 2; push(sph(0.042, 8, 6).translate(x + Math.cos(pa) * 0.045, baseY + 0.09 + Math.sin(pa) * 0.012, z + Math.sin(pa) * 0.045), col, { ol: 0 }); }
        push(sph(0.03, 8, 6).translate(x, baseY + 0.115, z), '#FFE27A', { ol: 0 });
      }
      break;
    }
    case 'crown': {
      push(cyl(baseR * 0.82, baseR * 0.86, 0.1, 24, true).translate(0, top - 0.02, 0), a, { ol: 0.5 });
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2, x = Math.sin(ang) * baseR * 0.84, z = Math.cos(ang) * baseR * 0.84;
        push(cone(0.04, 0.12, 6).translate(x, top + 0.09, z), a, { ol: 0 });
        push(sph(0.022, 8, 6).translate(x, top + 0.16, z), b, { ol: 0 });
        if (i % 2 === 0) push(sph(0.025, 8, 6).translate(x * 1.03, top - 0.02, z * 1.03), c, { ol: 0, gloss: 1 });
      }
      break;
    }
  }
  return out;
}

function top(it: ItemDef, f: Fit): P[] {
  const [a, b, c] = it.colors;
  const e = f.body, out: P[] = [];
  const yTop = f.neck.y + 0.03;
  const long = it.style === 'raincoat' || it.style === 'jacket' || it.style === 'tux';
  const yBot = e.cy - e.ry * (long ? 0.55 : 0.32);
  const pattern = it.style === 'stripe' ? { kind: 'stripes' as const, c2: b, freq: 40 } : it.style === 'knit' ? { kind: 'stripes' as const, c2: b, freq: 70 } : undefined;
  out.push(part(band(e, yTop, yBot, 1.075), a, 'body', { ol: 0.7, pattern }));
  // collar / hem
  out.push(part(tor(f.neck.r * 1.08, 0.022, 8, 32).rotateX(Math.PI / 2).translate(0, yTop - 0.005, 0), it.style === 'tux' || it.style === 'jersey' ? b : c, 'body', { ol: 0 }));
  out.push(part(tor(radAt(e, yBot) * 1.08, 0.018, 6, 32).rotateX(Math.PI / 2).translate(0, yBot + 0.006, 0), it.style === 'knit' ? b : c, 'body', { ol: 0 }));
  // sleeves
  if (f.arms === 'normal') for (const [sx, bone] of [[1, 'armL'], [-1, 'armR']] as const) {
    out.push(part(cap(0.086, it.style === 'raincoat' || it.style === 'jacket' || it.style === 'tux' ? 0.1 : 0.04).rotateZ(sx * 0.55).translate(sx * 0.295, 0.455, 0), a, bone, { ol: 0.5, pattern }));
  } else if (f.arms === 'flipper') for (const [sx, bone] of [[1, 'armL'], [-1, 'armR']] as const) {
    out.push(part(sph(0.15, 14, 10).scale(0.4, 0.45, 0.7).rotateZ(sx * 0.45).translate(sx * 0.3, 0.5, 0), a, bone, { ol: 0.4 }));
  } else for (const [sx, bone] of [[1, 'armL'], [-1, 'armR']] as const) {
    out.push(part(sph(0.078, 12, 8).scale(1, 0.7, 1).translate(sx * 0.37, 0.415, 0.06), a, bone, { ol: 0.4 }));
  }
  const front = (y: number, lift = 0.03) => zAt(e, 0, y) * 1.075 + lift - 0.02;
  switch (it.style) {
    case 'hoodie':
      out.push(part(tor(f.neck.r * 1.2, 0.06, 10, 28, Math.PI * 1.2).rotateX(Math.PI / 2).rotateZ(Math.PI).rotateY(Math.PI * 0.4).translate(0, yTop + 0.02, -0.03), a, 'body', { ol: 0.5 }));
      out.push(part(box(e.rx * 0.9, e.ry * 0.38, 0.03).translate(0, e.cy - e.ry * 0.12, front(e.cy - e.ry * 0.12)), b, 'body', { ol: 0.4 }));
      for (const sx of [1, -1]) out.push(part(cyl(0.008, 0.008, 0.13, 5).translate(sx * 0.05, yTop - 0.08, front(yTop - 0.08, 0.04)), c, 'body', { ol: 0 }));
      break;
    case 'sailor':
      out.push(part(cone(0.06, 0.11, 4).rotateZ(Math.PI).translate(0, yTop - 0.09, front(yTop - 0.09, 0.03)), c, 'body', { ol: 0 }));
      out.push(part(tor(f.neck.r * 1.15, 0.04, 6, 28, Math.PI).rotateX(Math.PI / 2).translate(0, yTop - 0.02, 0).scale(1, 1, -1), b, 'body', { ol: 0.4 }));
      break;
    case 'raincoat':
      for (let i = 0; i < 3; i++) { const y = yTop - 0.06 - i * 0.07; out.push(part(sph(0.018, 8, 6).translate(0, y, front(y, 0.025)), b, 'body', { ol: 0 })); }
      out.push(part(tor(f.neck.r * 1.25, 0.05, 8, 28, Math.PI * 1.1).rotateX(Math.PI / 2).rotateZ(Math.PI).rotateY(Math.PI * 0.45).translate(0, yTop + 0.03, -0.04), a, 'body', { ol: 0.5 }));
      break;
    case 'jersey':
      out.push(part(box(0.09, 0.1, 0.02).translate(0, e.cy + 0.02, front(e.cy + 0.02, 0.025)), b, 'body', { ol: 0 }));
      out.push(part(box(0.05, 0.05, 0.02).translate(0, e.cy + 0.02, front(e.cy + 0.02, 0.035)), c, 'body', { ol: 0 }));
      break;
    case 'tux': case 'jacket': {
      // open jacket over a contrasting shirt panel + lapels + buttons
      out.push(part(box(e.rx * 0.5, (yTop - yBot) * 0.85, 0.02).translate(0, (yTop + yBot) / 2 + 0.02, front((yTop + yBot) / 2, 0.012)), b, 'body', { ol: 0.3 }));
      for (const sx of [1, -1]) out.push(part(cone(0.05, 0.16, 3).rotateZ(Math.PI).rotateY(sx * 0.4).translate(sx * 0.07, yTop - 0.08, front(yTop - 0.08, 0.03)), a, 'body', { ol: 0.2 }));
      if (it.style === 'tux') {
        out.push(part(sph(0.03, 10, 8).scale(1.6, 0.8, 0.6).translate(-0.035, yTop - 0.03, front(yTop - 0.03, 0.04)), c, 'body', { ol: 0 }));
        out.push(part(sph(0.03, 10, 8).scale(1.6, 0.8, 0.6).translate(0.035, yTop - 0.03, front(yTop - 0.03, 0.04)), c, 'body', { ol: 0 }));
      } else for (let i = 0; i < 3; i++) { const y = yTop - 0.09 - i * 0.07; out.push(part(sph(0.017, 8, 6).translate(0.07, y, front(y, 0.025)), c, 'body', { ol: 0, gloss: 1 })); }
      break;
    }
  }
  return out;
}

function pants(it: ItemDef, f: Fit): P[] {
  const [a, b, c] = it.colors;
  const e = f.body, out: P[] = [];
  const pattern = it.style === 'check' ? { kind: 'check' as const, c2: b, freq: 26 } : it.style === 'rainbow' ? { kind: 'bands3' as const, c2: b, c3: c, freq: 30 } : undefined;
  if (!f.legs) {
    // tentacled: a frilly skirt around the base
    out.push(part(cyl(e.rx * 1.02, e.rx * 1.3, 0.12, 28, true).translate(0, e.cy - e.ry * 0.55, 0), a, 'hips', { ol: 0.6, pattern }));
    out.push(part(tor(e.rx * 1.3, 0.02, 6, 32).rotateX(Math.PI / 2).translate(0, e.cy - e.ry * 0.55 - 0.06, 0), it.style === 'tutu' ? b : c, 'hips', { ol: 0 }));
    return out;
  }
  const yTop = e.cy - e.ry * (it.style === 'overall' ? 0.0 : 0.25);
  if (it.style === 'tutu') {
    out.push(part(band(e, e.cy - e.ry * 0.2, e.cy - e.ry * 0.95, 1.06), a, 'hips', { ol: 0.5 }));
    for (let k = 0; k < 2; k++) out.push(part(cyl(e.rx * (1.05 + k * 0.1), e.rx * (1.55 + k * 0.15), 0.06, 30, true).translate(0, e.cy - e.ry * 0.45 - k * 0.04, 0), k ? b : a, 'hips', { ol: 0.4 }));
  } else {
    out.push(part(band(e, yTop, e.cy - e.ry * 1.0, 1.065), a, 'hips', { ol: 0.6, pattern }));
    out.push(part(tor(radAt(e, yTop) * 1.075, 0.016, 6, 32).rotateX(Math.PI / 2).translate(0, yTop, 0), it.style === 'rainbow' ? c : b, 'hips', { ol: 0 }));
  }
  const longLeg = it.style === 'long' || it.style === 'rainbow' || it.style === 'check';
  for (const [sx, bone] of [[1, 'legL'], [-1, 'legR']] as const) {
    if (it.style === 'tutu') break;
    const h = longLeg ? 0.17 : 0.09, y = longLeg ? 0.13 : 0.175;
    out.push(part(cyl(0.106, 0.112, h, 16, true).translate(sx * 0.12, y, 0), a, bone, { ol: 0.5, pattern }));
    if (!longLeg) out.push(part(tor(0.11, 0.014, 6, 20).rotateX(Math.PI / 2).translate(sx * 0.12, y - h / 2, 0), b, bone, { ol: 0 }));
    if (it.style === 'cargo') out.push(part(box(0.05, 0.06, 0.07).translate(sx * 0.215, 0.18, 0), b, bone, { ol: 0.2 }));
  }
  if (it.style === 'overall') {
    const z = (y: number) => zAt(e, 0, y) * 1.07 + 0.012;
    out.push(part(box(e.rx * 0.75, e.ry * 0.5, 0.025).translate(0, e.cy + e.ry * 0.12, z(e.cy + e.ry * 0.12)), a, 'body', { ol: 0.4 }));
    for (const sx of [1, -1]) {
      out.push(part(along(cyl(0.016, 0.016, 1, 6), new THREE.Vector3(sx * e.rx * 0.32, e.cy + e.ry * 0.35, z(e.cy + e.ry * 0.35)), new THREE.Vector3(sx * e.rx * 0.55, f.neck.y + 0.02, 0.05)), a, 'body', { ol: 0.2 }));
      out.push(part(sph(0.018, 8, 6).translate(sx * e.rx * 0.3, e.cy + e.ry * 0.33, z(e.cy + e.ry * 0.33) + 0.012), b, 'body', { ol: 0, gloss: 1 }));
    }
  }
  return out;
}

function shoes(it: ItemDef, f: Fit): P[] {
  const [a, b, c] = it.colors;
  const out: P[] = [];
  const feet: { x: number; z: number; bone: BoneName; yaw: number; s: number }[] = f.legs
    ? [{ x: 0.12, z: 0.04, bone: 'legL', yaw: 0, s: 1 }, { x: -0.12, z: 0.04, bone: 'legR', yaw: 0, s: 1 }]
    : [0, 1, 2, 3, 4, 5].map((i) => { const ang = (i / 6) * Math.PI * 2 + 0.52; return { x: Math.sin(ang) * 0.36, z: Math.cos(ang) * 0.36, bone: `t${i}` as BoneName, yaw: ang, s: 0.72 }; });
  for (const ft of feet) {
    const g = (geo: THREE.BufferGeometry) => geo.scale(ft.s, ft.s, ft.s).rotateY(ft.yaw).translate(ft.x, 0, ft.z);
    const foot = sph(0.112, 16, 10).scale(1.05, 0.62, 1.38).translate(0, 0.06, 0.012);
    const sole = cyl(0.116, 0.116, 0.032, 18).scale(1.04, 1, 1.4).translate(0, 0.018, 0.012);
    switch (it.style) {
      case 'sandal':
        out.push(part(g(sole), a, ft.bone, { ol: 0.4 }));
        for (const zz of [0.03, -0.05]) out.push(part(g(tor(0.1, 0.014, 6, 18, Math.PI).translate(0, 0.04, zz).scale(1, 0.9, 1)), b, ft.bone, { ol: 0 }));
        break;
      case 'bunny':
        out.push(part(g(sph(0.125, 16, 10).scale(1.05, 0.75, 1.35).translate(0, 0.07, 0.012)), a, ft.bone, { ol: 0.5 }));
        for (const sx of [1, -1]) out.push(part(g(cap(0.022, 0.08).rotateX(-0.5).rotateZ(-sx * 0.3).translate(sx * 0.045, 0.16, 0.06)), b, ft.bone, { ol: 0.2 }));
        out.push(part(g(sph(0.02, 8, 6).translate(0, 0.1, 0.17)), '#FF9EBB', ft.bone, { ol: 0 }));
        break;
      case 'boot':
        out.push(part(g(foot), a, ft.bone, { ol: 0.5 }));
        out.push(part(g(cyl(0.1, 0.104, 0.12, 16).translate(0, 0.13, -0.01)), a, ft.bone, { ol: 0.5 }));
        out.push(part(g(sole), b, ft.bone, { ol: 0.3 }));
        out.push(part(g(tor(0.103, 0.014, 6, 18).rotateX(Math.PI / 2).translate(0, 0.19, -0.01)), c, ft.bone, { ol: 0 }));
        break;
      case 'hightop':
        out.push(part(g(foot), a, ft.bone, { ol: 0.5 }));
        out.push(part(g(cyl(0.098, 0.102, 0.08, 16).translate(0, 0.11, -0.01)), a, ft.bone, { ol: 0.4 }));
        out.push(part(g(sole), b, ft.bone, { ol: 0.3 }));
        for (let k = 0; k < 3; k++) out.push(part(g(box(0.07, 0.012, 0.012).translate(0, 0.075 + k * 0.025, 0.12 - k * 0.03)), c, ft.bone, { ol: 0 }));
        break;
      case 'loafer':
        out.push(part(g(sph(0.11, 16, 10).scale(1.04, 0.5, 1.36).translate(0, 0.05, 0.012)), a, ft.bone, { ol: 0.5 }));
        out.push(part(g(sole), a, ft.bone, { ol: 0.3 }));
        out.push(part(g(box(0.07, 0.016, 0.02).translate(0, 0.085, 0.06)), b, ft.bone, { ol: 0, gloss: 1 }));
        break;
      case 'skate':
        out.push(part(g(foot), a, ft.bone, { ol: 0.5 }));
        out.push(part(g(box(0.16, 0.025, 0.3).translate(0, 0.0, 0.012)), b, ft.bone, { ol: 0.3 }));
        for (const [wx, wz] of [[0.06, 0.1], [-0.06, 0.1], [0.06, -0.08], [-0.06, -0.08]]) out.push(part(g(cyl(0.03, 0.03, 0.03, 10).rotateZ(Math.PI / 2).translate(wx, -0.025, wz)), c, ft.bone, { ol: 0 }));
        break;
      case 'rocket':
        out.push(part(g(foot), a, ft.bone, { ol: 0.5, gloss: 1 }));
        out.push(part(g(cyl(0.1, 0.104, 0.1, 16).translate(0, 0.12, -0.01)), a, ft.bone, { ol: 0.4, gloss: 1 }));
        out.push(part(g(sole), c, ft.bone, { ol: 0.2 }));
        out.push(part(g(cone(0.05, 0.09, 10).rotateX(Math.PI).translate(0, -0.03, -0.05)), b, ft.bone, { ol: 0 }));
        break;
      default: // sneaker
        out.push(part(g(foot), a, ft.bone, { ol: 0.5 }));
        out.push(part(g(sole), c, ft.bone, { ol: 0.3 }));
        out.push(part(g(tor(0.1, 0.012, 6, 20, Math.PI * 0.9).rotateX(Math.PI / 2).rotateZ(Math.PI * 0.05).translate(0, 0.055, 0.0).scale(1.05, 1, 1.38)), b, ft.bone, { ol: 0 }));
        out.push(part(g(sph(0.018, 8, 6).translate(0, 0.1, 0.1)), b, ft.bone, { ol: 0 }));
    }
  }
  return out;
}

/** Things hung from a ring: beads, pearls, flowers, gems. */
function ringOf(r: number, y: number, n: number, size: number, cols: string[], bone: BoneName, tilt = 0, place?: (g: THREE.BufferGeometry) => THREE.BufferGeometry) {
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    let g: THREE.BufferGeometry = sph(size, 10, 8).translate(Math.sin(ang) * r, 0, Math.cos(ang) * r);
    g = place ? place(g) : g.rotateX(tilt).translate(0, y, 0);
    out.push(part(g, cols[i % cols.length], bone, { ol: 0 }));
  }
  return out;
}

function necklace(it: ItemDef, f: Fit): P[] {
  const [a, b, c] = it.colors;
  const n = f.neck, out: P[] = [];
  const e = f.body;
  const R = n.r * 1.08, y = n.y - 0.005, tilt = 0.18; // dips toward the front
  const chain = (col: string, thick = 0.009) => part(tor(R, thick, 6, 36).rotateX(Math.PI / 2).rotateX(tilt).translate(0, y, 0), col, 'body', { ol: 0 });
  const pendantY = y - 0.075, pz = zAt(e, 0, pendantY) * 1.02 + 0.03;
  switch (it.style) {
    case 'beads': out.push(...ringOf(R, y, 20, 0.02, [a, b, c], 'body', tilt)); break;
    case 'pearls': out.push(...ringOf(R, y, 24, 0.019, [a, b], 'body', tilt).map((p) => ({ ...p, gloss: 1 }))); break;
    case 'lei': out.push(...ringOf(R * 1.04, y, 16, 0.04, [a, b, c], 'body', tilt)); break;
    case 'bell':
      out.push(part(tor(R, 0.022, 8, 36).rotateX(Math.PI / 2).rotateX(tilt).translate(0, y, 0), a, 'body', { ol: 0 }));
      out.push(part(sph(0.04, 12, 10).translate(0, pendantY + 0.02, pz - 0.005), b, 'body', { ol: 0, gloss: 1 }));
      out.push(part(box(0.05, 0.006, 0.01).translate(0, pendantY + 0.01, pz + 0.035), '#8A6A20', 'body', { ol: 0 }));
      break;
    case 'scarf':
      out.push(part(tor(R * 1.02, 0.055, 10, 36).rotateX(Math.PI / 2).translate(0, y + 0.01, 0), a, 'body', { ol: 0.6, pattern: { kind: 'stripes', c2: b, freq: 35 } }));
      out.push(part(cap(0.05, 0.12).scale(1, 1, 0.45).rotateZ(0.2).translate(0.09, y - 0.1, zAt(e, 0.09, y - 0.1) * 1.05 + 0.03), a, 'body', { ol: 0.4, pattern: { kind: 'stripes', c2: b, freq: 35 } }));
      break;
    case 'shell':
      out.push(chain('#C9A27E', 0.007));
      out.push(part(cone(0.04, 0.05, 8).rotateX(Math.PI).scale(1, 1, 0.45).translate(0, pendantY, pz), b, 'body', { ol: 0 }));
      out.push(...ringOf(R, y, 8, 0.014, [c, a], 'body', tilt));
      break;
    case 'medal':
      for (const sx of [1, -1]) out.push(part(along(box(0.035, 1, 0.01), new THREE.Vector3(sx * R * 0.8, y + 0.01, 0.06), new THREE.Vector3(sx * 0.012, pendantY + 0.03, pz - 0.01)), sx > 0 ? b : c, 'body', { ol: 0 }));
      out.push(part(cyl(0.05, 0.05, 0.016, 20).rotateX(Math.PI / 2).translate(0, pendantY - 0.02, pz), a, 'body', { ol: 0.2, gloss: 1 }));
      out.push(part(extrude(starShape(0.028), 0.006).translate(0, pendantY - 0.02, pz + 0.011), it.colors[2] === '#E25D6E' ? '#FFE58A' : b, 'body', { ol: 0 }));
      break;
    default: { // pendants
      out.push(chain(a));
      const shape = it.style === 'pendant-heart' ? heartShape(0.04) : it.style === 'pendant-star' ? starShape(0.045) : polyShape(0.04, 4, Math.PI / 2);
      out.push(part(extrude(shape, 0.018).translate(0, pendantY, pz), b, 'body', { ol: 0.2, gloss: 1 }));
      if (it.style === 'pendant-gem') out.push(part(tor(0.045, 0.008, 6, 4).rotateZ(Math.PI / 4).translate(0, pendantY, pz), a, 'body', { ol: 0, gloss: 1 }));
    }
  }
  return out;
}

function bracelet(it: ItemDef, f: Fit): P[] {
  const [a, b, c] = it.colors;
  const w = f.wrist, out: P[] = [];
  const at = (g: THREE.BufferGeometry) => g.rotateZ(w.tilt).translate(w.x, w.y, w.z);
  const ring = (r: number, t: number, col: string, dy = 0, extra: Partial<P> = {}) => part(at(tor(r, t, 8, 28).rotateX(Math.PI / 2).translate(0, dy, 0)), col, 'armL', { ol: 0, ...extra });
  switch (it.style) {
    case 'beads': out.push(...ringOf(w.r, 0, 12, 0.017, [a, b, c], 'armL', 0, (g) => at(g))); break;
    case 'gems': out.push(ring(w.r, 0.012, a, 0, { gloss: 1 }), ...ringOf(w.r + 0.006, 0, 10, 0.016, [b], 'armL', 0, (g) => at(g)).map((p) => ({ ...p, gloss: 1 }))); break;
    case 'band': out.push(ring(w.r + 0.005, 0.026, a), ring(w.r + 0.006, 0.01, b, 0.012)); break;
    case 'braid': out.push(ring(w.r, 0.012, a, -0.012), ring(w.r, 0.012, b, 0), ring(w.r, 0.012, c, 0.012)); break;
    case 'rainbow': out.push(ring(w.r, 0.01, a, -0.016), ring(w.r, 0.01, b, 0), ring(w.r, 0.01, c, 0.016)); break;
    case 'watch':
      out.push(ring(w.r, 0.016, a));
      out.push(part(at(cyl(0.035, 0.035, 0.016, 18).rotateZ(Math.PI / 2).translate(w.r + 0.012, 0, 0)), c, 'armL', { ol: 0, gloss: 1 }));
      out.push(part(at(cyl(0.027, 0.027, 0.018, 18).rotateZ(Math.PI / 2).translate(w.r + 0.014, 0, 0)), b, 'armL', { ol: 0 }));
      break;
    case 'flowers':
      out.push(ring(w.r, 0.009, '#8CC48A'));
      out.push(...ringOf(w.r + 0.01, 0, 6, 0.024, [a, b, c], 'armL', 0, (g) => at(g)));
      break;
    case 'charm':
      out.push(ring(w.r, 0.009, a, 0, { gloss: 1 }));
      out.push(part(at(extrude(starShape(0.026), 0.008).translate(w.r + 0.02, -0.03, 0)), b, 'armL', { ol: 0, gloss: 1 }));
      out.push(part(at(extrude(heartShape(0.02), 0.008).translate(-w.r * 0.2, -0.03, w.r + 0.01)), c, 'armL', { ol: 0 }));
      break;
    default: out.push(ring(w.r + 0.004, 0.016, a, 0, { gloss: 1 })); // bangle
  }
  return out;
}

const BUILDERS: Record<string, (it: ItemDef, f: Fit) => P[]> = {
  glasses: eyewear, sunglasses: eyewear, hat, top, pants, shoes, necklace, bracelet,
};

/** Parts for a set of equipped item ids on a character (unknown ids are ignored). */
export function outfitParts(charId: CharacterId, itemIds: string[]): P[] {
  const f = fitOf(charId);
  const parts: P[] = [];
  for (const id of itemIds) {
    const it = ITEM_BY_ID[id];
    if (it) parts.push(...BUILDERS[it.kind](it, f));
  }
  return parts;
}

/** Slots occupied by a set of items (to strip the brawler's own hat / apron / shorts / feet). */
export function slotsOf(itemIds: string[]): Set<ItemSlot> {
  return new Set(itemIds.map((id) => ITEM_BY_ID[id]?.slot).filter(Boolean) as ItemSlot[]);
}
