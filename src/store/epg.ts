import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { parseXmltv, type EpgData, type EpgProgrammeTuple } from '../../shared/xmltv';
import { backendHealth, epgEndpoint, fetchUpstreamText, proxyActive } from '../lib/api';
import { normalize, matchScore } from '../lib/search';
import { XtreamClient } from '../lib/xtream';
import type { Catalog, Channel, Profile, Programme } from '../lib/types';
import { useSettings } from './settings';
import { useLibrary } from './library';
import { useCatalog } from './catalog';
import { autoGuideKey, buildGuideResolver, listingCount, trimGuide, type GuideResolver, type GuideWant } from '../../shared/guide';
import { eventListing } from '../../shared/events';
import { channelTags } from '../lib/channelTags';

const STALE_MS = 6 * 60 * 60 * 1000;

export interface EpgSourceStatus {
  url: string;
  ok: boolean;
  channels: number;
  error?: string;
}

interface EpgState {
  profileId: string | null;
  data: EpgData | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  version: number;
  /** Result of the last download, per guide source. */
  sources: EpgSourceStatus[];
  /** Forget resolved channel → guide links (after a manual fix). */
  invalidate: () => void;
  /** `force` re-downloads on the server too; `refetch` only skips the "still fresh" check. */
  load: (profile: Profile, catalog: Catalog, opts?: { force?: boolean; refetch?: boolean }) => Promise<void>;
}

let resolver: GuideResolver | null = null;
let loadGeneration = 0;
// Keyed by channel id; the channel object is kept so a playlist refresh (new event names) recomputes.
const resolvedCache = new Map<string, { ch: Channel; list: Programme[] }>();

function buildResolver(data: EpgData): void {
  resolver = buildGuideResolver(data);
  resolvedCache.clear();
}

/** Guide channel key for a catalogue channel: manual fix first, then id, name and cleaned name. */
export function resolveGuideKey(ch: Channel, depth = 0): string | undefined {
  if (!resolver) return undefined;
  const profileId = useEpg.getState().profileId;
  const override = profileId ? useLibrary.getState().epgOverrides[profileId]?.[ch.id] : undefined;
  if (override?.startsWith('x:')) return override.slice(2);
  if (override?.startsWith('c:') && depth < 3) {
    const other = useCatalog.getState().index?.channelById.get(override.slice(2));
    if (other) return resolveGuideKey(other, depth + 1);
  }
  return autoGuideKey(resolver, ch.epgId, ch.name, channelTags(ch).base);
}

/** How the channel's guide was found, for the "Fix guide" dialog. */
export function guideLinkKind(ch: Channel): 'manual' | 'borrowed' | 'auto' | 'none' {
  const profileId = useEpg.getState().profileId;
  const override = profileId ? useLibrary.getState().epgOverrides[profileId]?.[ch.id] : undefined;
  if (override?.startsWith('x:')) return 'manual';
  if (override?.startsWith('c:')) return 'borrowed';
  return resolveGuideKey(ch) ? 'auto' : 'none';
}

function toProgramme(t: EpgProgrammeTuple, shiftMs: number): Programme {
  return { start: t[0] + shiftMs, end: t[1] + shiftMs, title: t[2], desc: t[3] || undefined, subtitle: t[4] || undefined, category: t[5] || undefined, episode: t[6] || undefined };
}

/**
 * What the guide must cover: every playlist channel ([guide id, name]) and the guide channels
 * picked by hand in "Fix guide". Everything else is dropped — on a big provider most of the guide
 * describes channels the playlist doesn't have.
 */
function guideWants(profile: Profile, catalog: Catalog): { wants: GuideWant[]; keep: string[] } {
  const overrides = useLibrary.getState().epgOverrides[profile.id] ?? {};
  return {
    wants: catalog.channels.map((c) => [c.epgId ?? '', c.name]),
    keep: Object.values(overrides).filter((v) => v.startsWith('x:')).map((v) => v.slice(2)),
  };
}

async function downloadEpg(url: string, profile: Profile, catalog: Catalog, force: boolean): Promise<EpgData> {
  const s = useSettings.getState();
  const { wants, keep } = guideWants(profile, catalog);
  if (proxyActive() && backendHealth()?.ok) {
    const res = await fetch(epgEndpoint(url, { ua: profile.userAgent, past: s.epgPastDays, future: s.epgFutureDays, refresh: force }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wants, keep }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `EPG HTTP ${res.status}`);
    }
    return (await res.json()) as EpgData;
  }
  const text = await fetchUpstreamText(url, { ua: profile.userAgent });
  const now = Date.now();
  return trimGuide(parseXmltv(text, { from: now - s.epgPastDays * 86_400_000, to: now + s.epgFutureDays * 86_400_000 }), wants, keep);
}

