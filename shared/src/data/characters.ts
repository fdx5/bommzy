import { WEAPONS, SUPERS, GADGETS, type WeaponDef, type SuperDef, type GadgetDef } from './weapons';

export type CharacterId = 'toto' | 'boogie' | 'popo' | 'luna' | 'kiki' | 'mongle' | 'leo' | 'hoya';

export interface Skin { id: string; name: string; nameEn: string; palette: string[]; unlockTrophies: number }

export interface CharacterDef {
  id: CharacterId;
  displayName: string;
  displayNameEn: string;
  concept: string;
  role: string;
  roleEn: string;
  hp: number;
  moveSpeed: number;    // m/s
  speedLabel: '느림' | '보통' | '빠름';
  hitboxRadius: number;
  weaponId: string;
  superId: string;
  gadgetId: string;
  /** [body, accent, detail, extra] pastel hex */
  colorPalette: string[];
  skins: Skin[];
  /** only selectable by logged-in (registered) players; guests see a sign-up prompt */
  memberOnly?: boolean;
}

const SPEED = { slow: 4.3, normal: 4.9, fast: 5.5 };

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'toto', displayName: '토토', displayNameEn: 'Toto', concept: '민트색 곰돌이, 노란 헬멧과 큰 고글',
    role: '중거리 지속 딜러', roleEn: 'Mid-range DPS', hp: 3200, moveSpeed: SPEED.normal, speedLabel: '보통',
    hitboxRadius: 0.55, weaponId: 'gatling', superId: 'honeyGatling', gadgetId: 'honeyShield',
    colorPalette: ['#A8E6CF', '#FFE27A', '#7FC8B0', '#FFAAA5'],
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#A8E6CF', '#FFE27A', '#7FC8B0', '#FFAAA5'], unlockTrophies: 0 },
      { id: 'choco', name: '초코 곰', nameEn: 'Choco', palette: ['#D9B8A0', '#FFC8DD', '#B8957C', '#FFF5BA'], unlockTrophies: 40 },
      { id: 'night', name: '별밤 곰', nameEn: 'Night Sky', palette: ['#B5C3F0', '#C3B1E1', '#8E9CD8', '#FFF5BA'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'boogie', displayName: '부기', displayNameEn: 'Boogie', concept: '피치색 불도그, 카우보이 모자, 앞치마',
    role: '근접 브루저', roleEn: 'Close-range Brawler', hp: 4200, moveSpeed: SPEED.normal, speedLabel: '보통',
    hitboxRadius: 0.62, weaponId: 'shotgun', superId: 'bigBang', gadgetId: 'bullRush',
    colorPalette: ['#FFD3B6', '#C79A7A', '#FFFFFF', '#FFAAA5', '#8EC5F0'],
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#FFD3B6', '#C79A7A', '#FFFFFF', '#FFAAA5', '#8EC5F0'], unlockTrophies: 0 },
      { id: 'sheriff', name: '보안관', nameEn: 'Sheriff', palette: ['#F2E2C9', '#8FB8DE', '#FFF5BA', '#FFAAA5', '#FF9EAF'], unlockTrophies: 40 },
      { id: 'berry', name: '딸기 우유', nameEn: 'Berry Milk', palette: ['#FFC8DD', '#FF9EBB', '#FFFFFF', '#C3B1E1', '#A8E6CF'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'popo', displayName: '포포', displayNameEn: 'Popo', concept: '라벤더 펭귄, 공사장 헬멧, 볼 터치',
    role: '투척형 컨트롤', roleEn: 'Thrower', hp: 2800, moveSpeed: SPEED.slow, speedLabel: '느림',
    hitboxRadius: 0.55, weaponId: 'grenade', superId: 'megaBomb', gadgetId: 'iceSlide',
    colorPalette: ['#C3B1E1', '#FFE27A', '#FFFFFF', '#FFB38A'],
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#C3B1E1', '#FFE27A', '#FFFFFF', '#FFB38A'], unlockTrophies: 0 },
      { id: 'mint', name: '민트초코', nameEn: 'Mint Choco', palette: ['#9FDDC8', '#B08A72', '#FFFFFF', '#FFB38A'], unlockTrophies: 40 },
      { id: 'sunset', name: '노을', nameEn: 'Sunset', palette: ['#FFB7A0', '#C3B1E1', '#FFF5E8', '#FFE27A'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'luna', displayName: '루나', displayNameEn: 'Luna', concept: '하늘색 여우, 별 모양 망토, 긴 귀',
    role: '원거리 저격수', roleEn: 'Sniper', hp: 2400, moveSpeed: SPEED.normal, speedLabel: '보통',
    hitboxRadius: 0.52, weaponId: 'crossbow', superId: 'meteorArrow', gadgetId: 'starDash',
    colorPalette: ['#B5DEFF', '#FFF5BA', '#FFFFFF', '#C3B1E1'],
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#B5DEFF', '#FFF5BA', '#FFFFFF', '#C3B1E1'], unlockTrophies: 0 },
      { id: 'flame', name: '노을 여우', nameEn: 'Ember', palette: ['#FFC09F', '#FFE27A', '#FFFFFF', '#FF9EBB'], unlockTrophies: 40 },
      { id: 'aurora', name: '오로라', nameEn: 'Aurora', palette: ['#C9F2E3', '#C3B1E1', '#FFFFFF', '#B5DEFF'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'kiki', displayName: '키키', displayNameEn: 'Kiki', concept: '레몬색 원숭이, 탐험가 모자, 꼬리 리본',
    role: '관통·견제', roleEn: 'Piercer', hp: 3000, moveSpeed: SPEED.fast, speedLabel: '빠름',
    hitboxRadius: 0.52, weaponId: 'boomerang', superId: 'tornado', gadgetId: 'bananaSnack',
    colorPalette: ['#FFF5BA', '#F2D7A6', '#FFAAA5', '#A8E6CF'],
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#FFF5BA', '#F2D7A6', '#FFAAA5', '#A8E6CF'], unlockTrophies: 0 },
      { id: 'peach', name: '복숭아', nameEn: 'Peachy', palette: ['#FFD3B6', '#FFF1E0', '#C3B1E1', '#FFC8DD'], unlockTrophies: 40 },
      { id: 'jungle', name: '정글', nameEn: 'Jungle', palette: ['#CDEBB0', '#F6EEDF', '#FFB38A', '#FFE27A'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'mongle', displayName: '몽글', displayNameEn: 'Mongle', concept: '핑크 문어, 잠수 헬멧, 버블 탱크',
    role: '서포트·제어', roleEn: 'Controller', hp: 3400, moveSpeed: SPEED.normal, speedLabel: '보통',
    hitboxRadius: 0.58, weaponId: 'bubble', superId: 'bubblePrison', gadgetId: 'inkCloud',
    colorPalette: ['#FFC8DD', '#F5D27A', '#B5DEFF', '#FFFFFF'],
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#FFC8DD', '#F5D27A', '#B5DEFF', '#FFFFFF'], unlockTrophies: 0 },
      { id: 'grape', name: '포도', nameEn: 'Grape', palette: ['#C3B1E1', '#F5D27A', '#A8E6CF', '#FFFFFF'], unlockTrophies: 40 },
      { id: 'coral', name: '산호초', nameEn: 'Coral Reef', palette: ['#FFAAA5', '#B5DEFF', '#FFF5BA', '#FFFFFF'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'leo', displayName: '레오', displayNameEn: 'Leo', concept: '황금빛 아기 사자, 풍성한 갈기와 작은 왕관',
    role: '탱커·돌격', roleEn: 'Tank', hp: 3900, moveSpeed: 4.7, speedLabel: '보통',
    hitboxRadius: 0.62, weaponId: 'roarWave', superId: 'kingsRoar', gadgetId: 'maneGuard',
    colorPalette: ['#FFD98A', '#F2A65A', '#FFF5E1', '#FFE27A'],
    memberOnly: true,
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#FFD98A', '#F2A65A', '#FFF5E1', '#FFE27A'], unlockTrophies: 0 },
      { id: 'snow', name: '눈사자', nameEn: 'Snow Lion', palette: ['#F4F1FF', '#B9A6DE', '#FFFFFF', '#8EC5F0'], unlockTrophies: 40 },
      { id: 'candy', name: '솜사탕 사자', nameEn: 'Cotton Candy', palette: ['#FFD3E6', '#FF9EBB', '#FFF5FA', '#B5DEFF'], unlockTrophies: 120 },
    ],
  },
  {
    id: 'hoya', displayName: '호야', displayNameEn: 'Hoya', concept: '주황 아기 호랑이, 이마의 王 무늬와 빨간 머리띠',
    role: '암살자·기습', roleEn: 'Assassin', hp: 2900, moveSpeed: 5.8, speedLabel: '빠름',
    hitboxRadius: 0.54, weaponId: 'clawSwipe', superId: 'tigerPounce', gadgetId: 'stripeDash',
    colorPalette: ['#FFB870', '#5B4A7A', '#FFFFFF', '#FF7A8A'],
    memberOnly: true,
    skins: [
      { id: 'default', name: '기본', nameEn: 'Classic', palette: ['#FFB870', '#5B4A7A', '#FFFFFF', '#FF7A8A'], unlockTrophies: 0 },
      { id: 'white', name: '백호', nameEn: 'White Tiger', palette: ['#F6F3FF', '#6E6290', '#FFFFFF', '#8EC5F0'], unlockTrophies: 40 },
      { id: 'mint', name: '민트 호랑이', nameEn: 'Mint Tiger', palette: ['#A8E6CF', '#4E7A6C', '#FFFFFF', '#FFC8DD'], unlockTrophies: 120 },
    ],
  },
];

export const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<CharacterId, CharacterDef>;

export function weaponOf(c: CharacterDef): WeaponDef { return WEAPONS[c.weaponId]; }
export function superOf(c: CharacterDef): SuperDef { return SUPERS[c.superId]; }
export function gadgetOf(c: CharacterDef): GadgetDef { return GADGETS[c.gadgetId]; }
