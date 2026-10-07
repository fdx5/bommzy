/** Visual themes per arena: palette, prop kits, ambience. Gameplay lives in @pastel/shared maps. */
export type TimeOfDay = 'morning' | 'sunset' | 'night';
export type TreeKind = 'round' | 'pine' | 'apple' | 'broadleaf' | 'palm' | 'cactus' | 'barrel' | 'snowpine' | 'crystal';
export type RockShape = 'round' | 'mossy' | 'mesa' | 'crystal';
export type BushKind = 'puffy' | 'spiky' | 'snowy';
export type Ambient = 'petals' | 'fireflies' | 'sand' | 'snow';

export interface LightPreset {
  sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; fog: string; cloudA: string; cloudB: string; sunDir: [number, number, number];
}

export interface Theme {
  id: string;
  tods: TimeOfDay[];
  light: Partial<Record<TimeOfDay, Partial<LightPreset>>>;
  ground: { base: string; light: string; dark: string; checker: number; path: string; pathEdge: string; plaza: string; pad: string; padRing: string; dots: string[]; dotCount: number; ripples?: boolean };
  island: { top: string; side: string; under: string; underBottom: string; miniTop: string; miniBlob: string };
  fence: { post: string; cap: string; rail: string; outline: string };
  trees: [TreeKind, TreeKind, TreeKind];
  treeTints: [string[], string[], string[]];
  treeOutline: string;
  rock: { shape: RockShape; top: string; bottom: string; accent: string; outline: string; rubble: [string, string] };
  bush: { kind: BushKind; colors: string[]; blossoms: string[] | null; outline: string; withered: string };
  water: { deep: string; shallow: string; foam: string; bank: string; lily: boolean };
  grass: { mult: number; colors: string[]; height: number; base: string } | null;
  flowers: { colors: string[]; count: number } | null;
  mushrooms: boolean;
  ambient: Ambient[];
  crate: { body: string; plank: string; frame: string };
  minimap: { base: string; path: string; bush: string; tree: string; rock: string; crate: string; water: string; ice: string };
}

export const BASE_LIGHT: Record<TimeOfDay, LightPreset> = {
  morning: { sun: '#FFF1DC', sunI: 2.1, hemiSky: '#D6ECFF', hemiGround: '#8F80C2', hemiI: 1.15, fog: '#EAF2FF', cloudA: '#FFFFFF', cloudB: '#DCD3F2', sunDir: [-0.55, 1, 0.45] },
  sunset: { sun: '#FFDCC2', sunI: 2.0, hemiSky: '#FFE2D6', hemiGround: '#8F82BE', hemiI: 1.2, fog: '#FFE0D6', cloudA: '#FFF1EA', cloudB: '#E7C3DA', sunDir: [-0.9, 0.7, 0.25] },
  night: { sun: '#D6DEFF', sunI: 1.9, hemiSky: '#C6CEF7', hemiGround: '#7A6FB3', hemiI: 1.3, fog: '#A9ABDF', cloudA: '#D3D3F5', cloudB: '#9A94D0', sunDir: [0.5, 1, 0.3] },
};

