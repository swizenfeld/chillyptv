import { useEffect, useMemo, useState } from 'react';
import { backendHealth } from '../lib/api';
import { normalize } from '../lib/search';
import { useCatalog } from './catalog';
import { programmesFor, useEpg } from './epg';
import { isCategoryLocked, isUnlocked, useSettings } from './settings';
import {
  broadcasterScore, channelNameScore, competitionHint, detectGuideFixture, fixtureKey, followKeys, isFollowed, prepareFixture, scorePrepared, stateAt, type Fixture,
} from '../../shared/sports';
import { compareRank, feedRank, type ChannelTags } from '../../shared/channels';
import { channelTags } from '../lib/channelTags';
import type { Channel, Programme } from '../lib/types';

const API = `${import.meta.env.BASE_URL}api`;

export interface MatchChannel {
  channel: Channel;
  /** 1 = guide or channel name names both teams; 0.6 = one team + competition; 0.35 = listed broadcaster. */
  score: number;
  programme?: Programme;
  via: 'guide' | 'channel' | 'broadcaster';
  tags: ChannelTags;
}

export interface SportsMatch {
  fixture: Fixture;
  state: Fixture['state'];
  /** Best feed first: confidence, then preferred language, then quality. */
  channels: MatchChannel[];
  /** One of the teams is followed. */
  followed: boolean;
}

export interface SportsDiagnostics {
  feed: 'ok' | 'off' | 'error';
  feedFixtures: number;
  /** Guide entries for today across all visible channels. */
  programmesToday: number;
  channelsWithGuide: number;
  channels: number;
}

export interface SportsToday {
  matches: SportsMatch[];
  /** Channels carrying at least one of today's matches, best first (zap order). */
  channels: Channel[];
  /** "feed" = online fixtures; "guide" = detected from the TV guide only. */
  source: 'feed' | 'guide';
  loading: boolean;
  feedError: string | null;
  diagnostics: SportsDiagnostics;
}

/** Today, plus whatever kicks off in the next 6 hours: late in the evening, after-midnight matches count. */
function todayWindow(now = Date.now()): { from: number; to: number } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime(), to: Math.max(d.getTime() + 86_400_000, now + 6 * 3_600_000) };
}

interface FeedState {
  fixtures: Fixture[] | null;
  error: string | null;
  loading: boolean;
}

/** Polls the server's fixtures feed (ESPN) for the tracked leagues. */
function useFixtureFeed(leagues: string[], enabled: boolean): FeedState {
  const [state, setState] = useState<FeedState>({ fixtures: null, error: null, loading: enabled });
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
        const body = (await res.json()) as { fixtures?: Fixture[]; errors?: { league: string; error: string }[]; leagues?: number; error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        // The feed is only "down" if every competition failed; one off-season league is not an outage.
        const failed = body.errors?.length ?? 0;
        const allFailed = failed > 0 && failed >= (body.leagues ?? leagues.length);
        setState({
          fixtures: allFailed ? null : (body.fixtures ?? []),
          error: allFailed ? `ESPN could not be reached from your ChillyPTV server (${body.errors![0].error})` : null,
          loading: false,
        });
        timer = window.setTimeout(load, body.fixtures?.some((f) => f.state === 'in') ? 60_000 : 5 * 60_000);
      } catch (e) {
        if (!alive) return;
        setState({ fixtures: null, error: (e as Error).message, loading: false });
        timer = window.setTimeout(load, 2 * 60_000);
      }
    };
    setState((s) => ({ ...s, loading: true }));
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

interface IndexedProgramme {
  channel: Channel;
  p: Programme;
  /** Normalised lazily: only entries near a kick-off (or with a competition hint) ever need it. */
  text?: string;
  title?: string;
}

const textOf = (ip: IndexedProgramme) => (ip.text ??= normalize(`${ip.p.title} ${ip.p.subtitle ?? ''} ${ip.p.desc ?? ''}`));
const titleOf = (ip: IndexedProgramme) => (ip.title ??= normalize(ip.p.title));

/**
 * Reorders ranked feeds so the first few come from different sources: a network carried by 190
 * local stations ("US| NBC NETWORK") would otherwise fill every slot with the same broadcast.
 * The first feed of each source keeps its rank; repeats follow in their original order.
 */
export function diversify(list: MatchChannel[]): MatchChannel[] {
  const seen = new Set<string>();
  const lead: MatchChannel[] = [];
  const rest: MatchChannel[] = [];
  for (const c of list) {
    const key = `${c.channel.categoryId}|${c.tags.lang ?? ''}|${c.tags.event === 'ended' ? 'ended' : ''}|${c.programme ? `${c.programme.start}|${c.programme.title}` : c.via}`;
    (seen.has(key) ? rest : lead).push(c);
    seen.add(key);
  }
  return [...lead, ...rest];
}

/**
 * Today's matches for the tracked competitions and the channels showing them.
 * Fixtures come from the online feed when the server can reach it, otherwise they
 * are detected from programme titles. Channels are found through the TV guide,
 * event/PPV channel names, and channels named after a listed broadcaster.
 */
