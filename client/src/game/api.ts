/**
 * Online leaderboard API (BOOMZY server → Turso). Same origin in production; in dev Vite proxies /api.
 * Every call fails soft (returns null) so the game keeps working offline / as a static site.
 */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function call<T>(path: string, init?: RequestInit, timeoutMs = 6000): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResultSubmit {
  deviceId: string; nickname: string; charId: string; mapId: string;
  place: number; kills: number; assists: number; damage: number; score: number; durationMs: number;
}
export interface SubmitResponse { ok: boolean; best: number; rank: number; games: number; wins: number }

export const submitResult = (r: ResultSubmit) => call<SubmitResponse>('/api/results', { method: 'POST', body: JSON.stringify(r) });

export interface LeaderEntry { rank: number; nickname: string; score: number; charId: string; mapId: string; place: number; kills: number; createdAt: number; me: boolean }

export async function fetchLeaderboard(scope: 'all' | 'weekly', deviceId: string, char?: string) {
  const q = new URLSearchParams({ scope, limit: '100' });
  if (char) q.set('char', char);
  // the device id identifies the player: send it as a header, never in the URL
  const res = await call<{ entries: LeaderEntry[] }>(`/api/leaderboard?${q}`, { headers: { 'X-Device-Id': deviceId } });
  return res?.entries ?? null;
}