export const THEMES: Record<string, Theme> = {
  meadow: {
    id: 'meadow', tods: ['morning', 'morning', 'sunset', 'night'], light: {},
    ground: { base: '#BFE3A8', light: 'rgba(220,245,200,0.45)', dark: 'rgba(150,200,140,0.28)', checker: 0.05, path: '#F6EEDF', pathEdge: 'rgba(232,214,180,0.55)', plaza: '#F6EEDF', pad: '#FFF8EC', padRing: 'rgba(255,170,165,0.7)', dots: ['#FFFFFF', '#FFC8DD', '#FFF5BA', '#C3B1E1', '#FFAAA5'], dotCount: 1400 },
    island: { top: '#A5D892', side: '#E3BE98', under: '#D8B08E', underBottom: '#9C8CC9', miniTop: '#A5D892', miniBlob: '#FFC8DD' },
    fence: { post: '#FFF8EE', cap: '#FFAAA5', rail: '#FFF1E0', outline: '#9C86B8' },
    trees: ['round', 'pine', 'apple'],
    treeTints: [['#FFC8DD', '#C9F0DA', '#D8C9F2', '#FFE3C2'], ['#B8E8C0', '#A9E2C9', '#C6EDB5'], ['#FFFFFF']],
    treeOutline: '#7D6B9E',
    rock: { shape: 'round', top: '#E3DDF2', bottom: '#B7AED6', accent: '#E3DDF2', outline: '#7A6C9C', rubble: ['#D8D1EA', '#ABA2CC'] },
    bush: { kind: 'puffy', colors: ['#9ED79A', '#93D0A0', '#A6DCA0', '#8FCDA6'], blossoms: ['#FFE9F2', '#FFF6C8'], outline: '#5F8C77', withered: '#CDBFA8' },
    water: { deep: '#8FCFEF', shallow: '#C3ECFF', foam: '#FFFFFF', bank: '#EADDBF', lily: true },
    grass: { mult: 1, colors: ['#B3E09D', '#A6D995', '#C3E8A8', '#9DD3A0'], height: 1, base: '#9FBF9A' },
    flowers: { colors: ['#FFC8DD', '#FFFFFF', '#C3B1E1', '#FFAAA5', '#B5DEFF', '#FFF5BA'], count: 320 },
    mushrooms: true,
    ambient: ['petals'],
    crate: { body: '#F7C99F', plank: '#EDB487', frame: '#D99A73' },
    minimap: { base: '#CFE9C1', path: '#F6EEDF', bush: '#86C98D', tree: '#7FB98E', rock: '#B8AED6', crate: '#F2B98A', water: '#9AD6F2', ice: '#DDF0FF' },
  },
  jungle: {
    id: 'jungle', tods: ['morning', 'sunset', 'night'],
    light: {
      morning: { hemiSky: '#D8F2E2', fog: '#D9F0E2', cloudA: '#F4FFF7', cloudB: '#BFE3D0', sun: '#FFF4D6' },
      sunset: { fog: '#FFE3CC', cloudB: '#E8C9C0' },
      night: { fog: '#8FA9C8', cloudA: '#BFD3E3', cloudB: '#7E95B8', hemiSky: '#B8D2E8' },
    },
    ground: { base: '#9ACF84', light: 'rgba(190,232,160,0.45)', dark: 'rgba(90,150,95,0.32)', checker: 0.035, path: '#DCC193', pathEdge: 'rgba(170,135,95,0.5)', plaza: '#D9CFB4', pad: '#EFE4C8', padRing: 'rgba(255,160,120,0.75)', dots: ['#FF9EBB', '#FFB38A', '#FFF5BA', '#FFFFFF', '#C9A0FF'], dotCount: 900 },
    island: { top: '#80C473', side: '#C9A07A', under: '#B38A68', underBottom: '#7E8FBF', miniTop: '#7FC273', miniBlob: '#6DBE8C' },
    fence: { post: '#D2DE8F', cap: '#9CC36B', rail: '#DDE6A6', outline: '#6E8C56' },
    trees: ['broadleaf', 'palm', 'round'],
    treeTints: [['#8BD38E', '#79C795', '#9CDA8E'], ['#FFFFFF', '#F0FFF2'], ['#6EC58F', '#86D296', '#5FBF96']],
    treeOutline: '#3F6E58',
    rock: { shape: 'mossy', top: '#D3D1C6', bottom: '#9AA79C', accent: '#8FCB7E', outline: '#55705F', rubble: ['#C9C8BC', '#95A196'] },
    bush: { kind: 'puffy', colors: ['#74C383', '#62B77E', '#82CD8C', '#6ABD93'], blossoms: ['#FF9EBB', '#FFB38A'], outline: '#3E7A5C', withered: '#BFAE8E' },
    water: { deep: '#5FC2B8', shallow: '#A3E6D8', foam: '#FFFFFF', bank: '#D9C69B', lily: true },
    grass: { mult: 1.45, colors: ['#93D180', '#82C775', '#A2DB8C', '#76BE80'], height: 1.5, base: '#5E9A6A' },
    flowers: { colors: ['#FF9EBB', '#FFB38A', '#FFE27A', '#C9A0FF', '#FFFFFF'], count: 300 },
    mushrooms: true,
    ambient: ['fireflies', 'petals'],
    crate: { body: '#E8C08E', plank: '#D9A673', frame: '#B9875F' },
    minimap: { base: '#A9D79A', path: '#DCC193', bush: '#5EAD74', tree: '#4F9C72', rock: '#A6B1A3', crate: '#E3AE7A', water: '#6FCFC4', ice: '#DDF0FF' },
  },
  desert: {
    id: 'desert', tods: ['morning', 'sunset'],
    light: {
      morning: { sun: '#FFEACB', sunI: 2.3, hemiSky: '#FFF0DA', hemiGround: '#B08AA8', fog: '#FBE9CF', cloudA: '#FFF7EA', cloudB: '#F0CDB4' },
      sunset: { sun: '#FFD1AA', fog: '#FFD7BE', cloudA: '#FFEADB', cloudB: '#E9B8B0', hemiGround: '#A07FA8' },
    },
    ground: { base: '#F2D6A2', light: 'rgba(252,235,200,0.55)', dark: 'rgba(222,180,125,0.35)', checker: 0.03, path: '#E6C08A', pathEdge: 'rgba(205,160,105,0.45)', plaza: '#EBD5A8', pad: '#F8E8C6', padRing: 'rgba(240,140,110,0.75)', dots: ['#FFFFFF', '#E8C79A', '#D9AE80'], dotCount: 500, ripples: true },
    island: { top: '#EFCF96', side: '#E2A97C', under: '#CC9069', underBottom: '#A889C9', miniTop: '#EFCF96', miniBlob: '#8FCB8A' },
    fence: { post: '#C99A6E', cap: '#F2D6A2', rail: '#BA8B60', outline: '#8C6248' },
    trees: ['cactus', 'barrel', 'palm'],
    treeTints: [['#FFFFFF', '#F2FFF2'], ['#FFFFFF', '#FFF6F0'], ['#FFFFFF', '#F6FFEA']],
    treeOutline: '#5E7A55',
    rock: { shape: 'mesa', top: '#F4C597', bottom: '#D38D6D', accent: '#E9A97F', outline: '#9A5E4C', rubble: ['#EDB98E', '#C98767'] },
    bush: { kind: 'spiky', colors: ['#C8C57A', '#BABC6E', '#D1C683', '#B3B67A'], blossoms: ['#FF9EBB'], outline: '#7D7A44', withered: '#D9C59E' },
    water: { deep: '#45C0C9', shallow: '#9DEBE2', foam: '#FFFFFF', bank: '#E8D4A0', lily: false },
    grass: { mult: 0.35, colors: ['#E2D08A', '#D8C27A', '#EAD99A'], height: 0.85, base: '#C9A86A' },
    flowers: { colors: ['#FF9EBB', '#FFE27A', '#FFB38A'], count: 60 },
    mushrooms: false,
    ambient: ['sand'],
    crate: { body: '#F2C996', plank: '#E3B17A', frame: '#C48E5E' },
    minimap: { base: '#F2D9A8', path: '#E6C08A', bush: '#BDB86F', tree: '#86C281', rock: '#E0A27D', crate: '#E7A96E', water: '#5DCAD0', ice: '#DDF0FF' },
  },
  glacier: {
    id: 'glacier', tods: ['morning', 'morning', 'night'],
    light: {
      morning: { sun: '#F6F9FF', sunI: 2.0, hemiSky: '#E3F0FF', hemiGround: '#8C94CC', fog: '#E6F0FB', cloudA: '#FFFFFF', cloudB: '#C9D8F0' },
      night: { fog: '#9EA9DD', cloudA: '#D8DEF8', cloudB: '#9AA3D6', hemiSky: '#C9D3F8' },
    },
    ground: { base: '#EAF2FB', light: 'rgba(255,255,255,0.7)', dark: 'rgba(190,210,235,0.45)', checker: 0.05, path: '#DCE7F5', pathEdge: 'rgba(180,200,230,0.5)', plaza: '#E1ECF8', pad: '#F7FBFF', padRing: 'rgba(120,170,240,0.7)', dots: ['#FFFFFF', '#CFE6FF', '#BFD9F7'], dotCount: 700 },
    island: { top: '#F4F8FF', side: '#BFD9F2', under: '#A3C6E6', underBottom: '#8A86C8', miniTop: '#F4F8FF', miniBlob: '#BFE6FF' },
    fence: { post: '#D8EEFF', cap: '#FFFFFF', rail: '#C3DFF5', outline: '#6F8FC0' },
    trees: ['snowpine', 'snowpine', 'crystal'],
    treeTints: [['#FFFFFF', '#F2FAFF'], ['#F6FFFB', '#FFFFFF'], ['#FFFFFF', '#EAF6FF']],
    treeOutline: '#557AA8',
    rock: { shape: 'crystal', top: '#E2F5FF', bottom: '#93C3E6', accent: '#FFFFFF', outline: '#4E78AE', rubble: ['#DDF0FF', '#A9CDEB'] },
    bush: { kind: 'snowy', colors: ['#96CDB6', '#88C3AE', '#A2D5BE'], blossoms: null, outline: '#4F8A80', withered: '#C9D2DB' },
    water: { deep: '#8FCFEF', shallow: '#C9EEFF', foam: '#FFFFFF', bank: '#E8F1FB', lily: false },
    grass: null,
    flowers: null,
    mushrooms: false,
    ambient: ['snow'],
    crate: { body: '#F3D2B0', plank: '#E2B990', frame: '#BE9572' },
    minimap: { base: '#EAF2FB', path: '#D6E3F3', bush: '#88C3AE', tree: '#6FA9A0', rock: '#9FC8E8', crate: '#E9BE95', water: '#8FCFEF', ice: '#C8E6FF' },
  },
};

