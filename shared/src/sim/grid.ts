/** Uniform spatial hash for static-ish items (obstacles, bushes). */
export class SpatialGrid<T extends { x: number; y: number }> {
  private cells: number[][];
  private stamp: Uint32Array;
  private curStamp = 1;
  readonly n: number;

  constructor(private items: T[], private half: number, private cell: number, extent: (it: T) => number) {
    this.n = Math.ceil((half * 2) / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.stamp = new Uint32Array(items.length);
    items.forEach((it, i) => {
      const e = extent(it);
      this.forCells(it.x - e, it.y - e, it.x + e, it.y + e, (c) => this.cells[c].push(i));
    });
  }

  private forCells(minx: number, miny: number, maxx: number, maxy: number, fn: (c: number) => void) {
    const n = this.n, h = this.half, s = this.cell;
    const x0 = Math.max(0, Math.floor((minx + h) / s)), x1 = Math.min(n - 1, Math.floor((maxx + h) / s));
    const y0 = Math.max(0, Math.floor((miny + h) / s)), y1 = Math.min(n - 1, Math.floor((maxy + h) / s));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * n + x);
  }

  /** Visits each item overlapping the box once. Return true from fn to stop early. */
  query(minx: number, miny: number, maxx: number, maxy: number, fn: (it: T, index: number) => boolean | void) {
    const st = ++this.curStamp;
    let stop = false;
    this.forCells(minx, miny, maxx, maxy, (c) => {
      if (stop) return;
      for (const i of this.cells[c]) {
        if (this.stamp[i] === st) continue;
        this.stamp[i] = st;
        if (fn(this.items[i], i)) { stop = true; return; }
      }
    });
  }
}
