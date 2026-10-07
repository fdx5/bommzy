import { RNG, DEG, type Vec2 } from '../math';
import type { BushDef, MapData, Obstacle, ObstacleType, SlipZone } from '../sim/types';
import { clusterBushes } from '../sim/bush';

/**
 * All arenas are 80m × 80m and D4 symmetric (left/right, up/down, diagonal mirror) so the 8 spawn
 * points are equivalent. Each layout is authored for one octant (0°..45°) and mirrored; points
 * lying on a mirror line are de-duplicated.
 */
export const MAP_HALF = 40;

export type MapId = 'meadow' | 'jungle_ruins' | 'jungle_lagoon' | 'desert' | 'glacier' | 'candy_town' | 'starlight';

export interface MapInfo {
  id: MapId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  emoji: string;
  /** visual theme key used by the client renderer */
  theme: 'meadow' | 'jungle' | 'desert' | 'glacier' | 'candy' | 'starlight';
  /** only playable by logged-in players; guests never get it, not even from a random pick */
  memberOnly?: boolean;
}

export const MAPS: MapInfo[] = [
  { id: 'meadow', name: '파스텔 초원', nameEn: 'Pastel Meadow', emoji: '🌸', theme: 'meadow', desc: '균형 잡힌 기본 맵. 대각선 수풀 길과 중앙 광장', descEn: 'Balanced classic: diagonal bush lanes and a central plaza' },
  { id: 'jungle_ruins', name: '정글 유적', nameEn: 'Jungle Ruins', emoji: '🗿', theme: 'jungle', desc: '무너진 신전 벽과 울창한 수풀 미로. 매복의 천국', descEn: 'Crumbling temple walls and dense bush mazes. Ambush heaven' },
  { id: 'jungle_lagoon', name: '정글 라군', nameEn: 'Jungle Lagoon', emoji: '🏝️', theme: 'jungle', desc: '광장을 감싼 물길과 8개의 다리. 길목을 지배하라', descEn: 'A lagoon ring with 8 bridges around the plaza. Hold the chokepoints' },
  { id: 'desert', name: '사막 오아시스', nameEn: 'Desert Oasis', emoji: '🏜️', theme: 'desert', desc: '탁 트인 모래밭과 메사 바위. 긴 시야로 저격수가 강해요', descEn: 'Wide open sands and mesas. Long sightlines favour snipers' },
  { id: 'glacier', name: '빙하 지대', nameEn: 'Glacier', emoji: '🧊', theme: 'glacier', desc: '얼음판 위에서는 쭉 미끄러져요! 얼음 가시를 엄폐물로', descEn: 'You slide on the ice lakes! Use ice spikes for cover' },
  { id: 'candy_town', name: '사탕 마을', nameEn: 'Candy Town', emoji: '🍭', theme: 'candy', memberOnly: true, desc: '딸기우유 분수와 사탕 기둥 골목. 부숴서 길을 만들어요', descEn: 'A strawberry-milk fountain and candy-pillar alleys. Smash your own path' },
  { id: 'starlight', name: '별빛 정원', nameEn: 'Starlight Garden', emoji: '🌙', theme: 'starlight', memberOnly: true, desc: '밤의 정원, 달빛 연못과 수풀 고리. 매복과 기습의 무대', descEn: 'A moonlit garden of ponds and bush rings. Made for ambushes' },
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m])) as Record<MapId, MapInfo>;

interface Proto { type: ObstacleType | 'bush'; x: number; y: number; r: number; variant?: number; scale?: number; box?: boolean }

export const polar = (r: number, deg: number): Vec2 => ({ x: r * Math.cos(deg * DEG), y: r * Math.sin(deg * DEG) });
const SPAWN = polar(34, 22.5);

function mirror8(p: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (const [x, y] of [[p.x, p.y], [p.y, p.x]]) for (const sx of [1, -1]) for (const sy of [1, -1]) out.push({ x: x * sx, y: y * sy });
  return out;
}

