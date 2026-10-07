import { World, buildMap, CHARACTERS, MAPS, type PlayerSlot } from '../src';
/** Aggregate bot playtest across every map: win rate per character, match length per map. */
const N = Number(process.argv[2] ?? 60);
const wins: Record<string, number> = {}, picks: Record<string, number> = {};
const lens: string[] = [];
for (const map of MAPS) {
  let len = 0;
  for (let m = 0; m < N; m++) {
    const players: PlayerSlot[] = [];
    for (let i = 0; i < 8; i++) { const c = CHARACTERS[(m + i) % CHARACTERS.length]; players.push({ id: 'b' + i, name: 'b' + i, charId: c.id, isBot: true, difficulty: 1 }); picks[c.id] = (picks[c.id] ?? 0) + 1; }
    const w = new World(buildMap(map.id), { mode: 'ffa', durationMs: 180000, seed: 5000 + m, players, poison: true, mapEvents: true, countdownMs: 0 });
    while (w.phase !== 'ended') { w.step(1 / 20); w.drainEvents(); }
    len += w.time;
    const win = w.ranking[0]; wins[win.charId] = (wins[win.charId] ?? 0) + 1;
  }
  lens.push(`${map.id} ${(len / N / 1000).toFixed(0)}s`);
}
console.log(lens.join(' · '));
console.log(CHARACTERS.map((c) => `${c.id} ${(100 * (wins[c.id] ?? 0) / picks[c.id]).toFixed(1)}%`).join('  '));
