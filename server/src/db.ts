import { createClient, type Client } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { ITEMS, trophyDelta, xpFor, levelXp } from '@pastel/shared';

/**
 * Turso (libSQL) connection.
 *   TURSO_DATABASE_URL  libsql://<db>-<org>.turso.io
 *   TURSO_AUTH_TOKEN    database token
 * Without TURSO_DATABASE_URL a local SQLite file is used, so development works offline.
 */
export function connect(): Client {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (url) return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN?.trim() });
  mkdirSync('data', { recursive: true });
  console.warn('[db] TURSO_DATABASE_URL not set → using local file:data/local.db');
  return createClient({ url: 'file:data/local.db' });
}

/**
 * Schema
 *  users            account, password hash, available gold + lifetime earned/spent, stats, synced progress
 *  sessions         login sessions (only a SHA-256 of the bearer token is stored)
 *  gold_ledger      every gold movement (+ rewards / grants, − purchases) with the balance after it
 *  purchases        shop purchase history
 *  user_items       owned cosmetics (inventory)
 *  user_equipment   what each brawler wears, per account / character / slot
 *  game_results     match history of logged-in players (leaderboard source)
 *  shop_items       catalogue mirror (synced from code at boot, for reporting / admin)
 *  user_characters  per-brawler progression: trophies, games, wins, best score
 *  meta             one-off migration markers
 *  players, match_results   legacy anonymous (device-id) results from guests
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_lc TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
    total_earned INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    progress_json TEXT,
    role TEXT NOT NULL DEFAULT 'player',
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS gold_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,           -- signup_bonus | match_reward | purchase | admin_grant
    ref_type TEXT,                  -- game_result | item
    ref_id TEXT,
    memo TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user ON gold_ledger(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS user_items (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'shop',
    PRIMARY KEY (user_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_equipment (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    item_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, character_id, slot)
  )`,
  `CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    map_id TEXT NOT NULL,
    place INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    assists INTEGER NOT NULL,
    damage INTEGER NOT NULL,
    score INTEGER NOT NULL,
    gold_earned INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL,
    equipment_json TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_game_results_score ON game_results(score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_game_results_user ON game_results(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_game_results_created ON game_results(created_at)`,
  `CREATE TABLE IF NOT EXISTS shop_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    slot TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    rarity TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS user_characters (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    trophies INTEGER NOT NULL DEFAULT 0,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, character_id)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  // legacy guest tables
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, nickname TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, kills INTEGER NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0, best_score INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL REFERENCES players(id), character_id TEXT NOT NULL,
    map_id TEXT NOT NULL, place INTEGER NOT NULL, kills INTEGER NOT NULL, assists INTEGER NOT NULL, damage INTEGER NOT NULL,
    score INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at INTEGER NOT NULL
  )`,
];

/** Idempotent: safe to run on every boot. */
/** Add a column when an older database doesn't have it yet (SQLite has no ADD COLUMN IF NOT EXISTS). */
async function ensureColumn(db: Client, table: string, column: string, ddl: string) {
  const cols = await db.execute(`PRAGMA table_info(${table})`);
  if (!cols.rows.some((r) => r.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

/** Level-up loop shared by results and backfill. */
export function applyXp(level: number, xp: number, gained: number) {
  xp += gained;
  let ups = 0;
  while (xp >= levelXp(level)) { xp -= levelXp(level); level++; ups++; }
  return { level, xp, ups };
}

/** Rebuild trophies / level / xp / total score from existing match history (runs once). */
async function backfillProgression(db: Client) {
  const done = await db.execute({ sql: 'SELECT value FROM meta WHERE key = ?', args: ['progression_v1'] });
  if (done.rows.length) return;
  const rs = await db.execute('SELECT user_id, character_id, place, kills, score FROM game_results ORDER BY user_id, created_at');
  const per = new Map<number, { level: number; xp: number; total: number; chars: Map<string, { t: number; g: number; w: number; b: number }> }>();
  for (const r of rs.rows) {
    const uid = Number(r.user_id), ch = String(r.character_id), place = Number(r.place), score = Number(r.score);
    const u = per.get(uid) ?? { level: 1, xp: 0, total: 0, chars: new Map() };
    const lv = applyXp(u.level, u.xp, xpFor(place, Number(r.kills)));
    u.level = lv.level; u.xp = lv.xp; u.total += score;
    const c = u.chars.get(ch) ?? { t: 0, g: 0, w: 0, b: 0 };
    c.t = Math.max(0, c.t + trophyDelta(place)); c.g++; if (place === 1) c.w++; c.b = Math.max(c.b, score);
    u.chars.set(ch, c); per.set(uid, u);
  }
  const now = Date.now();
  const stmts: { sql: string; args: (string | number)[] }[] = [];
  for (const [uid, u] of per) {
    stmts.push({ sql: 'UPDATE users SET level = ?, xp = ?, total_score = ? WHERE id = ?', args: [u.level, u.xp, u.total, uid] });
    for (const [ch, c] of u.chars) stmts.push({
      sql: `INSERT INTO user_characters (user_id, character_id, trophies, games, wins, best_score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, character_id) DO UPDATE SET trophies = excluded.trophies, games = excluded.games, wins = excluded.wins, best_score = excluded.best_score, updated_at = excluded.updated_at`,
      args: [uid, ch, c.t, c.g, c.w, c.b, now],
    });
  }
  stmts.push({ sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', args: ['progression_v1', String(now)] });
  await db.batch(stmts, 'write');
  if (per.size) console.log(`[migrate] progression rebuilt for ${per.size} account(s)`);
}

export async function migrate(db: Client) {
  await db.batch(SCHEMA, 'write');
  await ensureColumn(db, 'users', 'level', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'users', 'xp', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'users', 'total_score', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'users', 'selected_character', "TEXT NOT NULL DEFAULT 'toto'");
  await backfillProgression(db);
  // keep the catalogue mirror in sync with the code
  await db.batch(ITEMS.map((it) => ({
    sql: `INSERT INTO shop_items (id, kind, slot, name, price, rarity, active) VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, slot = excluded.slot, name = excluded.name, price = excluded.price, rarity = excluded.rarity, active = 1`,
    args: [it.id, it.kind, it.slot, it.name, it.price, it.rarity],
  })), 'write');
}
