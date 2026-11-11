import { useEffect, useMemo, useState } from 'react';
import { backendHealth } from '../lib/api';
import { isNativeApp } from '../native/player';
import { collectFixtures } from '../../shared/fixtures';
import { normalize } from '../lib/search';
import { useCatalog } from './catalog';
import { programmesBetween, useEpg } from './epg';
import { isCategoryLocked, isUnlocked, useSettings } from './settings';
import {
  broadcasterNames, channelNameScore, competitionHint, detectGuideFixture, fixtureKey, followKeys, isFollowed, prepareFixture, scorePrepared, stateAt, type Fixture,
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
        let body: { fixtures?: Fixture[]; errors?: { league: string; error: string }[]; leagues?: number; error?: string };
        if (isNativeApp()) {
          // The Android / Fire TV app has no ChillyPTV server: it asks ESPN itself.
          body = await collectFixtures(key.split(','), from, to, async (url) => {
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          });
        } else {
          const res = await fetch(`${API}/sports/fixtures?${new URLSearchParams({ leagues: key, from: String(from), to: String(to) })}`, { cache: 'no-store' });
          body = await res.json();
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        if (!alive) return;
        // The feed is only "down" if every competition failed; one off-season league is not an outage.
        const failed = body.errors?.length ?? 0;
        const allFailed = failed > 0 && failed >= (body.leagues ?? leagues.length);
        setState({
          fixtures: allFailed ? null : (body.fixtures ?? []),
          error: allFailed ? `ESPN could not be reached${isNativeApp() ? '' : ' from your ChillyPTV server'} (${body.errors![0].error})` : null,
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

export interface IndexedProgramme {
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

/** A playlist channel as matching needs it: normalised name and cleaned base name, read once. */
export interface IndexedChannel {
  ch: Channel;
  name: string;
  base: string;
}

/**
 * Channels by the words of their names, so a match only checks channels that could name it
 * (a playlist has 15,000 channels; a team or broadcaster name appears in a handful).
 */
export interface ChannelIndex {
  list: IndexedChannel[];
  byWord: Map<string, number[]>;
  byBaseWord: Map<string, number[]>;
}

export function indexChannels(list: IndexedChannel[]): ChannelIndex {
  const byWord = new Map<string, number[]>();
  const byBaseWord = new Map<string, number[]>();
  const add = (m: Map<string, number[]>, w: string, i: number) => {
    if (!w) return;
    const a = m.get(w);
    if (!a) m.set(w, [i]);
    else if (a[a.length - 1] !== i) a.push(i);
  };
  list.forEach((c, i) => {
    for (const w of c.name.split(' ')) add(byWord, w, i);
    add(byBaseWord, c.base.split(' ')[0], i);
  });
  return { list, byWord, byBaseWord };
}

/** Indices of channels whose name has the first word of any of `phrases`, in playlist order. */
function withFirstWords(m: Map<string, number[]>, phrases: string[]): number[] {
  const out = new Set<number>();
  for (const p of phrases) for (const i of m.get(p.split(' ')[0]) ?? []) out.add(i);
  return [...out].sort((a, b) => a - b);
}

export interface MatchedFixture {
  fixture: Fixture;
  /** Every channel found for it, unordered: ranking by your preferences is cheap and done after. */
  found: MatchChannel[];
}

/** Best feed first: event slots that ended last, then confidence, your language, quality. */
export function rankFeeds(found: MatchChannel[], prefs: { languages: string[]; maxQuality: Parameters<typeof feedRank>[1]['maxQuality'] }): MatchChannel[] {
  const tier = (score: number) => (score >= 1 ? 0 : score >= 0.6 ? 1 : 2);
  const ranked = found.map((c) => ({ c, e: c.tags.event === 'ended' ? 1 : 0, t: tier(c.score), r: feedRank(c.tags, prefs) }));
  ranked.sort((a, b) => a.e - b.e || a.t - b.t || compareRank(a.r, b.r) || a.c.channel.num - b.c.channel.num);
  return diversify(ranked.map((x) => x.c));
}

/**
 * The channels showing each fixture, best first. Pure and independent of the clock: it reruns
 * when fixtures, the guide or the channels change, not every minute.
 */
export function matchFixtures(fixtures: Fixture[], idx: ChannelIndex, guideList: IndexedProgramme[]): MatchedFixture[] {
  return fixtures.map((f) => {
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
    for (const ip of guideList) {
      if (ip.p.end <= lo || ip.p.start >= hi) continue;
      const score = scorePrepared(textOf(ip), ip.p.start, ip.p.end, pf, titleOf(ip));
      if (score) offer({ channel: ip.channel, score, programme: ip.p, via: 'guide', tags: channelTags(ip.channel) });
    }
    // 2. Event / PPV channels named after the match: only channels with a home-team word can be.
    for (const i of withFirstWords(idx.byWord, pf.home)) {
      const { ch, name } = idx.list[i];
      if (channelNameScore(name, pf)) offer({ channel: ch, score: 1, via: 'channel', tags: channelTags(ch) });
    }
    // 3. Channels named after a listed broadcaster ("TNT Sports 1") are weaker hints.
    const bnames = broadcasterNames(f);
    if (bnames.length) {
      let added = 0;
      for (const i of withFirstWords(idx.byBaseWord, bnames)) {
        if (added >= 6) break;
        const { ch, base } = idx.list[i];
        if (best.has(ch.id)) continue;
        if (bnames.some((n) => base === n || base.startsWith(`${n} `))) {
          offer({ channel: ch, score: 0.35, via: 'broadcaster', tags: channelTags(ch) });
          added++;
        }
      }
    }
    return { fixture: f, found: [...best.values()] };
  });
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
  const online = active && settings.sportsOnline && (!!backendHealth()?.ok || isNativeApp());
  const feed = useFixtureFeed(settings.sportsLeagues, online);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Visible channels (hidden and locked categories excluded) with normalised names. Only the
  // settings that change which channels are visible recompute it (not, say, the commentary choice).
  const { hiddenCategories, pin, lockedCategories, autoLockAdult } = settings;
  const channels = useMemo<IndexedChannel[]>(() => {
    if (!catalog || !index) return [];
    const hidden = new Set(hiddenCategories);
    const lock = { ...settings, hiddenCategories, pin, lockedCategories, autoLockAdult };
    return catalog.channels
      .filter((ch) => !hidden.has(ch.categoryId) && (isUnlocked() || !isCategoryLocked(lock, ch.categoryId, index.categoryById.get(ch.categoryId)?.name ?? '')))
      .map((ch) => ({ ch, name: normalize(ch.name), base: channelTags(ch).base }));
  }, [catalog, index, hiddenCategories, pin, lockedCategories, autoLockAdult]); // eslint-disable-line react-hooks/exhaustive-deps
  const channelIndex = useMemo(() => indexChannels(channels), [channels]);

  // Today's guide entries; text is normalised on demand.
  const guide = useMemo(() => {
    const { from, to } = todayWindow();
    const list: IndexedProgramme[] = [];
    let withGuide = 0;
    for (const { ch } of channels) {
      let any = false;
      for (const p of programmesBetween(ch, from - 3 * 3_600_000, to)) {
        list.push({ channel: ch, p });
        any = true;
      }
      if (any) withGuide++;
    }
    return { list, withGuide };
  }, [channels, epgVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixtures = useMemo<{ list: Fixture[]; source: 'feed' | 'guide' }>(() => {
    if (feed.fixtures) return { list: feed.fixtures, source: 'feed' };
    // The online fixtures are on their way: don't detect matches from guide titles only to drop
    // them a moment later.
    if (online && !feed.error) return { list: [], source: 'feed' };
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
    return { list: [...byKey.values()].filter((f) => f.start >= from && f.start < to), source: 'guide' };
  }, [feed.fixtures, feed.loading, feed.error, online, guide, settings.sportsLeagues]);

  // The heavy part: which channels show each match. Independent of the clock and of scores: it
  // reruns when the fixtures themselves (teams, kick-off, broadcasters), the guide or the channels
  // change, and works through the matches in slices so the remote stays responsive meanwhile.
  const fixtureSig = useMemo(() => fixtures.list.map((f) => `${f.id}|${f.start}|${f.home.name}|${f.away.name}|${f.broadcasts.join(',')}`).join(';'), [fixtures]);
  const [matched, setMatched] = useState<{ sig: string; byId: Map<string, MatchedFixture> }>({ sig: '', byId: new Map() });
  const { feedLanguages, feedMaxQuality, followedTeams } = settings;
  useEffect(() => {
    const list = fixtures.list;
    const byId = new Map<string, MatchedFixture>();
    let i = 0;
    let timer = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 12) {
        const [m] = matchFixtures([list[i++]], channelIndex, guide.list);
        byId.set(m.fixture.id, m);
      }
      if (i < list.length) timer = window.setTimeout(step, 0);
      else setMatched({ sig: fixtureSig, byId });
    };
    timer = window.setTimeout(step, 0);
    return () => window.clearTimeout(timer);
  }, [fixtureSig, channelIndex, guide]); // eslint-disable-line react-hooks/exhaustive-deps
  const matching = matched.sig !== fixtureSig;

  // Every minute only the live / finished state and the order change: cheap.
  const result = useMemo(() => {
    // Until the first matching is done there's nothing to show (not "no channels" for every match).
    if (matching && !matched.byId.size) return { matches: [] as SportsMatch[], channels: [] as Channel[], source: fixtures.source };
    // The latest fixture objects (scores, minute) with the channels found for them.
    // Ranking by your language and quality, and your teams, apply at once when you change them.
    const prefs = { languages: feedLanguages, maxQuality: feedMaxQuality };
    const followed = followedTeams.map((t) => followKeys(t.name));
    const matches: SportsMatch[] = fixtures.list.map((f) => {
      const m = matched.byId.get(f.id);
      return { fixture: f, state: stateAt(f, now), channels: m ? rankFeeds(m.found, prefs) : [], followed: isFollowed(f.home, followed) || isFollowed(f.away, followed) };
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
    return { matches, channels: zap, source: fixtures.source };
  }, [matched, matching, fixtures, now, feedLanguages, feedMaxQuality, followedTeams]);

  return {
    ...result,
    loading: feed.loading || matching,
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
