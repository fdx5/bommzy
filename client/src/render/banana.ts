import * as THREE from 'three';

/**
 * Banana crescent lying flat in the xz plane (reads as a banana from the top-down camera).
 * Five-sided tube like a real banana's ridges, fat in the middle, tapering to a dark tip at one end
 * and a short stem at the other. Length ≈ 0.86 at scale 1.
 */
const CURVE = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.43, 0, 0.12), new THREE.Vector3(0, 0, -0.26), new THREE.Vector3(0.43, 0, 0.12));
export const BANANA = { body: '#FFDF4A', tip: '#6B4A2B', stem: '#9C7A3C' };

/** Radius profile along u ∈ [0,1]: blossom tip at 0, stem from 0.87. */
function radiusAt(u: number, R: number) {
  if (u >= 0.87) return u >= 0.995 ? R * 0.18 : R * 0.3;
  return R * Math.pow(Math.sin(Math.PI * Math.min(1, u / 0.94)), 0.55);
}

class SubCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private u0: number, private u1: number) { super(); }
  getPoint(t: number, out = new THREE.Vector3()) { return CURVE.getPoint(this.u0 + (this.u1 - this.u0) * t, out); }
}

/** One stretch of the banana (u0..u1). `colored` bakes body/tip/stem vertex colours. */
export function bananaGeometry(u0 = 0, u1 = 1, R = 0.11, colored = false) {
  const segs = Math.max(4, Math.round(28 * (u1 - u0))), radial = 5;
  const g = new THREE.TubeGeometry(new SubCurve(u0, u1), segs, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = colored ? new Float32Array(pos.count * 3) : null;
  const c = new THREE.Color(), center = new THREE.Vector3(), v = new THREE.Vector3();
  const body = new THREE.Color(BANANA.body), tip = new THREE.Color(BANANA.tip), stem = new THREE.Color(BANANA.stem), green = new THREE.Color('#C9D85A');
  for (let i = 0; i <= segs; i++) {
    const u = u0 + (u1 - u0) * (i / segs);
    CURVE.getPoint(u, center);
    const r = radiusAt(u, R);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(center).multiplyScalar(r).add(center);
      v.y *= 0.92; // a touch flatter so it sits nicely
      pos.setXYZ(k, v.x, v.y, v.z);
      if (col) {
        if (u < 0.06) c.copy(tip);
        else if (u > 0.86) c.copy(stem);
        else if (u > 0.78) c.copy(body).lerp(green, (u - 0.78) / 0.08 * 0.6);
        else c.copy(body);
        c.toArray(col, k * 3);
      }
    }
  }
  g.computeVertexNormals();
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
