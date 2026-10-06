/**
 * Cosmetic catalogue (shop). Shared by client (rendering, UI) and server (prices, slot validation).
 * 8 kinds × 10 items = 80. One item per slot; glasses and sunglasses share the eyewear slot.
 */
export type ItemKind = 'glasses' | 'sunglasses' | 'hat' | 'top' | 'pants' | 'shoes' | 'necklace' | 'bracelet';
export type ItemSlot = 'eyewear' | 'hat' | 'top' | 'pants' | 'shoes' | 'necklace' | 'bracelet';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface ItemDef {
  id: string;
  kind: ItemKind;
  slot: ItemSlot;
  name: string;
  nameEn: string;
  price: number;
  rarity: Rarity;
  /** geometry recipe key, interpreted by the client's outfit builder */
  style: string;
  /** [main, accent, detail] */
  colors: [string, string, string];
}

export const SLOT_OF: Record<ItemKind, ItemSlot> = {
  glasses: 'eyewear', sunglasses: 'eyewear', hat: 'hat', top: 'top', pants: 'pants', shoes: 'shoes', necklace: 'necklace', bracelet: 'bracelet',
};
export const SLOTS: ItemSlot[] = ['hat', 'eyewear', 'top', 'pants', 'shoes', 'necklace', 'bracelet'];
export const KIND_LABEL: Record<ItemKind, { ko: string; en: string; emoji: string }> = {
  glasses: { ko: '안경', en: 'Glasses', emoji: '👓' },
  sunglasses: { ko: '선글라스', en: 'Sunglasses', emoji: '🕶️' },
  hat: { ko: '모자', en: 'Hats', emoji: '🎩' },
  top: { ko: '윗옷', en: 'Tops', emoji: '👕' },
  pants: { ko: '바지', en: 'Pants', emoji: '👖' },
  shoes: { ko: '신발', en: 'Shoes', emoji: '👟' },
  necklace: { ko: '목걸이', en: 'Necklaces', emoji: '📿' },
  bracelet: { ko: '팔찌', en: 'Bracelets', emoji: '💫' },
};
export const SLOT_LABEL: Record<ItemSlot, { ko: string; en: string }> = {
  eyewear: { ko: '안경', en: 'Eyewear' }, hat: { ko: '모자', en: 'Hat' }, top: { ko: '윗옷', en: 'Top' }, pants: { ko: '바지', en: 'Pants' },
  shoes: { ko: '신발', en: 'Shoes' }, necklace: { ko: '목걸이', en: 'Necklace' }, bracelet: { ko: '팔찌', en: 'Bracelet' },
};

const GOLD = '#F2C94C', GOLD2 = '#FFE58A', SILVER = '#D9DEE8', BLACK = '#3A3348', WHITE = '#FFFFFF';
const rarityOf = (p: number): Rarity => (p >= 60000 ? 'legendary' : p >= 25000 ? 'epic' : p >= 8000 ? 'rare' : 'common');

type Row = [string, string, string, number, string, string, string, string]; // id-suffix, ko, en, price, style, c1, c2, c3
const make = (kind: ItemKind, rows: Row[]): ItemDef[] => rows.map(([sfx, name, nameEn, price, style, a, b, c]) => ({
  id: `${kind}_${sfx}`, kind, slot: SLOT_OF[kind], name, nameEn, price, rarity: rarityOf(price), style, colors: [a, b, c],
}));

