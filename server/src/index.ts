import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_BY_ID, SLOTS, goldReward, trophyDelta, xpFor, type ItemSlot } from '@pastel/shared';
import { connect, migrate, applyXp } from './db';
import { hashPassword, verifyPassword, createSession, userFromToken, sha256, loginBlocked, noteLoginFailure, clearLoginFailures } from './auth';

// local development: pick up server/.env if present (Render injects real env vars)
try { (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env'); } catch { /* no .env */ }

const db = connect();
const app = new Hono();

const CHARACTERS = ['toto', 'boogie', 'popo', 'luna', 'kiki', 'mongle', 'leo', 'hoya'] as const;
/** brawlers that require an account (guests can't submit results with them) */
const MEMBER_ONLY: readonly string[] = ['leo', 'hoya'];
const MAPS = ['meadow', 'jungle_ruins', 'jungle_lagoon', 'desert', 'glacier', 'candy_town', 'starlight'] as const;
const MEMBER_MAPS: readonly string[] = ['candy_town', 'starlight'];
const MIN_SUBMIT_GAP_MS = 20_000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const SIGNUP_BONUS = 3000;

const authed = (c: Context) => userFromToken(db, c.req.header('authorization'));
const int = (v: unknown) => Number(v ?? 0);

// ─────────────────────────────────────────────── health
app.get('/api/health', async (c) => {
  await db.execute('SELECT 1');
  return c.json({ ok: true, db: process.env.TURSO_DATABASE_URL ? 'turso' : 'local' });
});

// ─────────────────────────────────────────────── auth
const Credentials = z.object({
  username: z.string().trim().min(2).max(12).regex(/^[\p{L}\p{N}_]+$/u, 'letters, numbers, _'),
  password: z.string().min(6).max(64),
});

app.post('/api/auth/register', async (c) => {
  const p = Credentials.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ ok: false, error: 'invalid', field: p.error.issues[0]?.path[0] }, 400);
  const { username, password } = p.data;
  const lc = username.toLowerCase();
  const exists = await db.execute({ sql: 'SELECT 1 FROM users WHERE username_lc = ?', args: [lc] });
  if (exists.rows.length) return c.json({ ok: false, error: 'taken' }, 409);
  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const ins = await db.execute({
    sql: `INSERT INTO users (username, username_lc, password_hash, password_salt, gold, total_earned, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [username, lc, hash, salt, SIGNUP_BONUS, SIGNUP_BONUS, now, now],
  });
  const userId = Number(ins.lastInsertRowid);
  await db.execute({ sql: `INSERT INTO gold_ledger (user_id, delta, balance_after, reason, memo, created_at) VALUES (?, ?, ?, 'signup_bonus', '가입 축하 골드', ?)`, args: [userId, SIGNUP_BONUS, SIGNUP_BONUS, now] });
  const token = await createSession(db, userId, c.req.header('user-agent'));
  return c.json({ ok: true, token, username });
});

app.post('/api/auth/login', async (c) => {
  const p = Credentials.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ ok: false, error: 'invalid' }, 400);
  const lc = p.data.username.toLowerCase();
  const key = `${lc}|${c.req.header('x-forwarded-for') ?? ''}`;
  if (loginBlocked(key)) return c.json({ ok: false, error: 'locked' }, 429);
  const rs = await db.execute({ sql: 'SELECT id, username, password_hash, password_salt FROM users WHERE username_lc = ?', args: [lc] });
  const u = rs.rows[0];
  if (!u || !(await verifyPassword(p.data.password, String(u.password_hash), String(u.password_salt)))) {
    noteLoginFailure(key);
    return c.json({ ok: false, error: 'wrong' }, 401);
  }
  clearLoginFailures(key);
  await db.execute({ sql: 'UPDATE users SET last_login_at = ? WHERE id = ?', args: [Date.now(), u.id] });
  const token = await createSession(db, Number(u.id), c.req.header('user-agent'));
  return c.json({ ok: true, token, username: u.username });
});

app.post('/api/auth/logout', async (c) => {
  const m = /^Bearer ([a-f0-9]{64})$/i.exec(c.req.header('authorization') ?? '');
  if (m) await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [sha256(m[1])] });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────── account
async function account(userId: number) {
  const [u, inv, eq, ch] = await Promise.all([
    db.execute({ sql: 'SELECT id, username, gold, total_earned, total_spent, games, wins, kills, best_score, level, xp, total_score, selected_character, progress_json, created_at FROM users WHERE id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT item_id FROM user_items WHERE user_id = ? ORDER BY acquired_at', args: [userId] }),
    db.execute({ sql: 'SELECT character_id, slot, item_id FROM user_equipment WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT character_id, trophies, games, wins, best_score FROM user_characters WHERE user_id = ?', args: [userId] }),
  ]);
  const r = u.rows[0];
  const equipment: Record<string, Partial<Record<ItemSlot, string>>> = {};
  for (const row of eq.rows) (equipment[String(row.character_id)] ??= {})[row.slot as ItemSlot] = String(row.item_id);
  let progress: unknown = null;
  try { progress = r.progress_json ? JSON.parse(String(r.progress_json)) : null; } catch { progress = null; }
  return {
    user: {
      id: int(r.id), username: String(r.username), gold: int(r.gold), totalEarned: int(r.total_earned), totalSpent: int(r.total_spent),
      games: int(r.games), wins: int(r.wins), kills: int(r.kills), bestScore: int(r.best_score), createdAt: int(r.created_at),
      level: int(r.level) || 1, xp: int(r.xp), totalScore: int(r.total_score), selected: String(r.selected_character ?? 'toto'),
    },
    characters: Object.fromEntries(ch.rows.map((x) => [String(x.character_id), { trophies: int(x.trophies), games: int(x.games), wins: int(x.wins), bestScore: int(x.best_score) }])),
    inventory: inv.rows.map((x) => String(x.item_id)),
    equipment,
    progress,
  };
}

app.get('/api/me', async (c) => {
  const me = await authed(c);
  if (!me) return c.json({ ok: false, error: 'auth' }, 401);
  return c.json({ ok: true, ...(await account(me.id)) });
});

/**
 * Account preferences (selected brawler, skins, map, tutorial flag). Progression itself
 * (trophies, level, xp, score, wins) is computed only by the server from match results.
 */
app.post('/api/progress', async (c) => {
  const me = await authed(c);
  if (!me) return c.json({ ok: false, error: 'auth' }, 401);
  const body = await c.req.text();
  if (body.length > 20_000) return c.json({ ok: false, error: 'too large' }, 413);
  let prefs: { selected?: string };
  try { prefs = JSON.parse(body); } catch { return c.json({ ok: false, error: 'invalid' }, 400); }
  const sel = (CHARACTERS as readonly string[]).includes(prefs.selected ?? '') ? prefs.selected! : null;
  await db.execute({ sql: 'UPDATE users SET progress_json = ?, selected_character = COALESCE(?, selected_character) WHERE id = ?', args: [body, sel, me.id] });
  return c.json({ ok: true });
});

/** The account's own recent matches (for the records screen). */
app.get('/api/history', async (c) => {
  const me = await authed(c);
  if (!me) return c.json({ ok: false, error: 'auth' }, 401);
  const rs = await db.execute({ sql: 'SELECT character_id, map_id, place, kills, assists, damage, score, gold_earned, created_at FROM game_results WHERE user_id = ? ORDER BY score DESC, created_at DESC LIMIT 100', args: [me.id] });
  return c.json({ ok: true, entries: rs.rows.map((r) => ({ charId: r.character_id, mapId: r.map_id, place: int(r.place), kills: int(r.kills), assists: int(r.assists), damage: int(r.damage), score: int(r.score), gold: int(r.gold_earned), createdAt: int(r.created_at) })) });
});

app.get('/api/gold/ledger', async (c) => {
  const me = await authed(c);
  if (!me) return c.json({ ok: false, error: 'auth' }, 401);
  const rs = await db.execute({ sql: 'SELECT delta, balance_after, reason, ref_id, memo, created_at FROM gold_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50', args: [me.id] });
  return c.json({ ok: true, entries: rs.rows.map((r) => ({ delta: int(r.delta), balance: int(r.balance_after), reason: r.reason, ref: r.ref_id, memo: r.memo, at: int(r.created_at) })) });
});

// ─────────────────────────────────────────────── shop & equipment
app.post('/api/shop/buy', async (c) => {
  const me = await authed(c);
  if (!me) return c.json({ ok: false, error: 'auth' }, 401);
  const { itemId } = (await c.req.json().catch(() => ({}))) as { itemId?: string };
  const item = itemId ? ITEM_BY_ID[itemId] : undefined;
  if (!item) return c.json({ ok: false, error: 'unknown item' }, 400);
  const tx = await db.transaction('write');
  try {
    const owned = await tx.execute({ sql: 'SELECT 1 FROM user_items WHERE user_id = ? AND item_id = ?', args: [me.id, item.id] });
    if (owned.rows.length) { await tx.rollback(); return c.json({ ok: false, error: 'owned' }, 409); }
    const upd = await tx.execute({ sql: 'UPDATE users SET gold = gold - ?, total_spent = total_spent + ? WHERE id = ? AND gold >= ?', args: [item.price, item.price, me.id, item.price] });
    if (upd.rowsAffected === 0) { await tx.rollback(); return c.json({ ok: false, error: 'gold' }, 402); }
    const bal = int((await tx.execute({ sql: 'SELECT gold FROM users WHERE id = ?', args: [me.id] })).rows[0].gold);
    const now = Date.now();
    await tx.execute({ sql: 'INSERT INTO user_items (user_id, item_id, acquired_at, source) VALUES (?, ?, ?, ?)', args: [me.id, item.id, now, 'shop'] });
    await tx.execute({ sql: 'INSERT INTO purchases (user_id, item_id, price, created_at) VALUES (?, ?, ?, ?)', args: [me.id, item.id, item.price, now] });
    await tx.execute({ sql: `INSERT INTO gold_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, memo, created_at) VALUES (?, ?, ?, 'purchase', 'item', ?, ?, ?)`, args: [me.id, -item.price, bal, item.id, item.name, now] });
    await tx.commit();
    return c.json({ ok: true, gold: bal, itemId: item.id });
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
});

const EquipBody = z.object({ charId: z.enum(CHARACTERS), slot: z.enum(SLOTS as [ItemSlot, ...ItemSlot[]]), itemId: z.string().nullable() });
app.post('/api/equip', async (c) => {
  const me = await authed(c);
  if (!me) return c.json({ ok: false, error: 'auth' }, 401);
  const p = EquipBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ ok: false, error: 'invalid' }, 400);
  const { charId, slot, itemId } = p.data;
  if (itemId === null) {
    await db.execute({ sql: 'DELETE FROM user_equipment WHERE user_id = ? AND character_id = ? AND slot = ?', args: [me.id, charId, slot] });
    return c.json({ ok: true });
  }
  const item = ITEM_BY_ID[itemId];
  if (!item || item.slot !== slot) return c.json({ ok: false, error: 'slot' }, 400);
  const owned = await db.execute({ sql: 'SELECT 1 FROM user_items WHERE user_id = ? AND item_id = ?', args: [me.id, itemId] });
  if (!owned.rows.length) return c.json({ ok: false, error: 'not owned' }, 403);
  await db.execute({
    sql: `INSERT INTO user_equipment (user_id, character_id, slot, item_id, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, character_id, slot) DO UPDATE SET item_id = excluded.item_id, updated_at = excluded.updated_at`,
    args: [me.id, charId, slot, itemId, Date.now()],
  });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────── results, gold rewards, leaderboard
const ResultBody = z.object({
  deviceId: z.string().min(8).max(64).regex(/^[\w-]+$/).optional(),
  nickname: z.string().trim().min(1).max(12).optional(),
  charId: z.enum(CHARACTERS),
  mapId: z.enum(MAPS),
  place: z.number().int().min(1).max(8),
  kills: z.number().int().min(0).max(7),
  assists: z.number().int().min(0).max(7),
  damage: z.number().int().min(0).max(110_000),
  score: z.number().int().min(0),
  durationMs: z.number().int().min(10_000).max(260_000),
});
/** Upper bound of a legit score (kills incl. streak/bounty bonuses + assists + damage + placement). */
const maxScore = (b: z.infer<typeof ResultBody>) => b.kills * 350 + b.assists * 40 + Math.ceil(b.damage * 0.05) + 300 + 50;

app.post('/api/results', async (c) => {
  const parsed = ResultBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'invalid', issues: parsed.error.issues.map((i) => i.path.join('.')) }, 400);
  const b = parsed.data;
  if (b.score > maxScore(b)) return c.json({ ok: false, error: 'implausible score' }, 422);
  const me = await authed(c);
  const now = Date.now();
  if (!me) return guestResult(c, b, now);

  const last = await db.execute({ sql: 'SELECT MAX(created_at) AS t FROM game_results WHERE user_id = ?', args: [me.id] });
  if (now - int(last.rows[0]?.t) < MIN_SUBMIT_GAP_MS) return c.json({ ok: false, error: 'too many submissions' }, 429);
  const eq = await db.execute({ sql: 'SELECT slot, item_id FROM user_equipment WHERE user_id = ? AND character_id = ?', args: [me.id, b.charId] });
  const equipJson = JSON.stringify(Object.fromEntries(eq.rows.map((r) => [r.slot, r.item_id])));
  const reward = goldReward(b.place, b.score);

  const tx = await db.transaction('write');
  try {
    const ins = await tx.execute({
      sql: `INSERT INTO game_results (user_id, character_id, map_id, place, kills, assists, damage, score, gold_earned, duration_ms, equipment_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [me.id, b.charId, b.mapId, b.place, b.kills, b.assists, b.damage, b.score, reward, b.durationMs, equipJson, now],
    });
    const cur = (await tx.execute({ sql: 'SELECT level, xp FROM users WHERE id = ?', args: [me.id] })).rows[0];
    const xpGained = xpFor(b.place, b.kills);
    const lv = applyXp(int(cur.level) || 1, int(cur.xp), xpGained);
    const tDelta = trophyDelta(b.place);
    const prevT = int((await tx.execute({ sql: 'SELECT trophies FROM user_characters WHERE user_id = ? AND character_id = ?', args: [me.id, b.charId] })).rows[0]?.trophies);
    const newT = Math.max(0, prevT + tDelta);
    await tx.execute({
      sql: `UPDATE users SET games = games + 1, wins = wins + ?, kills = kills + ?, best_score = MAX(best_score, ?), total_score = total_score + ?,
            level = ?, xp = ?, selected_character = ?, gold = gold + ?, total_earned = total_earned + ? WHERE id = ?`,
      args: [b.place === 1 ? 1 : 0, b.kills, b.score, b.score, lv.level, lv.xp, b.charId, reward, reward, me.id],
    });
    await tx.execute({
      sql: `INSERT INTO user_characters (user_id, character_id, trophies, games, wins, best_score, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(user_id, character_id) DO UPDATE SET trophies = excluded.trophies, games = games + 1, wins = wins + excluded.wins,
            best_score = MAX(best_score, excluded.best_score), updated_at = excluded.updated_at`,
      args: [me.id, b.charId, newT, b.place === 1 ? 1 : 0, b.score, now],
    });
    const bal = int((await tx.execute({ sql: 'SELECT gold FROM users WHERE id = ?', args: [me.id] })).rows[0].gold);
    if (reward > 0) {
      await tx.execute({
        sql: `INSERT INTO gold_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, memo, created_at) VALUES (?, ?, ?, 'match_reward', 'game_result', ?, ?, ?)`,
        args: [me.id, reward, bal, String(ins.lastInsertRowid), `${b.place}위 보상`, now],
      });
    }
    await tx.commit();
    const best = int((await db.execute({ sql: 'SELECT best_score FROM users WHERE id = ?', args: [me.id] })).rows[0].best_score);
    const rank = int((await db.execute({ sql: 'SELECT COUNT(*) + 1 AS r FROM users WHERE best_score > ?', args: [best] })).rows[0].r);
    const acc = await account(me.id);
    return c.json({ ok: true, best, rank, goldEarned: reward, gold: bal, trophyDelta: tDelta, xpGained, levelUps: lv.ups, account: acc });
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
});

