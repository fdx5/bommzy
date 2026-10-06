import { World, buildMap, CHARACTERS, type PlayerSlot, type MapId } from '../src';

/** Bot-vs-bot playtest metrics: match length, win rate per character, bush kill ratio, supers. */
const N = Number(process.argv[2] ?? 120);
const MAP = (process.argv[3] ?? 'meadow') as MapId;
const DT = 1 / 20; // server tick rate
const wins: Record<string, number> = {}, picks: Record<string, number> = {}, place: Record<string, number> = {};
let totalLen = 0, kills = 0, bushKills = 0, supers = 0;
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const players: PlayerSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const c = CHARACTERS[(m + i) % CHARACTERS.length];
    players.push({ id: 'b' + i, name: 'b' + i, charId: c.id, isBot: true, difficulty: 1 });
    picks[c.id] = (picks[c.id] ?? 0) + 1;
  }
  const w = new World(buildMap(MAP), { mode: 'ffa', durationMs: 180000, seed: 1000 + m, players, poison: true, mapEvents: true, countdownMs: 0 });
  while (w.phase !== 'ended') { w.step(DT); w.drainEvents(); }
  totalLen += w.time; kills += w.stats.kills; bushKills += w.stats.bushKills; supers += w.stats.superUses;
  for (const r of w.ranking) { place[r.charId] = (place[r.charId] ?? 0) + r.place; if (r.place === 1) wins[r.charId] = (wins[r.charId] ?? 0) + 1; }
}
console.log(`\n${N} matches in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`avg length ${(totalLen / N / 1000).toFixed(1)}s · kills/match ${(kills / N).toFixed(1)} · bush-kill ratio ${(100 * bushKills / Math.max(1, kills)).toFixed(1)}% · supers/match ${(supers / N).toFixed(1)}`);
console.table(CHARACTERS.map((c) => ({
  char: c.id,
  winPerPick: (100 * (wins[c.id] ?? 0) / picks[c.id]).toFixed(1) + '%',
  avgPlace: (place[c.id] / picks[c.id]).toFixed(2),
})));