/** Octant authoring helper. */
class Builder {
  protos: Proto[] = [];
  slips: SlipZone[] = [];
  constructor(readonly rng: RNG) {}
  add(type: Proto['type'], p: Vec2, r: number, extra: Partial<Proto> = {}) { this.protos.push({ type, x: p.x, y: p.y, r, ...extra }); }
  crate(p: Vec2) { this.add('crate', p, 0.8, { box: true }); }
  rock(p: Vec2, r = this.rng.range(0.85, 1.15)) { this.add('rock', p, r, { variant: this.rng.int(0, 2), scale: r }); }
  bush(p: Vec2, r = this.rng.range(1.05, 1.35)) { this.add('bush', p, r); }
  water(p: Vec2, r: number) { this.add('water', p, r); }
  patch(center: Vec2, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(0, spread);
      this.bush({ x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d });
    }
  }
  /** A line of rocks between two polar points. */
  wall(r0: number, a0: number, r1: number, a1: number, n: number, rr = 1) {
    for (let i = 0; i < n; i++) { const k = n === 1 ? 0 : i / (n - 1); this.rock(polar(r0 + (r1 - r0) * k, a0 + (a1 - a0) * k), rr); }
  }
  /** Rejection-sampled scatter inside the octant, away from spawns, lanes and other props. */
  scatter(type: ObstacleType, count: number, rMin: number, rMax: number, clear: number, opts: { variant?: () => number; r?: number; avoid?: (r: number, a: number) => boolean } = {}) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 3000) {
      const r = this.rng.range(rMin, rMax), a = this.rng.range(3, 42);
      const p = polar(r, a);
      if (Math.abs(p.x) > 38.6 || Math.abs(p.y) > 38.6) continue;
      if (Math.hypot(p.x - SPAWN.x, p.y - SPAWN.y) < 7.5) continue;
      if (opts.avoid?.(r, a)) continue;
      if (this.protos.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < q.r + clear)) continue;
      if (this.slips.some((z) => Math.hypot(z.x - p.x, z.y - p.y) < z.r + 1)) continue;
      const v = opts.variant?.() ?? this.rng.int(0, 2);
      if (type === 'rock') this.rock(p, opts.r ?? this.rng.range(0.9, 1.25));
      else this.add(type, p, opts.r ?? 0.75, { variant: v, scale: this.rng.range(0.9, 1.2) });
      placed++;
    }
  }
}