export function useSportsToday(active = true): SportsToday {
  const settings = useSettings();
  const catalogState = useCatalog();
  const catalog = active ? catalogState.catalog : null;
  const index = active ? catalogState.index : null;
  const epgVersion = useEpg((s) => s.version);
  const online = active && settings.sportsOnline && !!backendHealth()?.ok;
  const feed = useFixtureFeed(settings.sportsLeagues, online);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Visible channels (hidden and locked categories excluded) with normalised names.
  const channels = useMemo(() => {
    if (!catalog || !index) return [];
    const hidden = new Set(settings.hiddenCategories);
    return catalog.channels
      .filter((ch) => !hidden.has(ch.categoryId) && (isUnlocked() || !isCategoryLocked(settings, ch.categoryId, index.categoryById.get(ch.categoryId)?.name ?? '')))
      .map((ch) => ({ ch, name: normalize(ch.name) }));
  }, [catalog, index, settings]);

  // Today's guide entries; text is normalised on demand.
  const guide = useMemo(() => {
    const { from, to } = todayWindow();
    const list: IndexedProgramme[] = [];
    let withGuide = 0;
    for (const { ch } of channels) {
      let any = false;
      for (const p of programmesFor(ch)) {
        if (p.end <= from - 3 * 3_600_000 || p.start >= to) continue;
        list.push({ channel: ch, p });
        any = true;
      }
      if (any) withGuide++;
    }
    return { list, withGuide };
  }, [channels, epgVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useMemo(() => {
    const source: 'feed' | 'guide' = feed.fixtures ? 'feed' : 'guide';
    let fixtures: Fixture[];
    if (feed.fixtures) {
      fixtures = feed.fixtures;
    } else {
      // Guide-only: one fixture per distinct match found in programme titles or event channel names.
      const hint = competitionHint(settings.sportsLeagues);
      const byKey = new Map<string, Fixture>();
      const add = (f: Fixture | null) => {
        if (!f) return;
        const k = fixtureKey(f);
        const prev = byKey.get(k);
        if (!prev || f.start < prev.start) byKey.set(k, f);
      };
      for (const ip of guide.list) if (hint.test(ip.p.title)) add(detectGuideFixture(ip.p, settings.sportsLeagues));
      const { from, to } = todayWindow();
      fixtures = [...byKey.values()].filter((f) => f.start >= from && f.start < to);
    }

    const prefs = { languages: settings.feedLanguages, maxQuality: settings.feedMaxQuality };
    const followed = settings.followedTeams.map((t) => followKeys(t.name));
    const tier = (score: number) => (score >= 1 ? 0 : score >= 0.6 ? 1 : 2);
    const matches: SportsMatch[] = fixtures.map((f) => {
      const pf = prepareFixture(f);
      const best = new Map<string, MatchChannel>();
      const offer = (m: MatchChannel) => {
        if (m.tags.event === 'idle') return; // "- NO EVENT STREAMING -" placeholder slots
        const prev = best.get(m.channel.id);
        if (!prev || m.score > prev.score) best.set(m.channel.id, m);
      };
      // 1. TV guide: only entries overlapping the match window are normalised and scored.
      const lo = f.start - 15 * 60_000;
      const hi = f.start + 115 * 60_000;
      for (const ip of guide.list) {
        if (ip.p.end <= lo || ip.p.start >= hi) continue;
        const score = scorePrepared(textOf(ip), ip.p.start, ip.p.end, pf, titleOf(ip));
        if (score) offer({ channel: ip.channel, score, programme: ip.p, via: 'guide', tags: channelTags(ip.channel) });
      }
      // 2. Event / PPV channels named after the match.
      for (const { ch, name } of channels) if (channelNameScore(name, pf)) offer({ channel: ch, score: 1, via: 'channel', tags: channelTags(ch) });
      // 3. Channels named after a listed broadcaster ("TNT Sports 1") are weaker hints.
      if (f.broadcasts.length) {
        let added = 0;
        for (const { ch } of channels) {
          if (added >= 6 || best.has(ch.id)) continue;
          if (broadcasterScore(ch.name, f)) {
            offer({ channel: ch, score: 0.35, via: 'broadcaster', tags: channelTags(ch) });
            added++;
          }
        }
      }
      // Event channels whose name says the event is over go last.
      const ranked = [...best.values()].map((c) => ({ c, e: c.tags.event === 'ended' ? 1 : 0, t: tier(c.score), r: feedRank(c.tags, prefs) }));
      ranked.sort((a, b) => a.e - b.e || a.t - b.t || compareRank(a.r, b.r) || a.c.channel.num - b.c.channel.num);
      return { fixture: f, state: stateAt(f, now), channels: diversify(ranked.map((x) => x.c)), followed: isFollowed(f.home, followed) || isFollowed(f.away, followed) };
    });

    const order = { in: 0, pre: 1, post: 2 } as const;
    matches.sort((a, b) => order[a.state] - order[b.state] || a.fixture.start - b.fixture.start);

    const seen = new Set<string>();
    const zap: Channel[] = [];
    for (const m of matches) {
      if (m.state === 'post') continue;
      for (const c of m.channels) {
        if (seen.has(c.channel.id)) continue;
        seen.add(c.channel.id);
        zap.push(c.channel);
      }
    }
    return { matches, channels: zap, source };
  }, [feed.fixtures, guide, channels, settings.sportsLeagues, settings.feedLanguages, settings.feedMaxQuality, settings.followedTeams, now]);

  return {
    ...result,
    loading: feed.loading,
    feedError: online ? feed.error : null,
    diagnostics: {
      feed: !online ? 'off' : feed.fixtures ? 'ok' : 'error',
      feedFixtures: feed.fixtures?.length ?? 0,
      programmesToday: guide.list.length,
      channelsWithGuide: guide.withGuide,
      channels: channels.length,
    },
  };
}