THEMES.candy = {
  id: 'candy', tods: ['morning', 'morning', 'sunset'],
  light: {
    morning: { sun: '#FFF0F5', hemiSky: '#FFE6F2', fog: '#FFEAF4', cloudA: '#FFFFFF', cloudB: '#F7C9E0' },
    sunset: { sun: '#FFD9C8', fog: '#FFDCE6', cloudA: '#FFF0F5', cloudB: '#EBB5D2' },
  },
  ground: { base: '#FFD9E8', light: 'rgba(255,240,248,0.55)', dark: 'rgba(240,170,200,0.3)', checker: 0.06, path: '#FFF3D6', pathEdge: 'rgba(240,200,160,0.5)', plaza: '#FFF0E0', pad: '#FFFFFF', padRing: 'rgba(140,200,255,0.75)', dots: ['#FFFFFF', '#B5DEFF', '#FFF5BA', '#A8E6CF', '#C3B1E1'], dotCount: 1800 },
  island: { top: '#FFC2DA', side: '#C98B6B', under: '#A86E52', underBottom: '#9C8CC9', miniTop: '#FFC2DA', miniBlob: '#A8E6CF' },
  fence: { post: '#FFFFFF', cap: '#FF7A9A', rail: '#FFC8DD', outline: '#B0607E' },
  trees: ['round', 'apple', 'round'],
  treeTints: [['#FF9EC4', '#A8E6CF', '#C3B1E1', '#FFE27A'], ['#FFFFFF'], ['#B5DEFF', '#FFC8DD']],
  treeOutline: '#9C5A80',
  rock: { shape: 'round', top: '#FFF5BA', bottom: '#FFB3CF', accent: '#FFFFFF', outline: '#B0607E', rubble: ['#FFE3EE', '#F5B8D0'] },
  bush: { kind: 'puffy', colors: ['#FFC8DD', '#E9C9FF', '#C9F0FF', '#FFD6E8'], blossoms: ['#FFFFFF', '#FFF5BA'], outline: '#B07A9E', withered: '#E8D3C8' },
  water: { deep: '#FF9EC4', shallow: '#FFD6E8', foam: '#FFFFFF', bank: '#FFF0D6', lily: false },
  grass: { mult: 0.6, colors: ['#FFE0EE', '#FFD3E6', '#FFEAF2'], height: 0.8, base: '#F2B8CF' },
  flowers: { colors: ['#FFFFFF', '#FFE27A', '#B5DEFF', '#A8E6CF'], count: 200 },
  mushrooms: true,
  ambient: ['petals'],
  crate: { body: '#FFE6A8', plank: '#F7CF7E', frame: '#E0A35E' },
  minimap: { base: '#FFD9E8', path: '#FFF3D6', bush: '#F5A8CB', tree: '#E68FB6', rock: '#FFC9DC', crate: '#F2C27A', water: '#FF9EC4', ice: '#DDF0FF' },
};

