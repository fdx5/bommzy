import { World, RULES, buildMap, CHARACTERS, MAPS, type PlayerSlot } from '../src';
/** Aggregate bot playtest across every map: win rate per character, match length per map. */
const N = Number(process.argv[2] ?? 60);
const wins: Record<string, number> = {}, picks: Record<string, number> = {};
const lens: string[] = [];
for (const map of MAPS.filter((m) => !process.argv[3] || m.id === process.argv[3])) {
  let len = 0, stalls = 0;
  for (let m = 0; m < N; m++) {
    const players: PlayerSlot[] = [];
    for (let i = 0; i < 8; i++) { const c = CHARACTERS[(m + i) % CHARACTERS.length]; players.push({ id: 'b' + i, name: 'b' + i, charId: c.id, isBot: true, difficulty: 1 }); picks[c.id] = (picks[c.id] ?? 0) + 1; }
    const w = new World(buildMap(map.id), { mode: 'ffa', durationMs: RULES.matchDurationMs, seed: 5000 + m, players, poison: true, mapEvents: true, countdownMs: 0 });
    const still = new Map<string, number>();
    while (w.phase !== 'ended') {
      const before = w.fighters.map((f) => ({ x: f.x, y: f.y }));
      w.step(1 / 20); w.drainEvents();
      w.fighters.forEach((f, i) => {
        const state = w.bots.get(f.id)?.state;
        const waiting = state === 'ambush' || state === 'retreat' || w.time - f.lastAttackAt < 1500 || w.time < f.stunUntil;
        const t = f.alive && !waiting && Math.hypot(f.x - before[i].x, f.y - before[i].y) < 0.015 ? (still.get(f.id) ?? 0) + 50 : 0;
        if (t === 3000) { stalls++; if (process.argv.includes('--debug-stalls')) console.log(JSON.stringify({ map: map.id, seed: 5000 + m, now: w.time, char: f.charId, x: f.x, y: f.y, lastAttackAt: f.lastAttackAt, bot: w.bots.get(f.id) })); }
        still.set(f.id, t);
      });
    }
    len += w.time;
    const win = w.ranking[0]; wins[win.charId] = (wins[win.charId] ?? 0) + 1;
  }
  lens.push(`${map.id} ${(len / N / 1000).toFixed(0)}s (3s stalls: ${stalls})`);
}
console.log(lens.join(' · '));
console.log(CHARACTERS.map((c) => `${c.id} ${(100 * (wins[c.id] ?? 0) / picks[c.id]).toFixed(1)}%`).join('  '));
