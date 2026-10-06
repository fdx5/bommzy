import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, migrate } from './db';

// local development: pick up server/.env if present (Render injects real env vars)
try { (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env'); } catch { /* no .env */ }

const db = connect();
const app = new Hono();

const CHARACTERS = ['toto', 'boogie', 'popo', 'luna', 'kiki', 'mongle'] as const;
const MAPS = ['meadow', 'jungle_ruins', 'jungle_lagoon', 'desert', 'glacier'] as const;
const MIN_SUBMIT_GAP_MS = 20_000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const ResultBody = z.object({
  deviceId: z.string().min(8).max(64).regex(/^[\w-]+$/),
  nickname: z.string().trim().min(1).max(12),
  charId: z.enum(CHARACTERS),
  mapId: z.enum(MAPS),
  place: z.number().int().min(1).max(8),
  kills: z.number().int().min(0).max(7),
  assists: z.number().int().min(0).max(7),
  damage: z.number().int().min(0).max(80_000),
  score: z.number().int().min(0),
  durationMs: z.number().int().min(10_000).max(200_000),
});

/** Upper bound of a legit score (kills incl. streak/bounty bonuses + assists + damage + placement). */
const maxScore = (b: z.infer<typeof ResultBody>) => b.kills * 350 + b.assists * 40 + Math.ceil(b.damage * 0.05) + 300 + 50;

app.get('/api/health', async (c) => {
  await db.execute('SELECT 1');
  return c.json({ ok: true, db: process.env.TURSO_DATABASE_URL ? 'turso' : 'local' });
});

/** Store one finished match and update the player's aggregate stats. */
app.post('/api/results', async (c) => {
  const parsed = ResultBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid', issues: parsed.error.issues.map((i) => i.path.join('.')) }, 400);
  const b = parsed.data;
  if (b.score > maxScore(b)) return c.json({ ok: false, error: 'implausible score' }, 422);
  const now = Date.now();

  const last = await db.execute({ sql: 'SELECT MAX(created_at) AS t FROM match_results WHERE player_id = ?', args: [b.deviceId] });
  const lastAt = Number(last.rows[0]?.t ?? 0);
  if (now - lastAt < MIN_SUBMIT_GAP_MS) return c.json({ ok: false, error: 'too many submissions' }, 429);

  await db.batch([
    {
      sql: `INSERT INTO players (id, nickname, created_at, updated_at, games, wins, kills, total_score, best_score)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              nickname = excluded.nickname, updated_at = excluded.updated_at,
              games = games + 1, wins = wins + excluded.wins, kills = kills + excluded.kills,
              total_score = total_score + excluded.total_score, best_score = MAX(best_score, excluded.best_score)`,
      args: [b.deviceId, b.nickname, now, now, b.place === 1 ? 1 : 0, b.kills, b.score, b.score],
    },
    {
      sql: `INSERT INTO match_results (player_id, character_id, map_id, place, kills, assists, damage, score, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [b.deviceId, b.charId, b.mapId, b.place, b.kills, b.assists, b.damage, b.score, b.durationMs, now],
    },
  ], 'write');

  const me = await db.execute({ sql: 'SELECT best_score, games, wins FROM players WHERE id = ?', args: [b.deviceId] });
  const best = Number(me.rows[0].best_score);
  const rank = await db.execute({ sql: 'SELECT COUNT(*) + 1 AS r FROM players WHERE best_score > ?', args: [best] });
  return c.json({ ok: true, best, rank: Number(rank.rows[0].r), games: Number(me.rows[0].games), wins: Number(me.rows[0].wins) });
});

/** Best result per player: scope = all | weekly, optional character filter. */
app.get('/api/leaderboard', async (c) => {
  const scope = c.req.query('scope') === 'weekly' ? 'weekly' : 'all';
  const char = c.req.query('char');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const meId = c.req.header('x-device-id') ?? '';
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (scope === 'weekly') { where.push('r.created_at >= ?'); args.push(Date.now() - WEEK_MS); }
  if (char && (CHARACTERS as readonly string[]).includes(char)) { where.push('r.character_id = ?'); args.push(char); }
  // SQLite returns the other columns from the row holding MAX(score)
  const rs = await db.execute({
    sql: `SELECT r.player_id AS pid, p.nickname AS nickname, MAX(r.score) AS score, r.character_id AS charId, r.map_id AS mapId,
                 r.place AS place, r.kills AS kills, r.created_at AS createdAt
          FROM match_results r JOIN players p ON p.id = r.player_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          GROUP BY r.player_id ORDER BY score DESC, createdAt ASC LIMIT ?`,
    args: [...args, limit],
  });
  return c.json({
    scope, char: char ?? null,
    entries: rs.rows.map((r, i) => ({
      rank: i + 1, nickname: r.nickname, score: Number(r.score), charId: r.charId, mapId: r.mapId,
      place: Number(r.place), kills: Number(r.kills), createdAt: Number(r.createdAt), me: r.pid === meId,
    })),
  });
});

app.get('/api/players/:id', async (c) => {
  const rs = await db.execute({ sql: 'SELECT nickname, games, wins, kills, total_score, best_score FROM players WHERE id = ?', args: [c.req.param('id')] });
  if (!rs.rows.length) return c.json({ ok: false }, 404);
  const p = rs.rows[0];
  const rank = await db.execute({ sql: 'SELECT COUNT(*) + 1 AS r FROM players WHERE best_score > ?', args: [p.best_score] });
  return c.json({ ok: true, ...p, rank: Number(rank.rows[0].r) });
});

// ── static client (production build)
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(process.env.STATIC_DIR ?? resolve(here, '../../client/dist'));
if (existsSync(staticDir)) {
  const root = relative(process.cwd(), staticDir) || '.';
  app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
  app.use('*', async (c, next) => {
    await next();
    if (/\/(sw\.js|manifest\.webmanifest)$|\/$/.test(c.req.path)) c.header('Cache-Control', 'no-cache');
  });
  app.use('*', serveStatic({ root }));
  const indexHtml = readFileSync(resolve(staticDir, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ ok: false }, 404) : c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' })));
} else {
  console.warn(`[static] ${staticDir} not found — API only (run "npm run build -w client")`);
}

const port = Number(process.env.PORT ?? 8787);
migrate(db)
  .then(() => serve({ fetch: app.fetch, port }, () => console.log(`BOOMZY server on :${port}`)))
  .catch((e) => { console.error('[db] migration failed', e); process.exit(1); });
