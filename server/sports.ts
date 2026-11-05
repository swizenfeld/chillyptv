import type { IncomingMessage, ServerResponse } from 'node:http';
import { LEAGUE_BY_ID } from '../shared/sports.js';
import { collectFixtures, ESPN_SOCCER } from '../shared/fixtures.js';
import { DEFAULT_UA, sendError, sendJson } from './util.js';

const BASE = process.env.CHILLY_FIXTURES_BASE ?? ESPN_SOCCER;

const fetchJson = async (url: string) => {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': DEFAULT_UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** GET /api/sports/fixtures?leagues=eng.1,esp.1&from=<ms>&to=<ms> (CHILLY_FIXTURES_BASE overrides ESPN, for tests). */
export async function handleFixtures(_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const leagues = [...new Set((params.get('leagues') ?? '').split(','))].filter((id) => LEAGUE_BY_ID.has(id));
  if (!leagues.length) return sendError(res, 400, 'No known leagues requested');
  const from = Number(params.get('from')) || Date.now() - 12 * 3_600_000;
  const to = Number(params.get('to')) || Date.now() + 24 * 3_600_000;
  if (to <= from || to - from > 3 * 86_400_000) return sendError(res, 400, 'Invalid time range');
  const result = await collectFixtures(leagues, from, to, fetchJson, BASE);
  if (result.errors.length) console.warn(`[sports] fixtures unavailable for ${result.errors.map((e) => `${e.league} (${e.error})`).join(', ')}`);
  sendJson(res, 200, result);
}
