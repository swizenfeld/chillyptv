import type { IncomingMessage, ServerResponse } from 'node:http';
import { LEAGUE_BY_ID, parseEspnScoreboard, type Fixture } from '../shared/sports.js';
import { DEFAULT_UA, sendError, sendJson } from './util.js';

/**
 * Today's fixtures from ESPN's public soccer scoreboards (no API key).
 * CHILLY_FIXTURES_BASE overrides the base URL (used by the mock provider in tests).
 */
const BASE = process.env.CHILLY_FIXTURES_BASE ?? 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TTL_LIVE_MS = 60_000;
const TTL_IDLE_MS = 10 * 60_000;
const TTL_ERROR_MS = 2 * 60_000;

const cache = new Map<string, { at: number; ttl: number; fixtures?: Fixture[]; error?: string }>();

function describe(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError') return 'timed out';
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(e);
}

/** One league, one calendar day (YYYYMMDD) — the request shape ESPN reliably supports. */
async function fetchLeagueDay(leagueId: string, day: string): Promise<Fixture[]> {
  const key = `${leagueId}|${day}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    if (hit.error) throw new Error(hit.error);
    return hit.fixtures!;
  }
  try {
    const res = await fetch(`${BASE}/${leagueId}/scoreboard?dates=${day}`, {
      headers: { Accept: 'application/json', 'User-Agent': DEFAULT_UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fixtures = parseEspnScoreboard(await res.json(), leagueId);
    // Poll faster while anything is live so scores and minutes stay current.
    cache.set(key, { at: Date.now(), ttl: fixtures.some((f) => f.state === 'in') ? TTL_LIVE_MS : TTL_IDLE_MS, fixtures });
    return fixtures;
  } catch (e) {
    const error = describe(e);
    cache.set(key, { at: Date.now(), ttl: TTL_ERROR_MS, error });
    throw new Error(error);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight (dozens of competitions, politely). */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** GET /api/sports/fixtures?leagues=eng.1,esp.1&from=<ms>&to=<ms> */
export async function handleFixtures(_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const leagues = [...new Set((params.get('leagues') ?? '').split(','))].filter((id) => LEAGUE_BY_ID.has(id));
  if (!leagues.length) return sendError(res, 400, 'No known leagues requested');
  const from = Number(params.get('from')) || Date.now() - 12 * 3_600_000;
  const to = Number(params.get('to')) || Date.now() + 24 * 3_600_000;
  if (to <= from || to - from > 3 * 86_400_000) return sendError(res, 400, 'Invalid time range');

  // ESPN groups matches by US-Eastern calendar day: ask for every UTC day the local window touches.
  const days = new Set<string>();
  for (let t = from - 6 * 3_600_000; t <= to; t += 6 * 3_600_000) days.add(new Date(t).toISOString().slice(0, 10).replace(/-/g, ''));

  const fixtures = new Map<string, Fixture>();
  const failed = new Map<string, string>();
  await pool(leagues, 6, async (id) => {
      const results = await Promise.allSettled([...days].map((d) => fetchLeagueDay(id, d)));
      const ok = results.filter((r): r is PromiseFulfilledResult<Fixture[]> => r.status === 'fulfilled');
      if (!ok.length) failed.set(id, describe((results[0] as PromiseRejectedResult).reason));
      for (const r of ok) for (const f of r.value) if (f.state === 'in' || (f.start >= from && f.start < to)) fixtures.set(f.id, f);
  });
  const errors = [...failed].map(([league, error]) => ({ league, error }));
  if (errors.length) console.warn(`[sports] fixtures unavailable for ${errors.map((e) => `${e.league} (${e.error})`).join(', ')}`);
  sendJson(res, 200, { fixtures: [...fixtures.values()].sort((a, b) => a.start - b.start), errors, leagues: leagues.length, fetchedAt: Date.now() });
}
