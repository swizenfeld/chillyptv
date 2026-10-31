import { useEffect, useMemo, useState } from 'react';
import { backendHealth } from '../lib/api';
import { normalize } from '../lib/search';
import { useCatalog } from './catalog';
import { programmesFor, useEpg } from './epg';
import { isCategoryLocked, isUnlocked, useSettings } from './settings';
import { broadcasterScore, detectGuideFixture, fixtureKey, prepareFixture, scorePrepared, stateAt, type Fixture } from '../../shared/sports';
import type { Channel, Programme } from '../lib/types';

const API = `${import.meta.env.BASE_URL}api`;

export interface MatchChannel {
  channel: Channel;
  /** 1 = guide names both teams; 0.6 = one team + competition; 0.35 = channel is a listed broadcaster. */
  score: number;
  programme?: Programme;
  via: 'guide' | 'broadcaster';
}

export interface SportsMatch {
  fixture: Fixture;
  state: Fixture['state'];
  channels: MatchChannel[];
}

export interface SportsToday {
  matches: SportsMatch[];
  /** Channels carrying at least one of today's matches, best first (zap order). */
  channels: Channel[];
  /** "feed" = online fixtures; "guide" = detected from the TV guide only. */
  source: 'feed' | 'guide';
  loading: boolean;
  feedError: string | null;
}

function todayWindow(now = Date.now()): { from: number; to: number } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime(), to: d.getTime() + 86_400_000 };
}

/** Polls the server's fixtures feed (ESPN) for the tracked leagues. */
function useFixtureFeed(leagues: string[], enabled: boolean): { fixtures: Fixture[] | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ fixtures: Fixture[] | null; error: string | null; loading: boolean }>({ fixtures: null, error: null, loading: enabled });
  const key = leagues.join(',');
  useEffect(() => {
    if (!enabled || !key) {
      setState({ fixtures: null, error: null, loading: false });
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      const { from, to } = todayWindow();
      try {
        const res = await fetch(`${API}/sports/fixtures?${new URLSearchParams({ leagues: key, from: String(from), to: String(to) })}`, { cache: 'no-store' });
        const body = (await res.json()) as { fixtures?: Fixture[]; errors?: { league: string; error: string }[]; error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const all = body.errors?.length && !body.fixtures?.length;
        setState({ fixtures: all ? null : (body.fixtures ?? []), error: all ? `Fixtures feed unavailable (${body.errors![0].error})` : null, loading: false });
        const live = body.fixtures?.some((f) => f.state === 'in');
        timer = window.setTimeout(load, live ? 60_000 : 5 * 60_000);
      } catch (e) {
        if (!alive) return;
        setState({ fixtures: null, error: (e as Error).message, loading: false });
        timer = window.setTimeout(load, 5 * 60_000);
      }
    };
    setState((s) => ({ ...s, loading: true }));
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key, enabled]);
  return state;
}

interface IndexedProgramme {
  channel: Channel;
  p: Programme;
  text: string;
  title: string;
}

/**
 * Today's matches for the tracked competitions and the channels showing them.
 * Uses the online fixtures feed when the server can reach it, otherwise detects
 * matches straight from programme titles in the TV guide.
 */
export function useSportsToday(): SportsToday {
  const settings = useSettings();
  const { catalog, index } = useCatalog();
  const epgVersion = useEpg((s) => s.version);
  const online = settings.sportsOnline && !!backendHealth()?.ok;
  const feed = useFixtureFeed(settings.sportsLeagues, online);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Today's programmes on every visible channel, text normalised once.
  const programmes = useMemo<IndexedProgramme[]>(() => {
    if (!catalog || !index) return [];
    const { from, to } = todayWindow();
    const hidden = new Set(settings.hiddenCategories);
    const out: IndexedProgramme[] = [];
    for (const ch of catalog.channels) {
      if (hidden.has(ch.categoryId)) continue;
      if (!isUnlocked() && isCategoryLocked(settings, ch.categoryId, index.categoryById.get(ch.categoryId)?.name ?? '')) continue;
      for (const p of programmesFor(ch)) {
        if (p.end <= from - 3 * 3_600_000 || p.start >= to) continue;
        out.push({ channel: ch, p, text: normalize(`${p.title} ${p.subtitle ?? ''} ${p.desc ?? ''}`), title: normalize(p.title) });
      }
    }
    return out;
  }, [catalog, index, epgVersion, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useMemo(() => {
    const source: 'feed' | 'guide' = feed.fixtures ? 'feed' : 'guide';
    let fixtures: Fixture[];
    if (feed.fixtures) {
      fixtures = feed.fixtures;
    } else {
      // Guide-only: one fixture per distinct match found in programme titles.
      const byKey = new Map<string, Fixture>();
      for (const { p } of programmes) {
        const f = detectGuideFixture(p, settings.sportsLeagues);
        if (!f) continue;
        const k = fixtureKey(f);
        const prev = byKey.get(k);
        if (!prev || f.start < prev.start) byKey.set(k, f);
      }
      const { from, to } = todayWindow();
      fixtures = [...byKey.values()].filter((f) => f.start >= from && f.start < to);
    }

    const matches: SportsMatch[] = fixtures.map((f) => {
      const pf = prepareFixture(f);
      const best = new Map<string, MatchChannel>();
      for (const ip of programmes) {
        const score = scorePrepared(ip.text, ip.p.start, ip.p.end, pf, ip.title);
        if (!score) continue;
        const prev = best.get(ip.channel.id);
        if (!prev || score > prev.score) best.set(ip.channel.id, { channel: ip.channel, score, programme: ip.p, via: 'guide' });
      }
      // Channels named after a listed broadcaster ("TNT Sports 1") are weaker hints.
      if (f.broadcasts.length && catalog) {
        let added = 0;
        for (const ch of catalog.channels) {
          if (added >= 6 || best.has(ch.id)) continue;
          const score = broadcasterScore(ch.name, f);
          if (score) {
            best.set(ch.id, { channel: ch, score, via: 'broadcaster' });
            added++;
          }
        }
      }
      const channels = [...best.values()].sort((a, b) => b.score - a.score || a.channel.num - b.channel.num);
      return { fixture: f, state: stateAt(f, now), channels };
    });

    const order = { in: 0, pre: 1, post: 2 } as const;
    matches.sort((a, b) => order[a.state] - order[b.state] || a.fixture.start - b.fixture.start);

    const seen = new Set<string>();
    const channels: Channel[] = [];
    for (const m of matches) {
      if (m.state === 'post') continue;
      for (const c of m.channels) {
        if (seen.has(c.channel.id)) continue;
        seen.add(c.channel.id);
        channels.push(c.channel);
      }
    }
    return { matches, channels, source };
  }, [feed.fixtures, programmes, settings.sportsLeagues, catalog, now]);

  return { ...result, loading: feed.loading, feedError: online ? feed.error : null };
}
