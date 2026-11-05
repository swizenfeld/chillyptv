/**
 * Today's fixtures from ESPN's public soccer scoreboards (no API key). Shared by the ChillyPTV
 * server and the Android / Fire TV app, which asks ESPN itself (there is no server there).
 */
import { LEAGUE_BY_ID, parseEspnScoreboard, type Fixture } from './sports.js';

export const ESPN_SOCCER = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TTL_LIVE_MS = 60_000;
const TTL_IDLE_MS = 10 * 60_000;
const TTL_ERROR_MS = 2 * 60_000;

const cache = new Map<string, { at: number; ttl: number; fixtures?: Fixture[]; error?: string }>();

export function describeError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError') return 'timed out';
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(e);
}

/** Fetches a URL and returns its JSON (throws on HTTP errors). */
export type FetchJson = (url: string) => Promise<unknown>;

/** One league, one calendar day (YYYYMMDD) — the request shape ESPN reliably supports. */
async function fetchLeagueDay(base: string, leagueId: string, day: string, fetchJson: FetchJson): Promise<Fixture[]> {
  const key = `${base}|${leagueId}|${day}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    if (hit.error) throw new Error(hit.error);
    return hit.fixtures!;
  }
  try {
    const fixtures = parseEspnScoreboard(await fetchJson(`${base}/${leagueId}/scoreboard?dates=${day}`), leagueId);
    // Poll faster while anything is live so scores and minutes stay current.
    cache.set(key, { at: Date.now(), ttl: fixtures.some((f) => f.state === 'in') ? TTL_LIVE_MS : TTL_IDLE_MS, fixtures });
    return fixtures;
  } catch (e) {
    const error = describeError(e);
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

export interface FixturesResult {
  fixtures: Fixture[];
  errors: { league: string; error: string }[];
  leagues: number;
  fetchedAt: number;
}

/** Fixtures of `leagueIds` starting in [from, to) (plus any in play). */
export async function collectFixtures(leagueIds: string[], from: number, to: number, fetchJson: FetchJson, base = ESPN_SOCCER): Promise<FixturesResult> {
  const leagues = [...new Set(leagueIds)].filter((id) => LEAGUE_BY_ID.has(id));
  // ESPN groups matches by US-Eastern calendar day: ask for every UTC day the local window touches.
  const days = new Set<string>();
  for (let t = from - 6 * 3_600_000; t <= to; t += 6 * 3_600_000) days.add(new Date(t).toISOString().slice(0, 10).replace(/-/g, ''));
  const fixtures = new Map<string, Fixture>();
  const failed = new Map<string, string>();
  await pool(leagues, 6, async (id) => {
    const results = await Promise.allSettled([...days].map((d) => fetchLeagueDay(base, id, d, fetchJson)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Fixture[]> => r.status === 'fulfilled');
    if (!ok.length) failed.set(id, describeError((results[0] as PromiseRejectedResult).reason));
    for (const r of ok) for (const f of r.value) if (f.state === 'in' || (f.start >= from && f.start < to)) fixtures.set(f.id, f);
  });
  return {
    fixtures: [...fixtures.values()].sort((a, b) => a.start - b.start),
    errors: [...failed].map(([league, error]) => ({ league, error })),
    leagues: leagues.length,
    fetchedAt: Date.now(),
  };
}