/** `a` (earlier source) wins for channels both have; `b` fills the rest. */
function merge(a: EpgData, b: EpgData): EpgData {
  const programmes = { ...a.programmes };
  for (const [id, list] of Object.entries(b.programmes)) if (!programmes[id]?.length) programmes[id] = list;
  const counts = a.counts || b.counts ? { ...(b.counts ?? {}), ...(a.counts ?? {}) } : undefined;
  return { channels: { ...b.channels, ...a.channels }, programmes, fetchedAt: Math.min(a.fetchedAt, b.fetchedAt), ...(counts ? { counts } : {}) };
}

export const useEpg = create<EpgState>()((set, get) => ({
  profileId: null,
  data: null,
  status: 'idle',
  error: null,
  version: 0,
  sources: [],
  invalidate: () => {
    resolvedCache.clear();
    set({ version: get().version + 1 });
  },
  load: async (profile, catalog, opts = {}) => {
    const switching = get().profileId !== profile.id;
    if (switching) {
      resolver = null;
      resolvedCache.clear();
      xtreamCache.clear();
      set({ profileId: profile.id, data: null, status: 'loading', error: null, version: get().version + 1 });
      const cached = await idbGet<EpgData>(`epg:${profile.id}`).catch(() => undefined);
      if (get().profileId !== profile.id) return;
      if (cached) {
        buildResolver(cached);
        set({ data: cached, status: 'ready', version: get().version + 1 });
      }
    }
    const current = get().data;
    // A trimmed guide must be fetched again when the playlist gains channels it has no listings for.
    const missing = () => !!current?.counts && catalog.channels.some((ch) => {
      const k = resolveGuideKey(ch);
      return !!k && !current.programmes[k] && (current.counts![k] ?? 0) > 0;
    });
    if (current && !opts.force && !opts.refetch && Date.now() - current.fetchedAt < STALE_MS && !missing()) return;
    // Provider guide first; extra sources only fill channels it lacks.
    const urls = [...new Set([...catalog.epgUrls, ...(profile.extraEpgUrls ?? [])].map((u) => u.trim()).filter(Boolean))];
    if (!urls.length) {
      set({ status: current ? 'ready' : 'idle' });
      return;
    }
    set({ status: current ? 'ready' : 'loading', error: null });
    // Only the newest download may land: an older one (started before a guide channel was linked
    // by hand) finishing last would drop that channel's listings.
    const gen = ++loadGeneration;
    try {
      let merged: EpgData | null = null;
      const sources: EpgSourceStatus[] = [];
      for (const url of urls.slice(0, 8)) {
        try {
          const d = await downloadEpg(url, profile, catalog, !!opts.force);
          merged = merged ? merge(merged, d) : d;
          sources.push({ url, ok: true, channels: Object.keys(d.counts ?? d.programmes).length });
        } catch (e) {
          sources.push({ url, ok: false, channels: 0, error: (e as Error).message });
        }
      }
      if (get().profileId !== profile.id || gen !== loadGeneration) return;
      if (!merged) throw new Error(sources.find((x) => x.error)?.error ?? 'EPG unavailable');
      // Resolver and data must change together: a render in between would resolve against the
      // new guide's keys but read the old guide's listings, and cache an empty list.
      buildResolver(merged);
      set({ data: merged, status: 'ready', error: null, sources, version: get().version + 1 });
      await idbSet(`epg:${profile.id}`, merged).catch(() => {});
    } catch (e) {
      if (get().profileId !== profile.id || gen !== loadGeneration) return;
      set({ status: current ? 'ready' : 'error', error: (e as Error).message });
    }
  },
}));

const eventCache = new WeakMap<Channel, Programme[]>();

/**
 * A listing built from an event channel's own name ("US (ESPN+ 166) | Green Bay vs. Milwaukee
 * (2026-10-31 14:03:05)"). Keyed by channel object: a playlist refresh brings new names.
 */
function eventProgrammes(ch: Channel): Programme[] {
  let list = eventCache.get(ch);
  if (!list) {
    const e = eventListing(ch.name);
    list = e ? [{ start: e.start, end: e.end, title: e.title, category: e.category, fromName: true }] : [];
    eventCache.set(ch, list);
  }
  return list;
}