/** Guests (not logged in): anonymous device-id history, no gold. */
async function guestResult(c: Context, b: z.infer<typeof ResultBody>, now: number) {
  if (!b.deviceId || !b.nickname) return c.json({ ok: false, error: 'auth' }, 401);
  if (MEMBER_ONLY.includes(b.charId) || MEMBER_MAPS.includes(b.mapId)) return c.json({ ok: false, error: 'members only' }, 403);
  const last = await db.execute({ sql: 'SELECT MAX(created_at) AS t FROM match_results WHERE player_id = ?', args: [b.deviceId] });
  if (now - int(last.rows[0]?.t) < MIN_SUBMIT_GAP_MS) return c.json({ ok: false, error: 'too many submissions' }, 429);
  await db.batch([
    {
      sql: `INSERT INTO players (id, nickname, created_at, updated_at, games, wins, kills, total_score, best_score) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at, games = games + 1, wins = wins + excluded.wins,
            kills = kills + excluded.kills, total_score = total_score + excluded.total_score, best_score = MAX(best_score, excluded.best_score)`,
      args: [b.deviceId, b.nickname, now, now, b.place === 1 ? 1 : 0, b.kills, b.score, b.score],
    },
    {
      sql: `INSERT INTO match_results (player_id, character_id, map_id, place, kills, assists, damage, score, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [b.deviceId, b.charId, b.mapId, b.place, b.kills, b.assists, b.damage, b.score, b.durationMs, now],
    },
  ], 'write');
  return c.json({ ok: true, guest: true, goldEarned: 0 });
}

/** Best result per account: scope = all | weekly, optional character filter. scope = total: cumulative stars per account. */
app.get('/api/leaderboard', async (c) => {
  const q = c.req.query('scope');
  const scope = q === 'weekly' ? 'weekly' : q === 'total' ? 'total' : 'all';
  const char = c.req.query('char');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const me = await authed(c);
  if (scope === 'total') {
    const rs = await db.execute({
      sql: `SELECT r.user_id AS uid, u.username AS nickname, SUM(r.score) AS score, COUNT(*) AS games, SUM(r.place = 1) AS wins,
                   SUM(r.kills) AS kills, COALESCE(u.selected_character, MAX(r.character_id)) AS charId, MAX(r.created_at) AS createdAt
            FROM game_results r JOIN users u ON u.id = r.user_id
            GROUP BY r.user_id ORDER BY score DESC, createdAt ASC LIMIT ?`,
      args: [limit],
    });
    return c.json({
      scope, char: null,
      entries: rs.rows.map((r, i) => ({
        rank: i + 1, nickname: r.nickname, score: int(r.score), charId: r.charId, mapId: '', place: 0, kills: int(r.kills),
        games: int(r.games), wins: int(r.wins), createdAt: int(r.createdAt), me: !!me && int(r.uid) === me.id,
      })),
    });
  }
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (scope === 'weekly') { where.push('r.created_at >= ?'); args.push(Date.now() - WEEK_MS); }
  if (char && (CHARACTERS as readonly string[]).includes(char)) { where.push('r.character_id = ?'); args.push(char); }
  // SQLite returns the other columns from the row holding MAX(score)
  const rs = await db.execute({
    sql: `SELECT r.user_id AS uid, u.username AS nickname, MAX(r.score) AS score, r.character_id AS charId, r.map_id AS mapId,
                 r.place AS place, r.kills AS kills, r.created_at AS createdAt
          FROM game_results r JOIN users u ON u.id = r.user_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          GROUP BY r.user_id ORDER BY score DESC, createdAt ASC LIMIT ?`,
    args: [...args, limit],
  });
  return c.json({
    scope, char: char ?? null,
    entries: rs.rows.map((r, i) => ({
      rank: i + 1, nickname: r.nickname, score: int(r.score), charId: r.charId, mapId: r.mapId,
      place: int(r.place), kills: int(r.kills), createdAt: int(r.createdAt), me: !!me && int(r.uid) === me.id,
    })),
  });
});

/** Latest matches of everyone (accounts + guests), newest first. */
app.get('/api/recent', async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
  const me = await authed(c);
  const rs = await db.execute({
    sql: `SELECT * FROM (
            SELECT r.user_id AS uid, u.username AS nickname, 0 AS guest, r.character_id AS charId, r.map_id AS mapId, r.place AS place,
                   r.kills AS kills, r.score AS score, r.created_at AS createdAt
            FROM game_results r JOIN users u ON u.id = r.user_id
            UNION ALL
            SELECT NULL, p.nickname, 1, m.character_id, m.map_id, m.place, m.kills, m.score, m.created_at
            FROM match_results m JOIN players p ON p.id = m.player_id
          ) ORDER BY createdAt DESC LIMIT ?`,
    args: [limit],
  });
  return c.json({
    entries: rs.rows.map((r) => ({
      nickname: r.nickname, guest: int(r.guest) === 1, charId: r.charId, mapId: r.mapId, place: int(r.place), kills: int(r.kills),
      score: int(r.score), createdAt: int(r.createdAt), me: !!me && r.uid != null && int(r.uid) === me.id,
    })),
  });
});

// ─────────────────────────────────────────────── seed test account
async function seedTestAccount() {
  if (process.env.SEED_TEST_ACCOUNT === 'false') return;
  const exists = await db.execute({ sql: 'SELECT id FROM users WHERE username_lc = ?', args: ['fdx5'] });
  if (exists.rows.length) return;
  const { hash, salt } = await hashPassword('12341234');
  const now = Date.now(), GOLD = 500_000;
  const ins = await db.execute({
    sql: `INSERT INTO users (username, username_lc, password_hash, password_salt, gold, total_earned, role, created_at) VALUES ('fdx5', 'fdx5', ?, ?, ?, ?, 'tester', ?)`,
    args: [hash, salt, GOLD, GOLD, now],
  });
  await db.execute({ sql: `INSERT INTO gold_ledger (user_id, delta, balance_after, reason, memo, created_at) VALUES (?, ?, ?, 'admin_grant', '테스트 계정 지급', ?)`, args: [Number(ins.lastInsertRowid), GOLD, GOLD, now] });
  console.log('[seed] test account fdx5 created with 500,000 gold');
}

// ─────────────────────────────────────────────── static client (production build)
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(process.env.STATIC_DIR ?? resolve(here, '../../client/dist'));
if (existsSync(staticDir)) {
  const root = relative(process.cwd(), staticDir) || '.';
  app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
  app.use('*', async (c, next) => {
    await next();
    if (/\/(sw\.js|manifest\.webmanifest)$|\/$/.test(c.req.path)) c.header('Cache-Control', 'no-cache');
    else if (/\.(jpg|png|ico|svg)$/.test(c.req.path)) c.header('Cache-Control', 'public, max-age=86400');
  });
  app.use('*', serveStatic({ root }));
  const indexHtml = readFileSync(resolve(staticDir, 'index.html'), 'utf8');
  // SPA fallback only for page routes; missing files (robots.txt, favicon.ico, images…) must 404, not return HTML
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/') || /\.[a-z0-9]{2,5}$/i.test(c.req.path)) return c.text('Not found', 404);
    return c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' });
  });
} else {
  console.warn(`[static] ${staticDir} not found — API only (run "npm run build -w client")`);
}

app.onError((e, c) => { console.error('[api]', e); return c.json({ ok: false, error: 'server' }, 500); });

const port = Number(process.env.PORT ?? 8787);
migrate(db)
  .then(seedTestAccount)
  .then(() => serve({ fetch: app.fetch, port }, () => console.log(`BOOMZY server on :${port}`)))
  .catch((e) => { console.error('[db] boot failed', e); process.exit(1); });
