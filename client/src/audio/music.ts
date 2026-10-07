/**
 * Procedural stage songs: one cute 8-bar loop per map, plus the lobby lullaby.
 * Each song is a step function called on every 16th note (128 steps = 8 bars); it plays
 * instruments from the Kit, which the AudioEngine synthesizes with Web Audio.
 * Melodies are written on an 8th-note grid (8 per bar, -1 = rest) as MIDI notes.
 */
export interface Kit {
  kick(t: number, v?: number): void;
  clap(t: number, v?: number): void;
  hat(t: number, v?: number, dur?: number): void;
  shaker(t: number, v?: number): void;
  rim(t: number, v?: number): void;
  tom(t: number, freq: number, v?: number): void;
  tek(t: number, v?: number): void;
  jingle(t: number, v?: number): void;
  tone(type: OscillatorType, midi: number, t: number, dur: number, v: number, attack?: number, filter?: number, wet?: boolean): void;
  pluck(midi: number, t: number, v: number, opts?: { type?: OscillatorType; dur?: number; filter?: number; bend?: number; wet?: boolean }): void;
  bell(midi: number, t: number, dur: number, v: number): void;
  marimba(midi: number, t: number, v: number): void;
  steel(midi: number, t: number, v: number): void;
  blip(t: number, f0: number, f1: number, dur: number, v: number): void;
}

export interface Song {
  bpm: number;
  /** delay of every off-beat 16th, as a fraction of a 16th (0 = straight) */
  swing?: number;
  step(k: Kit, step: number, t: number, s16: number): void;
}

/** Plays an 8-bar melody written on the 8th-note grid. */
const at8 = (mel: number[], bar: number, s: number) => (s % 2 === 0 ? mel[bar * 8 + s / 2] ?? -1 : -1);

// ─────────────────────────────────────────── lobby: soft lullaby (unchanged character)
const lobby: Song = {
  bpm: 96,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [48, 43, 45, 41, 48, 43, 45, 41];
    const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
    const root = roots[bar], chord = chords[bar % 4];
    if (s % 4 === 0) k.tone('triangle', root, t, 0.4, 0.22);
    const arp = [0, 1, 2, 1];
    if (s % 2 === 0) k.tone('sine', chord[arp[(s / 2) % 4]] + 12, t, 0.3, 0.07);
    if (s === 0) chord.forEach((n) => k.tone('triangle', n, t, 1.2, 0.03, 0.15));
    if (s % 8 === 6 && bar % 2) k.bell(chord[2] + 24, t, 0.3, 0.035);
  },
};

// ─────────────────────────────────────────── 파스텔 초원: bouncy picnic pop (C major)
const meadowLead = [
  72, -1, 76, 79, 81, 79, 76, -1,
  76, -1, 72, 76, 74, 72, 69, -1,
  72, 74, 77, -1, 81, -1, 79, 77,
  79, -1, 74, -1, 71, 74, 79, -1,
  84, -1, 79, 76, 79, -1, 84, 86,
  83, -1, 79, -1, 76, 79, 83, -1,
  81, 79, 77, 76, 77, -1, 81, -1,
  79, -1, -1, 74, 76, -1, 79, -1,
];
const meadow: Song = {
  bpm: 128,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [48, 45, 41, 43, 48, 40, 41, 43];
    const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67], [52, 55, 59], [53, 57, 60], [55, 59, 62]];
    const root = roots[bar], chord = chords[bar];
    if (s === 0 || s === 8 || (bar % 2 && s === 10)) k.kick(t, 0.5);
    if (s === 4 || s === 12) k.clap(t, 0.2);
    if (s % 4 === 2) k.hat(t, 0.07);
    k.shaker(t, s % 2 ? 0.025 : 0.04);
    if (s % 2 === 0) k.pluck(root + (s % 4 === 2 ? 12 : 0), t, 0.26, { dur: 0.14, filter: 1400 });
    const n = at8(meadowLead, bar, s);
    if (n > 0) k.pluck(n, t, 0.05, { type: 'square', dur: 0.14, filter: 3200, wet: true });
    if (s === 6 || s === 14) k.bell(chord[(s / 8) | 0] + 24, t, 0.25, 0.03);
    if (s === 0) chord.forEach((m) => k.tone('triangle', m, t, 1.6, 0.018, 0.08, 2200));
    if (bar === 7 && s >= 12) k.tom(t, 160 + (s - 12) * 40, 0.18);
  },
};

