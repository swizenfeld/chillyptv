import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { parseXmltv, type EpgData, type EpgProgrammeTuple } from '../../shared/xmltv';
import { backendHealth, epgEndpoint, fetchUpstreamText, proxyActive } from '../lib/api';
import { normalize, matchScore } from '../lib/search';
import { XtreamClient } from '../lib/xtream';
import type { Catalog, Channel, Profile, Programme } from '../lib/types';
import { useSettings } from './settings';

const STALE_MS = 6 * 60 * 60 * 1000;

interface EpgState {
  profileId: string | null;
  data: EpgData | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  version: number;
  load: (profile: Profile, catalog: Catalog, opts?: { force?: boolean }) => Promise<void>;
}

let resolver: { byId: Map<string, string>; byName: Map<string, string> } | null = null;
const resolvedCache = new Map<string, Programme[]>();

function buildResolver(data: EpgData): void {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const id of Object.keys(data.programmes)) byId.set(id.toLowerCase(), id);
  for (const ch of Object.values(data.channels)) {
    byId.set(ch.id.toLowerCase(), ch.id);
    const n = normalize(ch.name);
    if (n && !byName.has(n)) byName.set(n, ch.id);
  }
  resolver = { byId, byName };
  resolvedCache.clear();
}

function toProgramme(t: EpgProgrammeTuple, shiftMs: number): Programme {
  return { start: t[0] + shiftMs, end: t[1] + shiftMs, title: t[2], desc: t[3] || undefined, subtitle: t[4] || undefined, category: t[5] || undefined, episode: t[6] || undefined };
}

async function downloadEpg(url: string, profile: Profile, force: boolean): Promise<EpgData> {
  const s = useSettings.getState();
  if (proxyActive() && backendHealth()?.ok) {
    const res = await fetch(epgEndpoint(url, { ua: profile.userAgent, past: s.epgPastDays, future: s.epgFutureDays, refresh: force }));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `EPG HTTP ${res.status}`);
    }
    return (await res.json()) as EpgData;
  }
  const text = await fetchUpstreamText(url, { ua: profile.userAgent });
  const now = Date.now();
  return parseXmltv(text, { from: now - s.epgPastDays * 86_400_000, to: now + s.epgFutureDays * 86_400_000 });
}

function merge(a: EpgData, b: EpgData): EpgData {
  return {
    channels: { ...b.channels, ...a.channels },
    programmes: { ...b.programmes, ...a.programmes },
    fetchedAt: Math.min(a.fetchedAt, b.fetchedAt),
  };
}

export const useEpg = create<EpgState>()((set, get) => ({
  profileId: null,
  data: null,
  status: 'idle',
  error: null,
  version: 0,
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
    if (current && !opts.force && Date.now() - current.fetchedAt < STALE_MS) return;
    const urls = catalog.epgUrls.filter(Boolean);
    if (!urls.length) {
      set({ status: current ? 'ready' : 'idle' });
      return;
    }
    set({ status: current ? 'ready' : 'loading', error: null });
    try {
      let merged: EpgData | null = null;
      const errors: string[] = [];
      for (const url of urls.slice(0, 4)) {
        try {
          const d = await downloadEpg(url, profile, !!opts.force);
          merged = merged ? merge(merged, d) : d;
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      if (get().profileId !== profile.id) return;
      if (!merged) throw new Error(errors[0] ?? 'EPG unavailable');
      buildResolver(merged);
      await idbSet(`epg:${profile.id}`, merged).catch(() => {});
      set({ data: merged, status: 'ready', error: null, version: get().version + 1 });
    } catch (e) {
      if (get().profileId !== profile.id) return;
      set({ status: current ? 'ready' : 'error', error: (e as Error).message });
    }
  },
}));

/** Resolves programmes for a channel from the loaded XMLTV (sync, cached). */
export function programmesFor(ch: Channel | undefined): Programme[] {
  if (!ch) return [];
  const data = useEpg.getState().data;
  if (!data || !resolver) return [];
  const cached = resolvedCache.get(ch.id);
  if (cached) return cached;
  let key = ch.epgId ? resolver.byId.get(ch.epgId.toLowerCase()) : undefined;
  if (!key) key = resolver.byName.get(normalize(ch.name));
  if (!key && ch.epgId) key = resolver.byName.get(normalize(ch.epgId));
  const shift = useSettings.getState().epgShiftHours * 3_600_000;
  const list = key ? (data.programmes[key] ?? []).map((t) => toProgramme(t, shift)) : [];
  resolvedCache.set(ch.id, list);
  return list;
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