export const ITEMS: ItemDef[] = [
  ...make('glasses', [
    ['round', '동글 안경', 'Round Specs', 1000, 'round', '#6B5B7B', '#FFFFFF', '#6B5B7B'],
    ['square', '네모 안경', 'Square Specs', 1500, 'square', '#4A3B5C', '#FFFFFF', '#4A3B5C'],
    ['pink', '딸기 안경', 'Berry Specs', 2500, 'round', '#FF8FB1', '#FFFFFF', '#FF8FB1'],
    ['nerd', '공부왕 뿔테', 'Bookworm Frames', 3500, 'thick', '#2F2A3A', '#FFFFFF', '#2F2A3A'],
    ['hex', '육각 안경', 'Hexa Specs', 6000, 'hex', '#7FC8B0', '#FFFFFF', '#7FC8B0'],
    ['heart', '하트 안경', 'Heart Specs', 9000, 'heart', '#FF6F91', '#FFFFFF', '#FF6F91'],
    ['star', '별빛 안경', 'Starry Specs', 14000, 'star', '#B59CFF', '#FFFFFF', '#B59CFF'],
    ['rainbow', '무지개 안경', 'Rainbow Specs', 22000, 'rainbow', '#FF9EBB', '#B5DEFF', '#FFF5BA'],
    ['monocle', '신사 모노클', 'Gentle Monocle', 38000, 'monocle', GOLD, '#FFFFFF', GOLD],
    ['gold', '황금 원형 안경', 'Golden Round Specs', 70000, 'round', GOLD, '#FFFFFF', GOLD2],
  ]),
  ...make('sunglasses', [
    ['black', '기본 선글라스', 'Classic Shades', 1200, 'wayfarer', BLACK, '#2B2438', '#5C5470'],
    ['retro', '레트로 동글이', 'Retro Rounds', 2200, 'round', '#8A5A3B', '#3B2A20', '#C79A7A'],
    ['aviator', '파일럿 선글라스', 'Aviators', 4500, 'aviator', SILVER, '#4E6C8C', SILVER],
    ['heartpink', '핑크 하트 선글라스', 'Pink Heart Shades', 7000, 'heart', '#FF6F91', '#C2185B', '#FF6F91'],
    ['sport', '스포츠 고글', 'Sport Visor', 11000, 'visor', '#2F2A3A', '#5FC3FF', '#FF8A3D'],
    ['star', '스타 선글라스', 'Star Shades', 16000, 'star', '#FFD84D', '#7A4FD8', '#FFD84D'],
    ['shutter', '셔터 셰이드', 'Shutter Shades', 24000, 'shutter', '#FFFFFF', '#FF6F91', '#FFFFFF'],
    ['neon', '네온 선글라스', 'Neon Shades', 32000, 'wayfarer', '#39FFB0', '#1E1A2E', '#FF4FD8'],
    ['gradient', '노을 그라데이션', 'Sunset Gradient', 48000, 'aviator', GOLD, '#FF8A65', GOLD2],
    ['gold', '황금 파일럿', 'Golden Aviators', 100000, 'aviator', GOLD, '#2B2438', GOLD2],
  ]),
  ...make('hat', [
    ['cap', '야구 모자', 'Ball Cap', 1000, 'cap', '#5FA8E8', WHITE, '#3F7FC0'],
    ['beanie', '털모자', 'Pom Beanie', 2000, 'beanie', '#FF9EAF', WHITE, '#E86F88'],
    ['bucket', '벙거지', 'Bucket Hat', 3000, 'bucket', '#C9E4A8', '#8DBB6E', '#C9E4A8'],
    ['beret', '화가 베레모', 'Artist Beret', 4500, 'beret', '#E25D6E', '#C2405A', '#E25D6E'],
    ['party', '파티 고깔', 'Party Cone', 6500, 'party', '#B5DEFF', '#FFE27A', '#FF9EBB'],
    ['straw', '밀짚모자', 'Straw Hat', 9000, 'straw', '#F2D59A', '#E25D6E', '#D9B26A'],
    ['bunny', '토끼 머리띠', 'Bunny Band', 15000, 'bunny', WHITE, '#FFC8DD', WHITE],
    ['tophat', '마술사 실크햇', 'Magician Top Hat', 28000, 'tophat', BLACK, '#E25D6E', BLACK],
    ['flower', '꽃 화관', 'Flower Crown', 45000, 'flowers', '#FFC8DD', '#FFF5BA', '#A8E6CF'],
    ['crown', '황금 왕관', 'Golden Crown', 100000, 'crown', GOLD, '#E25D6E', '#5FC3FF'],
  ]),
  ...make('top', [
    ['tee', '기본 티셔츠', 'Basic Tee', 1000, 'tee', WHITE, '#E8E2F4', WHITE],
    ['stripe', '줄무늬 티', 'Stripe Tee', 2500, 'stripe', WHITE, '#5FA8E8', WHITE],
    ['hoodie', '말랑 후드티', 'Comfy Hoodie', 5000, 'hoodie', '#C3B1E1', '#9A85C9', WHITE],
    ['sweater', '니트 스웨터', 'Knit Sweater', 7000, 'knit', '#FFB38A', '#F08A5D', '#FFE0CC'],
    ['sailor', '세일러 셔츠', 'Sailor Shirt', 9500, 'sailor', WHITE, '#3F5FA8', '#E25D6E'],
    ['raincoat', '노랑 우비', 'Yellow Raincoat', 13000, 'raincoat', '#FFD84D', '#E8B820', WHITE],
    ['jersey', '축구 유니폼', 'Football Jersey', 18000, 'jersey', '#E25D6E', WHITE, '#FFE27A'],
    ['tux', '턱시도', 'Tuxedo', 35000, 'tux', BLACK, WHITE, '#E25D6E'],
    ['idol', '아이돌 무대의상', 'Idol Stage Jacket', 55000, 'jacket', '#FF6FB5', '#FFE58A', '#B59CFF'],
    ['gold', '황금 재킷', 'Golden Jacket', 90000, 'jacket', GOLD, GOLD2, '#FFFFFF'],
  ]),
  ...make('pants', [
    ['shorts', '반바지', 'Shorts', 1000, 'shorts', '#7FA8D8', '#5F86B8', WHITE],
    ['jeans', '청바지', 'Jeans', 2500, 'long', '#4F79B8', '#3A5E96', '#FFD84D'],
    ['jogger', '조거 팬츠', 'Joggers', 4000, 'long', '#8E8AA6', WHITE, '#6E6A86'],
    ['cargo', '카고 반바지', 'Cargo Shorts', 6000, 'cargo', '#A8B07A', '#7E8656', '#A8B07A'],
    ['check', '체크 바지', 'Check Pants', 8500, 'check', '#E25D6E', '#FFF5E8', '#3A3348'],
    ['tutu', '발레 튜튜', 'Ballet Tutu', 12000, 'tutu', '#FFC8DD', WHITE, '#FF9EBB'],
    ['overall', '멜빵 반바지', 'Overall Shorts', 17000, 'overall', '#5FA8E8', '#FFD84D', '#3F7FC0'],
    ['rainbow', '무지개 레깅스', 'Rainbow Leggings', 26000, 'rainbow', '#FF9EBB', '#B5DEFF', '#FFF5BA'],
    ['tuxpants', '정장 바지', 'Suit Trousers', 40000, 'long', BLACK, '#5C5470', BLACK],
    ['gold', '황금 바지', 'Golden Pants', 80000, 'long', GOLD, GOLD2, '#FFFFFF'],
  ]),
  ...make('shoes', [
    ['sneaker', '운동화', 'Sneakers', 1000, 'sneaker', WHITE, '#5FA8E8', '#E8E2F4'],
    ['sandal', '샌들', 'Sandals', 1500, 'sandal', '#C79A7A', '#8A5A3B', '#C79A7A'],
    ['slipper', '토끼 슬리퍼', 'Bunny Slippers', 3500, 'bunny', WHITE, '#FFC8DD', WHITE],
    ['rain', '장화', 'Rain Boots', 5000, 'boot', '#FFD84D', '#E8B820', '#FFD84D'],
    ['hightop', '하이탑', 'High-tops', 7500, 'hightop', '#E25D6E', WHITE, '#3A3348'],
    ['loafer', '로퍼', 'Loafers', 11000, 'loafer', '#5A3B2E', GOLD, '#5A3B2E'],
    ['boots', '탐험가 부츠', 'Explorer Boots', 16000, 'boot', '#9A6B4E', '#5A3B2E', '#E8C99A'],
    ['skate', '롤러스케이트', 'Roller Skates', 30000, 'skate', '#B5DEFF', '#FF9EBB', '#FFF5BA'],
    ['rocket', '로켓 부츠', 'Rocket Boots', 60000, 'rocket', SILVER, '#FF8A3D', '#5FC3FF'],
    ['gold', '황금 스니커즈', 'Golden Sneakers', 100000, 'sneaker', GOLD, GOLD2, '#FFFFFF'],
  ]),
  ...make('necklace', [
    ['bead', '구슬 목걸이', 'Bead Necklace', 1000, 'beads', '#B5DEFF', '#FFC8DD', '#FFF5BA'],
    ['bell', '방울 목걸이', 'Bell Collar', 2000, 'bell', '#E25D6E', GOLD, '#E25D6E'],
    ['scarf', '목도리', 'Cozy Scarf', 4000, 'scarf', '#E25D6E', '#FFF5E8', '#E25D6E'],
    ['shell', '조개 목걸이', 'Shell Necklace', 6000, 'shell', '#F2D59A', '#FFC8DD', WHITE],
    ['lei', '꽃 레이', 'Flower Lei', 9000, 'lei', '#FF9EBB', '#FFE27A', '#A8E6CF'],
    ['heart', '하트 펜던트', 'Heart Pendant', 14000, 'pendant-heart', SILVER, '#FF6F91', SILVER],
    ['star', '별 펜던트', 'Star Pendant', 20000, 'pendant-star', SILVER, '#FFD84D', SILVER],
    ['pearl', '진주 목걸이', 'Pearl Necklace', 35000, 'pearls', '#FFF8F0', '#F4E6FF', '#FFF8F0'],
    ['medal', '금메달', 'Gold Medal', 60000, 'medal', GOLD, '#5FA8E8', '#E25D6E'],
    ['diamond', '다이아 목걸이', 'Diamond Necklace', 100000, 'pendant-gem', GOLD, '#CFF4FF', GOLD2],
  ]),
  ...make('bracelet', [
    ['bead', '구슬 팔찌', 'Bead Bracelet', 1000, 'beads', '#FFC8DD', '#B5DEFF', '#FFF5BA'],
    ['band', '땀밴드', 'Sweatband', 1500, 'band', '#5FA8E8', WHITE, '#5FA8E8'],
    ['friend', '우정 팔찌', 'Friendship Band', 3000, 'braid', '#FF9EBB', '#A8E6CF', '#FFE27A'],
    ['silver', '은 뱅글', 'Silver Bangle', 5500, 'bangle', SILVER, SILVER, '#FFFFFF'],
    ['watch', '손목시계', 'Wrist Watch', 9000, 'watch', '#5A3B2E', '#FFFFFF', GOLD],
    ['flower', '꽃 팔찌', 'Flower Bracelet', 13000, 'flowers', '#FFC8DD', '#FFF5BA', '#A8E6CF'],
    ['charm', '참 팔찌', 'Charm Bracelet', 19000, 'charm', SILVER, '#FFD84D', '#FF6F91'],
    ['rainbow', '무지개 팔찌', 'Rainbow Bracelet', 27000, 'rainbow', '#FF9EBB', '#B5DEFF', '#FFF5BA'],
    ['gold', '황금 뱅글', 'Golden Bangle', 65000, 'bangle', GOLD, GOLD2, '#FFFFFF'],
    ['diamond', '다이아 팔찌', 'Diamond Bracelet', 100000, 'gems', GOLD, '#CFF4FF', GOLD2],
  ]),
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const ITEM_KINDS: ItemKind[] = ['hat', 'glasses', 'sunglasses', 'top', 'pants', 'shoes', 'necklace', 'bracelet'];

/** Equipment for one character: slot → item id. */
export type Equipment = Partial<Record<ItemSlot, string>>;

/** Gold reward rule: places 1–3 earn their own score in gold. */
export const goldReward = (place: number, score: number) => (place >= 1 && place <= 3 ? Math.max(0, Math.round(score)) : 0);
