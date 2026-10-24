import { RNG, DEG, type Vec2 } from '../math';
import type { BushDef, MapData, Obstacle, ObstacleType, SlipZone } from '../sim/types';
import { clusterBushes } from '../sim/bush';

export const MAP_HALF = 40;
export type MapId = 'meadow' | 'jungle_ruins' | 'jungle_lagoon' | 'desert' | 'glacier' | 'candy_town' | 'starlight'
  | 'sunken_harbor' | 'ember_forge' | 'bamboo_pass' | 'neon_junction' | 'crystal_cavern' | 'sky_gardens';
export interface MapInfo {
  id: MapId; name: string; nameEn: string; desc: string; descEn: string; emoji: string; theme: string; memberOnly?: boolean;
}
export const MAPS: MapInfo[] = [
  { id: 'meadow', name: '파스텔 초원', nameEn: 'Pastel Meadow', emoji: '🌸', theme: 'meadow', desc: 'S자 산책로와 엇갈린 울타리. 옆길로 돌아 기습하세요', descEn: 'S-shaped trails and staggered hedges with flanking routes' },
  { id: 'jungle_ruins', name: '정글 유적', nameEn: 'Jungle Ruins', emoji: '🗿', theme: 'jungle', desc: '직사각 신전 회랑과 네 개의 출입구, 벽 뒤 우회로', descEn: 'Rectangular temple corridors, four gates and outer flanks' },
  { id: 'jungle_lagoon', name: '정글 라군', nameEn: 'Jungle Lagoon', emoji: '🏝️', theme: 'jungle', desc: '두 줄의 강과 세 개의 다리. 넓은 강변으로 우회', descEn: 'Twin rivers, three crossings and broad riverbank routes' },
  { id: 'desert', name: '사막 오아시스', nameEn: 'Desert Oasis', emoji: '🏜️', theme: 'desert', desc: '두 오아시스 사이 장거리 협곡과 지그재그 바위 능선', descEn: 'A long canyon between twin oases and zigzag mesas' },
  { id: 'glacier', name: '빙하 지대', nameEn: 'Glacier', emoji: '🧊', theme: 'glacier', desc: 'X자 얼음 활주로와 네 개의 안전한 눈밭', descEn: 'Crossing ice runways and four sheltered snowfields' },
  { id: 'candy_town', name: '사탕 마을', nameEn: 'Candy Town', emoji: '🍭', theme: 'candy', memberOnly: true, desc: '블록형 사탕 골목과 넓은 십자대로. 골목 벽을 부수세요', descEn: 'Candy city blocks and a wide cross-shaped boulevard' },
  { id: 'starlight', name: '별빛 정원', nameEn: 'Starlight Garden', emoji: '🌙', theme: 'starlight', memberOnly: true, desc: '두 나선 산책로와 초승달 연못. 회전하며 접근', descEn: 'Twin spiral walks and crescent ponds for circling attacks' },
  { id: 'sunken_harbor', name: '해저 항구', nameEn: 'Sunken Harbor', emoji: '⚓', theme: 'harbor', desc: '빗살형 부두와 긴 수로. 부두마다 탈출구 확보', descEn: 'Comb-shaped piers, long channels and open escape routes' },
  { id: 'ember_forge', name: '잿불 용광로', nameEn: 'Ember Forge', emoji: '🔥', theme: 'forge', desc: '육각 용광로와 방사형 통로. 세 방향에서 교전', descEn: 'A hexagonal furnace with radial combat approaches' },
  { id: 'bamboo_pass', name: '대나무 고개', nameEn: 'Bamboo Pass', emoji: '🎋', theme: 'bamboo', desc: '엇갈린 대나무 띠 사이 S자 협로와 외곽 우회', descEn: 'Staggered bamboo belts, winding passes and outer flanks' },
  { id: 'neon_junction', name: '네온 교차로', nameEn: 'Neon Junction', emoji: '🌃', theme: 'neon', desc: '사선 교차로와 작은 엄폐 블록. 끊임없이 이동하세요', descEn: 'Diagonal intersections and small cover blocks reward movement' },
  { id: 'crystal_cavern', name: '수정 동굴', nameEn: 'Crystal Cavern', emoji: '💎', theme: 'cavern', desc: '갈라진 수정 고리와 넓은 동굴 방, 여러 연결 통로', descEn: 'Broken crystal rings, broad chambers and multiple connectors' },
  { id: 'sky_gardens', name: '하늘 정원', nameEn: 'Sky Gardens', emoji: '☁️', theme: 'sky', desc: '네 잎 모양 정원과 중앙 연결로. 연못을 끼고 회전', descEn: 'Four petal gardens linked through a broad central crossing' },
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m])) as Record<MapId, MapInfo>;
export const polar = (r: number, deg: number): Vec2 => ({ x: r * Math.cos(deg * DEG), y: r * Math.sin(deg * DEG) });
interface Proto { type: ObstacleType | 'bush'; x: number; y: number; r: number }

