import { CHARACTERS, levelXp, type CharacterId, type MapId } from '@pastel/shared';

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high';
  sfx: number;
  music: number;
  vibration: boolean;
  leftHanded: boolean;
  stickSize: number;
  stickOpacity: number;
  aimSensitivity: number;
  uiScale: number;
  colorblind: boolean;
  lang: 'ko' | 'en';
  showStats: boolean;
}

export interface MatchRecord {
  date: number;
  nickname: string;
  charId: CharacterId;
  place: number;
  score: number;
  kills: number;
  damage: number;
  trophyDelta: number;
}

export interface Profile {
  version: 1;
  deviceId: string;
  nickname: string;
  selected: CharacterId;
  skins: Partial<Record<CharacterId, string>>;
  trophies: Record<CharacterId, number>;
  xp: number;
  level: number;
  totalScore: number;
  wins: number;
  games: number;
  kills: number;
  bestScore: number;
  history: MatchRecord[];
  records: MatchRecord[];
  settings: Settings;
  tutorialDone: boolean;
  mapId: MapId | 'random';
  autoQuality?: 'low' | 'medium' | 'high';
}

const KEY = 'boomzy/profile/v1';
const LEGACY_KEY = 'pastel-brawl/profile/v1'; // pre-rename saves are migrated

const NAMES = ['말랑', '뽀송', '몽실', '토실', '보들', '쫀득', '방울', '구름', '젤리', '마카롱'];
const NOUNS = ['곰돌', '냥냥', '토끼', '햄찌', '펭펭', '여우', '다람', '병아리'];

export const defaultSettings = (): Settings => ({
  quality: 'auto', sfx: 0.8, music: 0.5, vibration: true, leftHanded: false,
  stickSize: matchMedia('(min-width: 900px) and (pointer: coarse)').matches ? 90 : 70,
  stickOpacity: 0.85, aimSensitivity: 1, uiScale: 1, colorblind: false,
  lang: (navigator.language || 'ko').startsWith('ko') ? 'ko' : 'en', showStats: false,
});

function uuid() {
  try { return crypto.randomUUID(); } catch { return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function fresh(): Profile {
  const r = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return {
    version: 1, deviceId: uuid(), nickname: r(NAMES) + r(NOUNS) + Math.floor(Math.random() * 90 + 10),
    selected: 'toto', skins: {}, trophies: Object.fromEntries(CHARACTERS.map((c) => [c.id, 0])) as Record<CharacterId, number>,
    xp: 0, level: 1, totalScore: 0, wins: 0, games: 0, kills: 0, bestScore: 0, history: [], records: [],
    settings: defaultSettings(), tutorialDone: false, mapId: 'meadow',
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p.version === 1) {
        p.settings = { ...defaultSettings(), ...p.settings };
        for (const c of CHARACTERS) p.trophies[c.id] ??= 0;
        p.mapId ??= 'meadow';
        return p;
      }
    }
  } catch { /* storage unavailable or corrupt → fresh profile */ }
  return fresh();
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export function totalTrophies(p: Profile) { return Object.values(p.trophies).reduce((a, b) => a + b, 0); }

/** Adds XP, returns number of level-ups. */
export function addXp(p: Profile, xp: number) {
  p.xp += xp;
  let ups = 0;
  while (p.xp >= levelXp(p.level)) { p.xp -= levelXp(p.level); p.level++; ups++; }
  return ups;
}

export function recordMatch(p: Profile, r: MatchRecord) {
  p.history.unshift(r);
  p.history = p.history.slice(0, 30);
  p.records.push(r);
  p.records.sort((a, b) => b.score - a.score);
  p.records = p.records.slice(0, 100);
  p.games++;
  p.totalScore += r.score;
  p.kills += r.kills;
  if (r.place === 1) p.wins++;
  const best = r.score > p.bestScore;
  if (best) p.bestScore = r.score;
  p.trophies[r.charId] = Math.max(0, (p.trophies[r.charId] ?? 0) + r.trophyDelta);
  return best;
}

export function favoriteCharacter(p: Profile): CharacterId {
  const count: Record<string, number> = {};
  for (const h of p.history) count[h.charId] = (count[h.charId] ?? 0) + 1;
  return (Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] as CharacterId) ?? p.selected;
}