THEMES.starlight = {
  id: 'starlight', tods: ['night'],
  light: { night: { sun: '#E6DEFF', sunI: 2.0, hemiSky: '#CFC6FF', hemiI: 1.4, fog: '#8E86D8', cloudA: '#D8D0FF', cloudB: '#8F86CC' } },
  ground: { base: '#A99CE0', light: 'rgba(210,200,255,0.45)', dark: 'rgba(110,95,180,0.35)', checker: 0.05, path: '#D9D2F5', pathEdge: 'rgba(170,160,230,0.5)', plaza: '#DCD4FA', pad: '#F2EEFF', padRing: 'rgba(255,226,122,0.8)', dots: ['#FFF5BA', '#FFFFFF', '#B5DEFF', '#FFC8DD'], dotCount: 1000 },
  island: { top: '#9C8ED8', side: '#7E70BE', under: '#6A5CA8', underBottom: '#3E3A80', miniTop: '#9C8ED8', miniBlob: '#FFE27A' },
  fence: { post: '#E6E0FF', cap: '#FFE27A', rail: '#CFC6FF', outline: '#5B4F9E' },
  trees: ['crystal', 'round', 'crystal'],
  treeTints: [['#FFFFFF', '#FFF2C8'], ['#8FA8F0', '#B59CF0', '#7FD0D8'], ['#FFD6F5', '#D6F5FF']],
  treeOutline: '#463A88',
  rock: { shape: 'crystal', top: '#F2EAFF', bottom: '#A08CE6', accent: '#FFF5BA', outline: '#4B3F94', rubble: ['#E6DCFF', '#B3A2EE'] },
  bush: { kind: 'puffy', colors: ['#7FA6E8', '#8C94E6', '#77B4E0', '#9A8CE6'], blossoms: ['#FFF5BA', '#FFFFFF'], outline: '#3E4A8E', withered: '#B7AFCF' },
  water: { deep: '#5A6FD0', shallow: '#9DB4F5', foam: '#FFFFFF', bank: '#CFC6F2', lily: true },
  grass: { mult: 0.9, colors: ['#9A8EDB', '#8E86D6', '#A69AE2'], height: 1.1, base: '#6F62B8' },
  flowers: { colors: ['#FFF5BA', '#FFFFFF', '#B5DEFF'], count: 220 },
  mushrooms: true,
  ambient: ['fireflies'],
  crate: { body: '#E8D6FF', plank: '#CDB8F5', frame: '#9F88D8' },
  minimap: { base: '#A99CE0', path: '#D9D2F5', bush: '#7FA0E6', tree: '#B9A8F0', rock: '#C9B8F5', crate: '#E0C9FF', water: '#5A6FD0', ice: '#DDF0FF' },
};

export function themeFor(id: string | undefined): Theme { return THEMES[id ?? 'meadow'] ?? THEMES.meadow; }
export function lightFor(theme: Theme, tod: TimeOfDay): LightPreset { return { ...BASE_LIGHT[tod], ...(theme.light[tod] ?? {}) }; }