// ─────────────────────────────────────────── 정글 유적: playful explorer march (D dorian, marimba & bongos)
const ruinsLead = [
  74, -1, 77, 79, 81, -1, 79, 77,
  76, -1, 72, -1, 74, 76, 79, -1,
  81, -1, 84, 81, 79, -1, 77, 74,
  76, -1, -1, 72, 69, -1, 72, -1,
  74, 77, 82, -1, 81, -1, 77, -1,
  79, -1, 76, 79, 84, -1, 79, -1,
  81, 79, 77, 74, 77, -1, 79, 81,
  74, -1, -1, -1, 69, -1, 74, -1,
];
const jungleRuins: Song = {
  bpm: 112,
  step(k, step, t, s16) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [38, 36, 38, 33, 34, 36, 38, 38];
    const chords = [[62, 65, 69], [60, 64, 67], [62, 65, 69], [57, 60, 64], [58, 62, 65], [60, 64, 67], [62, 65, 69], [62, 65, 69]];
    const root = roots[bar], chord = chords[bar];
    // log drums & bongos
    if (s === 0 || s === 7 || s === 8) k.tom(t, 120, 0.42);
    if (s % 4 === 2) k.tom(t, s % 8 === 2 ? 420 : 340, 0.16);
    if (s === 13 && bar % 2) k.tom(t, 300, 0.12);
    if (s === 12 && bar % 2 === 1) k.clap(t, 0.14);
    k.shaker(t, s % 4 === 0 ? 0.045 : 0.022);
    // walking marimba bass
    if (s === 0) k.marimba(root + 12, t, 0.3);
    if (s === 6) k.marimba(root + 19, t, 0.2);
    if (s === 8) k.marimba(root + 24, t, 0.22);
    if (s === 12) k.marimba(root + 12, t, 0.2);
    // marimba lead with a soft echo a dotted-8th later
    const n = at8(ruinsLead, bar, s);
    if (n > 0) { k.marimba(n, t, 0.2); k.marimba(n + 12, t + s16 * 3, 0.05); }
    if (s === 0) chord.forEach((m) => k.tone('triangle', m, t, 2.4, 0.016, 0.3, 900, true));
  },
};

// ─────────────────────────────────────────── 정글 라군: lazy tropical island (F major, steel pan & ukulele, swung)
const lagoonLead = [
  77, -1, 81, 84, -1, 81, 77, -1,
  74, -1, 77, 81, -1, 77, 74, 72,
  70, -1, 74, 77, 82, -1, 81, -1,
  79, -1, 76, -1, 72, -1, 74, 76,
  77, -1, -1, 84, 81, -1, 77, 81,
  84, -1, 81, -1, 76, -1, 72, 76,
  77, 74, 70, 74, 77, -1, 82, -1,
  79, -1, -1, 76, 79, -1, -1, -1,
];
const jungleLagoon: Song = {
  bpm: 104,
  swing: 0.28,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [41, 38, 34, 36, 41, 33, 34, 36];
    const chords = [[65, 69, 72], [62, 65, 69], [58, 62, 65], [60, 64, 67], [65, 69, 72], [57, 60, 64], [58, 62, 65], [60, 64, 67]];
    const root = roots[bar], chord = chords[bar];
    if (s === 0 || s === 8) k.kick(t, 0.38);
    if (s === 3 || s === 6 || s === 11 || s === 14) k.rim(t, 0.12);
    if (s % 2 === 0) k.shaker(t, 0.035);
    // round sine bass
    const bass: Record<number, number> = { 0: 0, 3: 0, 8: 7, 11: 12, 14: 7 };
    if (bass[s] !== undefined) k.tone('sine', root + bass[s], t, 0.22, 0.32, 0.005);
    // ukulele strums on the off-beats
    if (s === 4 || s === 12 || (s === 10 && bar % 2)) chord.forEach((m, i) => k.pluck(m, t + i * 0.014, 0.05, { dur: 0.22, filter: 2600 }));
    const n = at8(lagoonLead, bar, s);
    if (n > 0) k.steel(n, t, 0.12);
    // bubbles
    if (s === 15 && bar % 2 === 0) k.blip(t, 600, 1500, 0.09, 0.05);
    if (s === 7 && bar === 5) k.blip(t, 800, 2000, 0.07, 0.04);
  },
};

