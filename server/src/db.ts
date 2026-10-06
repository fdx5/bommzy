import { createClient, type Client } from '@libsql/client';
import { mkdirSync } from 'node:fs';

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

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id),
    character_id TEXT NOT NULL,
    map_id TEXT NOT NULL,
    place INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    assists INTEGER NOT NULL,
    damage INTEGER NOT NULL,
    score INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_results_score ON match_results(score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_results_created ON match_results(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_results_player ON match_results(player_id, created_at)`,
];

/** Idempotent: safe to run on every boot. */
export async function migrate(db: Client) {
  await db.batch(SCHEMA, 'write');
}
