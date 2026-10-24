import type { Obstacle } from './types';
import { segCircle, segAABB, type Vec2 } from '../math';

/** 1m navigation grid with incremental updates (rocks/crates break) and A* (octile). */
export class NavGrid {
  readonly n: number;
  readonly blocked: Uint8Array;
  private g: Float32Array;
  private f: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: number[] = [];

  constructor(private half: number, private obstacles: Obstacle[], private inflate = 0.72) {
    this.n = Math.round(half * 2);
    const N = this.n * this.n;
    this.blocked = new Uint8Array(N);
    this.g = new Float32Array(N); this.f = new Float32Array(N);
    this.from = new Int32Array(N); this.seen = new Uint32Array(N); this.closed = new Uint32Array(N);
    this.rebuild(-half, -half, half, half);
  }

  cellOf(x: number, y: number) {
    const cx = Math.min(this.n - 1, Math.max(0, Math.floor(x + this.half)));
    const cy = Math.min(this.n - 1, Math.max(0, Math.floor(y + this.half)));
    return cy * this.n + cx;
  }
  center(c: number): Vec2 { return { x: (c % this.n) - this.half + 0.5, y: Math.floor(c / this.n) - this.half + 0.5 }; }

  rebuild(minx: number, miny: number, maxx: number, maxy: number) {
    const h = this.half, n = this.n;
    const x0 = Math.max(0, Math.floor(minx + h)), x1 = Math.min(n - 1, Math.floor(maxx + h));
    const y0 = Math.max(0, Math.floor(miny + h)), y1 = Math.min(n - 1, Math.floor(maxy + h));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x - h + 0.5, py = y - h + 0.5;
      let b = x === 0 || y === 0 || x === n - 1 || y === n - 1 ? 1 : 0;
      if (!b) for (const o of this.obstacles) {
        if (!o.alive || !o.blocksMove) continue;
        if (o.shape === 'circle') {
          if (Math.hypot(px - o.x, py - o.y) < o.r + this.inflate) { b = 1; break; }
        } else if (Math.abs(px - o.x) < o.hw + this.inflate && Math.abs(py - o.y) < o.hh + this.inflate) { b = 1; break; }
      }
      this.blocked[y * n + x] = b;
    }
  }

  onObstacleRemoved(o: Obstacle) {
    const e = Math.max(o.r, o.hw, o.hh) + this.inflate + 1;
    this.rebuild(o.x - e, o.y - e, o.x + e, o.y + e);
  }

  canStandAt(p: Vec2, radius = this.inflate) {
    if (Math.abs(p.x) > this.half - radius || Math.abs(p.y) > this.half - radius) return false;
    return !this.obstacles.some((o) => o.alive && o.blocksMove && (o.shape === 'circle'
      ? Math.hypot(p.x - o.x, p.y - o.y) < o.r + radius
      : Math.abs(p.x - o.x) < o.hw + radius && Math.abs(p.y - o.y) < o.hh + radius));
  }

  canWalkSegment(a: Vec2, b: Vec2, radius = this.inflate) {
    if (!this.canStandAt(b, radius)) return false;
    return !this.obstacles.some((o) => o.alive && o.blocksMove && (o.shape === 'circle'
      ? segCircle(a.x, a.y, b.x, b.y, o.x, o.y, o.r + radius)
      : segAABB(a.x, a.y, b.x, b.y, o.x - o.hw - radius, o.y - o.hh - radius, o.x + o.hw + radius, o.y + o.hh + radius)) >= 0);
  }

  private nearestOpen(c: number) {
    if (!this.blocked[c]) return c;
    const n = this.n, cx = c % n, cy = Math.floor(c / n);
    let best = -1, distance = Infinity;
    for (let r = 1; r < 9; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const d = dx * dx + dy * dy;
      if (!this.blocked[y * n + x] && d < distance) { best = y * n + x; distance = d; }
    }
    return best >= 0 ? best : c;
  }

  /** Returns waypoints (cell centres, string-pulled lightly), excluding the start. */
  findPath(from: Vec2, to: Vec2, maxIter = 4000): Vec2[] | null {
    const n = this.n;
    const s = this.nearestOpen(this.cellOf(from.x, from.y));
    const t = this.nearestOpen(this.cellOf(to.x, to.y));
    if (this.blocked[s] || this.blocked[t]) return null;
    if (s === t) return [this.canWalkSegment(from, to) ? { ...to } : this.center(t)];
    const gen = ++this.gen;
    const tx = t % n, ty = Math.floor(t / n);
    const hfn = (c: number) => {
      const dx = Math.abs((c % n) - tx), dy = Math.abs(Math.floor(c / n) - ty);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    const heap = this.heap; heap.length = 0;
    const push = (c: number) => {
      heap.push(c);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (this.f[heap[p]] <= this.f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    this.g[s] = 0; this.f[s] = hfn(s); this.seen[s] = gen; this.from[s] = -1; push(s);
    let iter = 0, found = false;
    while (heap.length && iter++ < maxIter) {
      const c = pop();
      if (this.closed[c] === gen) continue;
      this.closed[c] = gen;
      if (c === t) { found = true; break; }
      const cx = c % n, cy = Math.floor(c / n);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const nc = y * n + x;
        if (this.blocked[nc] || this.closed[nc] === gen) continue;
        if (dx && dy && (this.blocked[cy * n + x] || this.blocked[y * n + cx])) continue; // no corner cutting
        const ng = this.g[c] + (dx && dy ? 1.4142 : 1);
        if (this.seen[nc] !== gen || ng < this.g[nc]) {
          this.seen[nc] = gen; this.g[nc] = ng; this.f[nc] = ng + hfn(nc); this.from[nc] = c; push(nc);
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = t; c !== -1 && c !== s; c = this.from[c]) cells.push(c);
    cells.reverse();
    // Keep a safe endpoint when the requested goal is inside cover (e.g. a crate).
    // Never replace the final turning point with an obstructed raw goal.
    const raw = [this.center(s), ...cells.map((c) => this.center(c))];
    if (this.canWalkSegment(raw[raw.length - 1], to)) raw.push({ ...to });
    const pts: Vec2[] = [];
    let anchor = from, i = 0;
    while (i < raw.length) {
      let far = i;
      while (far + 1 < raw.length && this.canWalkSegment(anchor, raw[far + 1])) far++;
      pts.push(raw[far]); anchor = raw[far]; i = far + 1;
    }
    return pts;
  }
}