// ─────────────────────────────────────────── 사막 오아시스: bouncy caravan (A phrygian dominant, oud & doumbek)
const desertLead = [
  69, 70, 73, -1, 74, -1, 73, 70,
  69, -1, -1, 64, 69, -1, 70, -1,
  67, -1, 70, 74, -1, 70, 67, -1,
  69, 70, 69, -1, 73, -1, 69, -1,
  74, -1, 77, -1, 76, 74, 73, -1,
  69, -1, 73, 76, 81, -1, -1, -1,
  77, 76, 74, -1, 70, -1, 74, 77,
  76, -1, 73, 70, 69, -1, -1, -1,
];
const desert: Song = {
  bpm: 120,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [45, 45, 43, 45, 38, 45, 46, 45];
    const root = roots[bar];
    // maqsum: DUM tek . tek DUM . tek .
    if (s === 0 || s === 8) k.tom(t, 110, 0.5);
    if (s === 2 || s === 6 || s === 12) k.tek(t, 0.16);
    if (s === 14 && bar % 2) k.tek(t, 0.1);
    if (s % 4 === 2) k.jingle(t, 0.05);
    // drone (open fifth) + plucked bass
    if (s === 0) { k.tone('sawtooth', 45, t, 1.9, 0.02, 0.25, 500); k.tone('sawtooth', 52, t, 1.9, 0.014, 0.25, 600); }
    if (s === 0 || s === 8) k.pluck(root, t, 0.3, { dur: 0.22, filter: 900 });
    if (s === 10) k.pluck(root + 12, t, 0.16, { dur: 0.14, filter: 1200 });
    // oud-ish lead: bright pluck sliding up into each note
    const n = at8(desertLead, bar, s);
    if (n > 0) k.pluck(n, t, 0.11, { type: 'sawtooth', dur: 0.2, filter: 2400, bend: 0.94, wet: true });
    // finger cymbals
    if (s === 0 && (bar === 0 || bar === 4)) { k.bell(93, t, 0.6, 0.03); k.bell(98, t, 0.5, 0.015); }
  },
};

// ─────────────────────────────────────────── 빙하 지대: twinkly music box (G lydian, celesta & sleigh bells)
const glacierLead = [
  79, -1, 78, 79, 83, -1, 79, -1,
  76, -1, 74, 76, 79, -1, -1, -1,
  72, 76, 79, -1, 78, -1, 76, -1,
  74, -1, 78, 81, 78, -1, 74, -1,
  83, -1, 81, 79, 81, -1, 83, 86,
  83, -1, -1, 78, 74, -1, 78, -1,
  76, 79, 84, -1, 83, 79, 76, -1,
  78, -1, -1, 74, 81, -1, -1, -1,
];
const glacier: Song = {
  bpm: 100,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [43, 40, 36, 38, 43, 35, 36, 38];
    const chords = [[67, 71, 74], [64, 67, 71], [60, 64, 67], [62, 66, 69], [67, 71, 74], [59, 62, 66], [60, 64, 67], [62, 66, 69]];
    const root = roots[bar], chord = chords[bar];
    if (s === 0 || s === 10) k.kick(t, 0.3);
    if (s === 8) { k.clap(t, 0.08); k.hat(t, 0.06, 0.25); }
    if (s % 2 === 0) k.jingle(t, s % 4 === 0 ? 0.035 : 0.02);
    // soft sine bass + slow pad
    if (s === 0 || s === 6 || s === 12) k.tone('sine', root + (s === 6 ? 7 : 0), t, 0.5, 0.26, 0.01);
    if (s === 0) chord.forEach((m) => k.tone('sine', m, t, 2.6, 0.03, 0.5, undefined, true));
    // music-box arpeggio up high + celesta lead
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    if (s % 2 === 1) k.bell(chord[arp[((s - 1) / 2) % 8]] + 12, t, 0.35, 0.02);
    const n = at8(glacierLead, bar, s);
    if (n > 0) k.bell(n, t, 0.7, 0.07);
    if (s === 14 && bar % 4 === 3) k.blip(t, 2400, 3600, 0.15, 0.02);
  },
};