/** Resolves programmes for a channel from the loaded XMLTV, or from its name for event channels (sync, cached). */
export function programmesFor(ch: Channel | undefined): Programme[] {
  if (!ch) return [];
  const data = useEpg.getState().data;
  if (!data || !resolver) return eventProgrammes(ch);
  const cached = resolvedCache.get(ch.id);
  if (cached?.ch === ch) return cached.list;
  const key = resolveGuideKey(ch);
  const shift = useSettings.getState().epgShiftHours * 3_600_000;
  let list = key ? (data.programmes[key] ?? []).map((t) => toProgramme(t, shift)) : [];
  if (!list.length) list = eventProgrammes(ch);
  resolvedCache.set(ch.id, { ch, list });
  return list;
}

/** Guide channels with listings, for the manual "Fix guide" picker. */
export function guideChannelHasListings(id: string): boolean {
  const data = useEpg.getState().data;
  return !!data && listingCount(data, id) > 0;
}

export function nowNext(list: Programme[], now = Date.now()): { now?: Programme; next?: Programme } {
  let lo = 0;
  let hi = list.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= now) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const cur = idx >= 0 && list[idx].end > now ? list[idx] : undefined;
  const next = list[idx + 1] ?? (idx < 0 ? list[0] : undefined);
  return { now: cur, next };
}

// ---- Xtream per-channel fallback ---------------------------------------------
const xtreamCache = new Map<string, { at: number; list: Programme[]; promise?: Promise<Programme[]> }>();

export function fetchXtreamEpg(profile: Profile, ch: Channel): Promise<Programme[]> {
  const key = `${profile.id}:${ch.id}`;
  const hit = xtreamCache.get(key);
  if (hit && (hit.promise || Date.now() - hit.at < 10 * 60_000)) return hit.promise ?? Promise.resolve(hit.list);
  const promise = new XtreamClient(profile)
    .channelEpg(ch.id)
    .catch(() => new XtreamClient(profile).shortEpg(ch.id, 10))
    .catch(() => [] as Programme[])
    .then((list) => {
      xtreamCache.set(key, { at: Date.now(), list });
      return list;
    });
  xtreamCache.set(key, { at: Date.now(), list: hit?.list ?? [], promise });
  return promise;
}

/**
 * Programmes for a channel: XMLTV first, falling back to the Xtream API.
 * Re-renders when the EPG store changes.
 */
export function useChannelProgrammes(profile: Profile | null, ch: Channel | undefined, opts: { needArchive?: boolean } = {}): { list: Programme[]; loading: boolean } {
  const version = useEpg((s) => s.version);
  const [extra, setExtra] = useState<{ id: string; list: Programme[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const xml = programmesFor(ch);
  void version;
  const wantXtream = !!profile && profile.type === 'xtream' && !!ch && (xml.length === 0 || !!(opts.needArchive && ch.archive));
  useEffect(() => {
    if (!wantXtream || !profile || !ch) return;
    let alive = true;
    setLoading(true);
    fetchXtreamEpg(profile, ch).then((list) => {
      if (!alive) return;
      setExtra({ id: ch.id, list });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [wantXtream, profile, ch]);
  if (wantXtream && extra?.id === ch?.id && extra.list.length) {
    if (!xml.length) return { list: extra.list, loading: false };
    // Combine: XMLTV for details, Xtream for archive flags.
    const archived = new Set(extra.list.filter((p) => p.archive).map((p) => p.start));
    return { list: xml.map((p) => (archived.has(p.start) ? { ...p, archive: true } : p)), loading: false };
  }
  return { list: xml, loading: wantXtream && loading };
}

export interface EpgSearchHit {
  channel: Channel;
  programme: Programme;
  score: number;
}

/** Full-text search across all loaded programmes ("where is the match on?"). */
export function searchProgrammes(channels: Channel[], query: string, limit = 80): EpgSearchHit[] {
  if (!normalize(query)) return [];
  const now = Date.now();
  const hits: EpgSearchHit[] = [];
  for (const ch of channels) {
    for (const p of programmesFor(ch)) {
      if (p.end < now - 3 * 86_400_000) continue;
      const score = matchScore(query, p.title) || matchScore(query, `${p.title} ${p.subtitle ?? ''} ${p.category ?? ''}`) * 0.5;
      if (score > 0) hits.push({ channel: ch, programme: p, score: score + (p.end > now ? 50 : 0) - Math.abs(p.start - now) / 3_600_000 });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