// ─────────────────────────────────────────────── layouts
const LAYOUTS: Record<MapId, (b: Builder) => void> = {
  meadow(b) {
    b.crate(polar(6, 0)); b.crate(polar(20, 0)); b.crate(polar(20, 45));
    for (let r = 12.5; r <= 27; r += 1.75) { const c = polar(r, 45); b.add('bush', { x: c.x - Math.SQRT1_2 * 0.9, y: c.y + Math.SQRT1_2 * 0.9 }, 1.2); }
    b.patch(polar(28, 8), 5, 2.2); b.patch(polar(14.5, 21), 4, 1.6); b.patch(polar(35, 38), 3, 1.4);
    b.bush(polar(9.5, 0), 1.2); b.bush(polar(10.5, 0), 1.2);
    for (const yy of [2.2, 3.9]) b.rock({ x: 17.2, y: yy });
    b.rock({ x: 22.8, y: 2.8 });
    for (const d of [-3.2, -1.6, 0, 1.6]) b.rock(polar(27.5, 22.5 + d * 2.1));
    for (const a of [16, 24, 32]) b.rock(polar(11.5, a));
    b.rock(polar(17.5, 40)); b.rock(polar(18.2, 36)); b.rock(polar(33, 4), 0.9); b.rock(polar(24, 14), 1.0);
    b.water(polar(31, 0), 2.6);
    b.scatter('tree', 7, 14, 38.5, 2.6, { avoid: (r, a) => Math.abs(a - 45) < 6 && r < 30 });
    b.add('tree', polar(37.5 * Math.SQRT2, 45), 0.75, { variant: 1, scale: 1.3 });
  },

  /** Temple ruins: broken wall ring around the plaza, bush mazes, dense forest edge. */
  jungle_ruins(b) {
    b.crate(polar(5, 0)); b.crate(polar(21, 0)); b.crate(polar(19.5, 45));
    // inner temple wall: broken ring with ~2.5m gates on the axes, diagonals and toward the spawns
    b.wall(13, 10, 13, 13.5, 2, 0.9);
    b.wall(13, 31.5, 13, 35, 2, 0.9);
    // outer ruin pillars + broken corridors
    b.rock(polar(24, 10), 1.25); b.rock(polar(24, 35), 1.25);
    b.wall(18, 26, 21, 26, 2, 0.95);
    b.wall(29, 4, 29, 12, 3, 1.0);
    // bush mazes
    for (let r = 15; r <= 27; r += 1.8) { b.bush(polar(r, 1.5), 1.2); b.bush(polar(r, 5.5), 1.15); }
    b.patch(polar(20, 22.5), 7, 2.6);
    b.patch(polar(31, 40), 5, 2.0);
    b.patch(polar(8.5, 30), 3, 1.0);
    b.bush(polar(9, 0), 1.25);
    b.water(polar(26, 45), 2.2);
    b.scatter('tree', 9, 27, 38.5, 2.4, { variant: () => b.rng.int(0, 2) });
    b.scatter('tree', 2, 14, 26, 3.2);
  },

  /** Lagoon ring with 8 bridges around the plaza island. */
  jungle_lagoon(b) {
    b.crate(polar(5.5, 0)); b.crate(polar(24, 0)); b.crate(polar(23, 45));
    for (const a of [13, 17.75, 22.5, 27.25, 32]) b.water(polar(15, a), 1.85);   // ~3m bridges at 0° and 45°
    b.patch(polar(9, 22.5), 4, 1.3);
    b.patch(polar(22, 12), 4, 1.6);
    b.patch(polar(22, 33), 4, 1.6);
    b.patch(polar(32, 6), 3, 1.4);
    b.rock(polar(19.5, 4), 1.0); b.rock(polar(19.5, 41), 1.0);
    for (const d of [-1.6, 0, 1.6]) b.rock(polar(28, 22.5 + d * 2.2), 0.95);
    b.water(polar(31, 0), 2.4);
    b.scatter('tree', 7, 19, 38.5, 2.6, { avoid: (r) => r < 19 });
  },

  /** Open dunes, mesa rock clusters, cacti, central oasis. */
  desert(b) {
    b.water({ x: 0, y: 0 }, 3.2);                      // oasis
    b.crate(polar(7.5, 0)); b.crate(polar(21, 0)); b.crate(polar(21, 45));
    const mesa = (c: Vec2, n: number, spread: number) => {
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + b.rng.next(), d = i === 0 ? 0 : spread; b.rock({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d }, b.rng.range(1.15, 1.45)); }
    };
    mesa(polar(14, 22.5), 4, 1.9);
    mesa(polar(25, 9), 3, 1.8);
    mesa(polar(26, 37), 3, 1.8);
    b.rock(polar(33, 0), 1.3);
    b.rock(polar(10, 40), 1.0);
    b.patch(polar(17, 1), 3, 1.0);
    b.patch(polar(30, 28), 2, 1.0);
    b.scatter('tree', 5, 12, 38.5, 3.2, { variant: () => (b.rng.next() < 0.7 ? 0 : 1) });
    b.add('tree', polar(5, 45), 0.75, { variant: 2, scale: 1.1 }); // oasis palms
  },

  /** Candy pillars on a grid (destructible cover), cotton-candy bushes, strawberry-milk fountain. */
  candy_town(b) {
    b.water({ x: 0, y: 0 }, 2.4);
    b.crate(polar(7, 0)); b.crate(polar(22, 45)); b.crate(polar(26, 0));
    for (const x of [11, 17, 23, 29]) for (const y of [4.5, 10.5, 16.5]) {
      if (y > x - 3) continue;
      if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 8) continue;
      b.rock({ x, y }, 0.95);
    }
    for (let x = 13.5; x <= 27; x += 1.9) b.bush({ x, y: 1.1 }, 1.15);
    b.patch(polar(16, 32), 4, 1.5);
    b.patch(polar(31, 40), 4, 1.6);
    b.patch(polar(9, 22.5), 3, 1.0);
    b.water(polar(33, 0), 2.0);
    b.scatter('tree', 7, 20, 38.5, 2.6, { avoid: (r, a) => r < 31 && a < 30 });
  },

  /** Night garden: bush ring around the moon plaza, moon ponds, crystal cover lines. */
  starlight(b) {
    b.crate(polar(5.5, 22.5)); b.crate(polar(28, 0));
    for (const a of [9, 15, 21, 27, 33]) b.bush(polar(10, a), 1.25);
    b.patch(polar(25, 9), 6, 2.4);
    b.patch(polar(25, 37), 6, 2.4);
    b.patch(polar(36, 2), 3, 1.2);
    b.water(polar(18, 45), 2.6);
    b.water(polar(31, 22.5 - 12), 1.6);
    b.rock(polar(14.5, 0), 1.15);
    b.wall(19, 18, 19, 27, 3, 0.95);
    b.rock(polar(31, 45), 1.2);
    b.scatter('tree', 8, 16, 38.5, 2.6, { avoid: (r, a) => Math.abs(a - 22.5) < 8 && r > 26 });
  },

  /** Ice lakes you slide across, ice-spike walls, snowy pines. */
  glacier(b) {
    b.slips.push({ x: 0, y: 0, r: 7.5 });
    const lake = polar(21, 22.5);
    for (const m of mirror8(lake)) if (!b.slips.some((z) => Math.hypot(z.x - m.x, z.y - m.y) < 0.3)) b.slips.push({ x: m.x, y: m.y, r: 4.2 });
    for (const m of mirror8(polar(30, 0))) if (!b.slips.some((z) => Math.hypot(z.x - m.x, z.y - m.y) < 0.3)) b.slips.push({ x: m.x, y: m.y, r: 3.2 });
    b.crate(polar(5, 0)); b.crate(polar(19, 0)); b.crate(polar(18.5, 45));
    b.wall(10.5, 30, 10.5, 40, 3, 1.0);
    b.wall(15, 4, 15, 10, 2, 1.0);
    b.wall(27.5, 14, 27.5, 31, 4, 0.95);
    b.rock(polar(24, 42), 1.1);
    b.patch(polar(25, 40), 4, 1.5);
    b.patch(polar(16, 18), 3, 1.1);
    b.patch(polar(34, 8), 3, 1.2);
    b.scatter('tree', 7, 13, 38.5, 2.6);
  },
};

