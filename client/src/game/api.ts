/**
 * BOOMZY server API (accounts, gold, shop, leaderboard → Turso). Same origin in production; Vite proxies /api in dev.
 * Calls fail soft (null) so the game still runs offline / as guest.
 */
import type { Equipment, ItemSlot } from '@pastel/shared';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const TOKEN_KEY = 'boomzy/token';

let token: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
export const session = {
  get token() { return token; },
  set(t: string) { token = t; try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear() { token = null; try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export interface ApiResult<T> { status: number; data: T | null }

async function raw<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<ApiResult<T>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      ...init,
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null }; // offline / server asleep
  } finally {
    clearTimeout(timer);
  }
}
async function call<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T | null> {
  const r = await raw<T>(path, init, timeoutMs);
  return r.status >= 200 && r.status < 300 ? r.data : null;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

// ── accounts
export interface AuthResponse { ok: boolean; token?: string; username?: string; error?: string }
export const register = (username: string, password: string) => raw<AuthResponse>('/api/auth/register', post({ username, password }), 20000);
export const login = (username: string, password: string) => raw<AuthResponse>('/api/auth/login', post({ username, password }), 20000);
export const logout = () => call<{ ok: boolean }>('/api/auth/logout', post({}));

export interface Account {
  user: { id: number; username: string; gold: number; totalEarned: number; totalSpent: number; games: number; wins: number; kills: number; bestScore: number; createdAt: number };
  inventory: string[];
  equipment: Record<string, Equipment>;
  progress: unknown;
}
export const fetchMe = () => raw<Account & { ok: boolean }>('/api/me', undefined, 20000);
export const saveProgress = (progress: unknown) => call<{ ok: boolean }>('/api/progress', { method: 'POST', body: JSON.stringify(progress) });

// ── gold & shop
export const buyItem = (itemId: string) => raw<{ ok: boolean; gold?: number; error?: string }>('/api/shop/buy', post({ itemId }));
export const equipItem = (charId: string, slot: ItemSlot, itemId: string | null) => raw<{ ok: boolean; error?: string }>('/api/equip', post({ charId, slot, itemId }));
export interface LedgerEntry { delta: number; balance: number; reason: string; ref: string | null; memo: string | null; at: number }
export async function fetchLedger() { return (await call<{ entries: LedgerEntry[] }>('/api/gold/ledger'))?.entries ?? null; }

// ── results & leaderboard
export interface ResultSubmit {
  deviceId: string; nickname: string; charId: string; mapId: string;
  place: number; kills: number; assists: number; damage: number; score: number; durationMs: number;
}
export interface SubmitResponse { ok: boolean; best?: number; rank?: number; goldEarned: number; gold?: number; guest?: boolean }
export const submitResult = (r: ResultSubmit) => call<SubmitResponse>('/api/results', post(r));

export interface LeaderEntry { rank: number; nickname: string; score: number; charId: string; mapId: string; place: number; kills: number; createdAt: number; me: boolean }
export async function fetchLeaderboard(scope: 'all' | 'weekly', char?: string) {
  const q = new URLSearchParams({ scope, limit: '100' });
  if (char) q.set('char', char);
  return (await call<{ entries: LeaderEntry[] }>(`/api/leaderboard?${q}`))?.entries ?? null;
}