/** Layouts use 180-degree fairness rather than forcing the same octant onto every arena. */
class Builder {
  props: Proto[] = []; paths: Vec2[][] = []; slips: SlipZone[] = [];
  constructor(readonly rng: RNG) {}
  add(type: Proto['type'], x: number, y: number, r = 1) {
    for (const s of [1, -1]) this.props.push({ type, x: x * s, y: y * s, r });
  }
  line(type: Proto['type'], ax: number, ay: number, bx: number, by: number, r = 1, gap = 1.8) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / gap));
    for (let i = 0; i <= n; i++) this.add(type, ax + (bx - ax) * i / n, ay + (by - ay) * i / n, r);
  }
  arc(type: Proto['type'], cx: number, cy: number, radius: number, start: number, end: number, r = 1, step = 12) {
    for (let a = start; a <= end; a += step) { const p = polar(radius, a); this.add(type, cx + p.x, cy + p.y, r); }
  }
  trail(points: [number, number][]) {
    this.paths.push(points.map(([x, y]) => ({ x, y })), points.map(([x, y]) => ({ x: -x, y: -y })));
  }
  ice(x: number, y: number, r: number) { this.slips.push({ x, y, r }, { x: -x, y: -y, r }); }
}
const LAYOUTS: Record<MapId, (b: Builder) => void> = {
  meadow(b) {
    b.trail([[-34, -14], [-22, -8], [-12, 10], [10, 12], [24, -10], [34, -14]]);
    b.line('rock', -20, -4, -14, -4); b.line('rock', -2, 16, 6, 16);
    b.line('rock', -27, 20, -23, 24); b.line('bush', -24, -9, -12, -9, 1.2);
    b.line('bush', -10, 20, 5, 20, 1.2); b.arc('bush', 22, -20, 4, 0, 160, 1.2, 20);
    b.add('water', 26, 1, 3); b.arc('rock', 4, -6, 6, 10, 120, 1, 24);
  },
  jungle_ruins(b) {
    b.trail([[-34, -14], [-24, -20], [0, -20], [24, -20], [24, 20], [0, 20]]);
    for (const y of [-18, 18]) { b.line('rock', 5, y, 18, y); b.line('bush', 7, y + 4, 19, y + 4, 1.3); }
    b.line('rock', 20, -12, 20, -5); b.line('rock', 20, 5, 20, 12);
    b.line('rock', 5, -6, 11, -6); b.line('bush', -3, -28, 20, -28, 1.3);
    b.add('water', 30, 0, 3); b.arc('bush', 0, 0, 11, 35, 140, 1.2, 15);
  },
  jungle_lagoon(b) {
    for (const y of [-26, -22, -18, -10, -6, -2, 2, 6, 10, 18, 22, 26]) b.add('water', 11, y, 1.7);
    for (const y of [-14, 14]) b.trail([[-35, y], [-20, y], [0, y], [20, y], [35, y]]);
    b.trail([[0, -34], [0, 0], [0, 34]]);
    b.line('rock', -4, -23, 4, -23); b.line('rock', 24, -4, 28, -4);
    b.line('bush', 17, -24, 17, -16, 1.2); b.line('bush', 17, -8, 17, 6, 1.2); b.arc('bush', 0, 0, 6, 15, 160, 1.15, 20);
  },
  desert(b) {
    b.trail([[-34, -14], [-20, -12], [-7, 0], [18, 7], [34, 14]]);
    b.add('water', 0, 23, 4.2);
    b.line('rock', -24, 3, -18, 8, 1.45, 2.1); b.line('rock', -12, 10, -5, 12, 1.35, 2.2);
    b.line('rock', 12, -18, 23, -14, 1.4, 2.2); b.line('rock', 29, 21, 33, 25, 1.4, 2.2);
    b.line('bush', -6, 25, 6, 28, 1.2); b.line('bush', -27, -21, -17, -21, 1.1);
    b.add('rock', 2, -7, 1.4); b.add('rock', 8, 4, 1.5);
  },
  glacier(b) {
    for (let x = -25; x <= 25; x += 7) { b.ice(x, x, 4); b.ice(x, -x, 4); }
    b.trail([[-28, -28], [0, 0], [28, 28]]); b.trail([[-28, 28], [0, 0], [28, -28]]);
    b.line('rock', -23, -3, -15, -3); b.line('rock', -4, 15, -4, 23);
    b.line('rock', 14, -4, 19, -4); b.line('rock', 4, -20, 4, -15);
    b.line('bush', -26, 6, -17, 6, 1.2); b.line('bush', 7, 17, 7, 28, 1.2); b.arc('bush', 0, 0, 12, 20, 80, 1.2, 12);
  },
  candy_town(b) {
    b.trail([[-35, 0], [35, 0]]); b.trail([[0, -35], [0, 35]]);
    for (const x of [-22, 10]) for (const y of [-22, 10]) {
      b.line('rock', x, y, x + 7, y, 0.95); b.line('rock', x, y + 3, x, y + 7, 0.95);
      b.line('bush', x + 3, y + 7, x + 8, y + 7, 1.1);
    }
    b.add('water', 28, 0, 2.3); b.line('bush', -5, -31, -5, -23, 1.2);
    b.trail([[-28, -28], [-28, 28], [28, 28]]);
  },
  starlight(b) {
    const pts: [number, number][] = [];
    for (let a = 0; a <= 270; a += 15) { const p = polar(7 + a / 15, a); pts.push([p.x, p.y]); if (a % 30 === 0) b.add('rock', p.x * 0.7, p.y * 0.7, 1); }
    b.trail(pts); b.arc('water', 0, 0, 21, 20, 80, 2, 10);
    b.arc('bush', 0, 0, 13, 90, 240, 1.2, 12); b.line('bush', -29, 0, -29, 10, 1.2);
  },
  sunken_harbor(b) {
    for (const x of [8, 20]) { b.line('water', x, -25, x, -6, 2, 3); b.line('rock', x + 4, -24, x + 4, -14, 0.9); }
    b.trail([[-33, -14], [-28, 0], [28, 0], [33, 14]]); b.trail([[-2, -33], [-2, 33]]);
    b.line('bush', -25, -23, -15, -23, 1.2); b.line('bush', -28, 9, -15, 9, 1.2);
    b.line('rock', -22, 16, -15, 16); b.arc('rock', 0, 0, 10, 30, 120, 1, 18);
  },
  ember_forge(b) {
    for (let a = 0; a < 180; a += 60) {
      const p = polar(13, a), q = polar(13, a + 35); b.line('rock', p.x, p.y, q.x, q.y, 1.25, 2);
      const r = polar(22, a + 15); b.add('water', r.x, r.y, 2.4);
      const s = polar(29, a + 35); b.line('bush', s.x - 3, s.y, s.x + 3, s.y, 1.2);
      b.trail([[0, 0], [r.x * 0.7, r.y * 0.7], [r.x * 1.5, r.y * 1.5]]);
    }
    b.arc('bush', 0, 0, 7, 5, 175, 1.1, 18); b.line('rock', -30, -4, -24, -4);
  },
  bamboo_pass(b) {
    b.trail([[-34, -14], [-26, -20], [-9, -20], [10, 0], [-10, 20], [26, 20], [34, 14]]);
    for (const y of [-23, -8, 8, 23]) {
      const x = y < 0 ? -22 : 7;
      b.line('rock', x, y, x + 11, y, 0.9); b.line('bush', x, y + 3, x + 14, y + 3, 1.3);
    }
    b.add('water', 29, 0, 2.5);
  },
  neon_junction(b) {
    b.trail([[-32, -24], [32, 24]]); b.trail([[-32, 24], [32, -24]]);
    b.trail([[-30, -30], [-30, 30], [30, 30], [30, -30], [-30, -30]]);
    for (const [x, y] of [[0, 14], [14, 0], [20, 23], [23, -20], [5, -24], [-24, -5]]) {
      b.line('rock', x - 2, y, x + 2, y, 1); b.line('bush', x - 2, y + 4, x + 4, y + 4, 1.2);
    }
    b.add('water', 0, 0, 2.4);
  },
  crystal_cavern(b) {
    b.arc('rock', 0, 0, 13, 10, 65, 1.4, 10); b.arc('rock', 0, 0, 25, 35, 105, 1.4, 7);
    b.arc('rock', 0, 0, 25, 135, 160, 1.4, 7);
    b.arc('bush', 0, 0, 19, 0, 150, 1.3, 10); b.add('water', 0, 0, 3.2);
    const pts: [number, number][] = []; for (let a = 0; a <= 180; a += 15) { const p = polar(19, a); pts.push([p.x, p.y]); } b.trail(pts);
    b.trail([[-34, 0], [34, 0]]); b.trail([[0, -34], [0, 34]]);
  },
  sky_gardens(b) {
    for (const [x, y] of [[18, 18], [18, -18]]) {
      b.add('water', x, y, 5); b.arc('bush', x, y, 8, 0, 160, 1.2, 16);
      b.arc('rock', x, y, 8, 190, 270, 1, 20);
      const pts: [number, number][] = []; for (let a = 0; a <= 360; a += 30) { const p = polar(9, a); pts.push([x + p.x, y + p.y]); } b.trail(pts);
    }
    b.trail([[-34, 0], [34, 0]]); b.trail([[0, -34], [0, 34]]); b.line('rock', 5, 7, 9, 7);
  },
};