export function buildMap(id: MapId = 'meadow', seed = 7): MapData {
  const info = MAP_BY_ID[id] ?? MAP_BY_ID.meadow;
  const rng = new RNG(seed + id.length * 131);
  const b = new Builder(rng);
  LAYOUTS[info.id](b);

  const obstacles: Obstacle[] = [];
  const bushes: BushDef[] = [];
  const taken: Proto[] = [];
  for (const p of b.protos) {
    for (const m of mirror8(p)) {
      if (taken.some((q) => q.type === p.type && Math.abs(q.x - m.x) < 0.3 && Math.abs(q.y - m.y) < 0.3)) continue;
      taken.push({ ...p, x: m.x, y: m.y });
      if (p.type === 'bush') {
        bushes.push({ id: bushes.length, x: m.x, y: m.y, r: p.r, cluster: -1 });
      } else {
        const type = p.type as ObstacleType;
        const hp = type === 'rock' ? 100 : type === 'crate' ? 2600 : 0;
        obstacles.push({
          id: obstacles.length, type, variant: p.variant ?? 0, x: m.x, y: m.y,
          rot: rng.range(0, Math.PI * 2), scale: p.scale ?? 1,
          shape: p.box ? 'box' : 'circle', r: p.r, hw: p.box ? p.r : 0, hh: p.box ? p.r : 0,
          blocksMove: true, blocksShots: type !== 'water',
          destructible: type === 'rock' || type === 'crate', hp, maxHp: hp, alive: true,
          cubes: type === 'crate' ? 1 : 0,
        });
      }
    }
  }
  clusterBushes(bushes);
  const spawns: Vec2[] = [];
  for (let i = 0; i < 8; i++) spawns.push(polar(34, 22.5 + i * 45));
  return { id: info.id, name: info.name, theme: info.theme, half: MAP_HALF, spawns, obstacles, bushes, slipZones: b.slips };
}

/** Random arena; guests (`members` = false) never get a member-only map. */
export function randomMapId(members = true): MapId {
  const pool = MAPS.filter((m) => members || !m.memberOnly);
  return pool[Math.floor(Math.random() * pool.length)].id;
}
