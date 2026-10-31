import type { IncomingMessage, ServerResponse } from 'node:http';
import { LEAGUE_BY_ID, parseEspnScoreboard, type Fixture } from '../shared/sports.js';
import { sendError, sendJson } from './util.js';

/**
 * Today's fixtures from ESPN's public soccer scoreboards (no API key).
 * CHILLY_FIXTURES_BASE overrides the base URL (used by the mock provider in tests).
 */
const BASE = process.env.CHILLY_FIXTURES_BASE ?? 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TTL_LIVE_MS = 60_000;
const TTL_IDLE_MS = 10 * 60_000;

const cache = new Map<string, { at: number; ttl: number; fixtures: Fixture[] }>();

async function fetchLeague(leagueId: string, dates: string): Promise<Fixture[]> {
  const key = `${leagueId}|${dates}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.fixtures;
  const res = await fetch(`${BASE}/${leagueId}/scoreboard?dates=${dates}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'ChillyPTV/0.1' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const fixtures = parseEspnScoreboard(await res.json(), leagueId);
  // Poll faster while anything is live so scores and minutes stay current.
  const ttl = fixtures.some((f) => f.state === 'in') ? TTL_LIVE_MS : TTL_IDLE_MS;
  cache.set(key, { at: Date.now(), ttl, fixtures });
  return fixtures;
}

/** GET /api/sports/fixtures?leagues=eng.1,esp.1&from=<ms>&to=<ms> */
export async function handleFixtures(_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const leagues = (params.get('leagues') ?? '').split(',').filter((id) => LEAGUE_BY_ID.has(id)).slice(0, 20);
  if (!leagues.length) return sendError(res, 400, 'No known leagues requested');
  const from = Number(params.get('from')) || Date.now() - 12 * 3_600_000;
  const to = Number(params.get('to')) || Date.now() + 24 * 3_600_000;
  if (to <= from || to - from > 3 * 86_400_000) return sendError(res, 400, 'Invalid time range');
  // ESPN dates are US-Eastern calendar days; ask for every UTC day the local window touches.
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const dates = `${ymd(from - 86_400_000)}-${ymd(to)}`;

  const results = await Promise.allSettled(leagues.map((id) => fetchLeague(id, dates)));
  const fixtures: Fixture[] = [];
  const errors: { league: string; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') fixtures.push(...r.value.filter((f) => f.state === 'in' || (f.start >= from && f.start < to)));
    else errors.push({ league: leagues[i], error: (r.reason as Error)?.cause ? String((r.reason as Error & { cause: { code?: string } }).cause.code ?? r.reason) : String((r.reason as Error).message) });
  });
  fixtures.sort((a, b) => a.start - b.start);
  sendJson(res, 200, { fixtures, errors, fetchedAt: Date.now() });
}