export function buildMap(id: MapId = 'meadow', seed = 7): MapData {
  const info = MAP_BY_ID[id] ?? MAP_BY_ID.meadow, index = MAPS.indexOf(info);
  const rng = new RNG(seed + index * 131), b = new Builder(rng);
  const spawns = Array.from({ length: 8 }, (_, i) => polar(34, 22.5 + i * 45));
  // Twelve distributed objectives; positions vary by arena rather than a universal ring.
  const angle = index % 3 * 15;
  for (let i = 0; i < 4; i++) { const p = polar(7 + index % 3, angle + i * 90); b.props.push({ type: 'crate', ...p, r: 0.8 }); }
  for (let i = 0; i < 8; i++) { const p = polar(22 + index % 2 * 2, angle + i * 45); b.props.push({ type: 'crate', ...p, r: 0.8 }); }
  LAYOUTS[info.id](b);
  // Perimeter dressing is intentionally sparse; it cannot block spawn exits or authored corridors.
  for (let i = 0; i < 28; i++) {
    const p = polar(36 + rng.next() * 2, i * 180 / 28);
    if (Math.abs(p.x) < 38 && Math.abs(p.y) < 38) b.add('tree', p.x, p.y, 0.75);
  }
  const obstacles: Obstacle[] = [], bushes: BushDef[] = [], taken: Proto[] = [];
  for (const p of b.props) {
    if (Math.abs(p.x) + p.r > 39 || Math.abs(p.y) + p.r > 39) continue;
    if (spawns.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 4.8 + p.r)) continue;
    if (taken.some((q) => q.type === p.type && Math.hypot(q.x - p.x, q.y - p.y) < 0.3)) continue;
    if (p.type !== 'bush' && taken.some((q) => q.type !== 'bush' && !(q.type === p.type && (p.type === 'rock' || p.type === 'water')) && Math.hypot(q.x - p.x, q.y - p.y) < (p.r + q.r) * 0.95)) continue;
    taken.push(p);
    if (p.type === 'bush') { bushes.push({ id: bushes.length, x: p.x, y: p.y, r: p.r, cluster: -1 }); continue; }
    const hp = p.type === 'crate' ? 2600 : p.type === 'rock' ? 100 : 0;
    obstacles.push({ id: obstacles.length, type: p.type, x: p.x, y: p.y, r: p.r, hw: p.type === 'crate' ? p.r : 0, hh: p.type === 'crate' ? p.r : 0,
      shape: p.type === 'crate' ? 'box' : 'circle', variant: rng.int(0, 2), rot: rng.range(0, Math.PI * 2), scale: p.type === 'rock' ? p.r : 1,
      blocksMove: true, blocksShots: p.type !== 'water', destructible: hp > 0, hp, maxHp: hp, alive: true, cubes: p.type === 'crate' ? 1 : 0 });
  }
  clusterBushes(bushes);
  return { id: info.id, name: info.name, theme: info.theme, half: MAP_HALF, spawns, obstacles, bushes, slipZones: b.slips, paths: b.paths };
}
export function randomMapId(members = true): MapId {
  const pool = MAPS.filter((m) => members || !m.memberOnly);
  return pool[Math.floor(Math.random() * pool.length)].id;
}