// ─────────────────────────────────────────── 사탕 마을: sugar-rush toy piano (B♭ major, xylophone & claps)
const candyLead = [
  82, 81, 82, 86, 89, -1, 86, -1,
  84, -1, 81, 84, 86, -1, -1, -1,
  79, 81, 82, -1, 86, 84, 82, -1,
  81, -1, 77, -1, 81, -1, 84, -1,
  82, 81, 82, 86, 89, -1, 94, -1,
  91, -1, 89, 86, 87, -1, 84, -1,
  86, 84, 82, 79, 81, -1, 82, 84,
  82, -1, -1, 77, 82, -1, -1, -1,
];
const candyTown: Song = {
  bpm: 138,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [46, 43, 39, 41, 46, 43, 39, 41];
    const chords = [[70, 74, 77], [67, 70, 74], [63, 67, 70], [65, 69, 72], [70, 74, 77], [67, 70, 74], [63, 67, 70], [65, 69, 72]];
    const root = roots[bar], chord = chords[bar];
    if (s === 0 || s === 6 || s === 8 || s === 14) k.kick(t, s % 8 ? 0.3 : 0.45);
    if (s === 4 || s === 12) { k.clap(t, 0.18); k.rim(t + 0.01, 0.06); }
    if (s % 2 === 1) k.hat(t, 0.05);
    // bouncy octave bass
    if (s % 4 === 0) k.pluck(root, t, 0.28, { dur: 0.12, filter: 1100 });
    if (s % 4 === 2) k.pluck(root + 12, t, 0.18, { dur: 0.09, filter: 1500 });
    // toy-piano chords on the off-beats
    if (s % 4 === 2) chord.forEach((m) => k.tone('triangle', m, t, 0.12, 0.022, 0.002, 3000));
    // xylophone lead
    const n = at8(candyLead, bar, s);
    if (n > 0) k.marimba(n, t, 0.17);
    // sugar sparkles
    if (s === 15) k.blip(t, 1800, 3200, 0.06, 0.03);
    if (bar % 4 === 3 && s >= 12) k.bell(chord[(s - 12) % 3] + 24, t, 0.2, 0.025);
  },
};

// ─────────────────────────────────────────── 별빛 정원: moonlit lullaby (E♭ major, harp arps & celesta, swung)
const starLead = [
  75, -1, -1, 77, 79, -1, 82, -1,
  80, -1, 79, -1, 77, -1, -1, -1,
  75, -1, 74, 75, 79, -1, 77, -1,
  74, -1, -1, -1, 70, -1, -1, -1,
  75, -1, -1, 77, 79, -1, 84, -1,
  82, -1, 80, -1, 79, -1, 77, -1,
  80, 79, 77, -1, 75, -1, 74, -1,
  75, -1, -1, -1, -1, -1, -1, -1,
];
const starlight: Song = {
  bpm: 84,
  swing: 0.2,
  step(k, step, t) {
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [39, 36, 44, 46, 39, 36, 44, 46];
    const chords = [[63, 67, 70, 74], [60, 63, 67, 70], [56, 60, 63, 67], [58, 62, 65, 68], [63, 67, 70, 74], [60, 63, 67, 70], [56, 60, 63, 67], [58, 62, 65, 70]];
    const root = roots[bar], chord = chords[bar];
    // soft heartbeat kick + brushed hats
    if (s === 0 || s === 10) k.kick(t, 0.22);
    if (s === 8) k.hat(t, 0.05, 0.3);
    if (s % 4 === 2) k.shaker(t, 0.018);
    // deep sine bass and a slow glassy pad
    if (s === 0 || s === 8) k.tone('sine', root - (s === 8 ? 5 : 0), t, 1.0, 0.26, 0.02);
    if (s === 0) chord.forEach((m) => k.tone('sine', m, t, 3.2, 0.024, 0.8, undefined, true));
    // rolling harp arpeggio
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    if (s % 2 === 0) k.pluck(chord[arp[(s / 2) % 8]] + 12, t, 0.06, { type: 'triangle', dur: 0.5, filter: 3500, wet: true });
    // celesta melody
    const n = at8(starLead, bar, s);
    if (n > 0) k.bell(n, t, 1.0, 0.075);
    // twinkles
    if (s === 13 && bar % 2) k.bell(chord[3] + 24, t, 0.4, 0.02);
    if (s === 6 && bar === 7) k.blip(t, 2000, 4000, 0.3, 0.02);
  },
};

export const SONGS: Record<string, Song> = {
  candy_town: candyTown,
  starlight,
  lobby,
  battle: meadow,
  meadow,
  jungle_ruins: jungleRuins,
  jungle_lagoon: jungleLagoon,
  desert,
  glacier,
};
