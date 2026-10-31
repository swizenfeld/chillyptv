import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { XtreamClient } from '../lib/xtream';
import { catalogFromM3u } from '../lib/m3uSource';
import { explainSourceError, fetchUpstreamText } from '../lib/api';
import type { AccountInfo, Catalog, Category, Channel, ContentKind, Movie, Profile, SeriesItem } from '../lib/types';

const STALE_MS = 12 * 60 * 60 * 1000;

interface Indexes {
  channelById: Map<string, Channel>;
  movieById: Map<string, Movie>;
  seriesById: Map<string, SeriesItem>;
  categoryById: Map<string, Category>;
  channelsByCategory: Map<string, Channel[]>;
}

interface CatalogState {
  profileId: string | null;
  catalog: Catalog | null;
  index: Indexes | null;
  account: AccountInfo | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  refreshing: boolean;
  error: string | null;
  load: (profile: Profile, opts?: { force?: boolean }) => Promise<void>;
  clear: () => void;
}

function buildIndex(c: Catalog): Indexes {
  const channelsByCategory = new Map<string, Channel[]>();
  for (const ch of c.channels) {
    let list = channelsByCategory.get(ch.categoryId);
    if (!list) channelsByCategory.set(ch.categoryId, (list = []));
    list.push(ch);
  }
  return {
    channelById: new Map(c.channels.map((x) => [x.id, x])),
    movieById: new Map(c.movies.map((x) => [x.id, x])),
    seriesById: new Map(c.series.map((x) => [x.id, x])),
    categoryById: new Map([...c.categories.live, ...c.categories.movie, ...c.categories.series].map((x) => [x.id, x])),
    channelsByCategory,
  };
}

export async function fetchCatalog(profile: Profile, signal?: AbortSignal): Promise<{ catalog: Catalog; account: AccountInfo | null }> {
  if (profile.type === 'xtream') {
    const client = new XtreamClient(profile);
    const account = await client.account(signal);
    const catalog = await client.catalog(signal);
    if (profile.epgUrl) catalog.epgUrls = [profile.epgUrl];
    return { catalog, account };
  }
  let text: string | undefined;
  if (profile.m3uUrl) {
    try {
      text = await fetchUpstreamText(profile.m3uUrl, { ua: profile.userAgent, signal });
    } catch (e) {
      throw explainSourceError(e, profile.m3uUrl, 'm3u');
    }
  }
  else text = await idbGet<string>(`m3u:${profile.id}`);
  if (!text) throw new Error('Playlist is empty or missing.');
  if (!text.trimStart().startsWith('#EXTM3U') && !text.includes('#EXTINF')) throw new Error('That does not look like an M3U playlist.');
  const catalog = catalogFromM3u(profile.id, text);
  if (profile.epgUrl) catalog.epgUrls = [profile.epgUrl];
  return { catalog, account: null };
}

let inflight: AbortController | null = null;

export const useCatalog = create<CatalogState>()((set, get) => ({
  profileId: null,
  catalog: null,
  index: null,
  account: null,
  status: 'idle',
  refreshing: false,
  error: null,
  clear: () => set({ profileId: null, catalog: null, index: null, account: null, status: 'idle', error: null }),
  load: async (profile, opts = {}) => {
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    const switching = get().profileId !== profile.id;
    if (switching) set({ profileId: profile.id, catalog: null, index: null, account: null, status: 'loading', error: null });

    let cached: Catalog | undefined;
    if (switching && !opts.force) {
      cached = await idbGet<Catalog>(`catalog:${profile.id}`).catch(() => undefined);
      if (controller.signal.aborted) return;
      if (cached) set({ catalog: cached, index: buildIndex(cached), status: 'ready' });
    }
    const current = cached ?? get().catalog;
    const fresh = current && Date.now() - current.fetchedAt < STALE_MS;
    if (fresh && !opts.force) {
      // Still fetch account info in the background for Xtream (cheap).
      if (profile.type === 'xtream' && !get().account) {
        new XtreamClient(profile)
          .account(controller.signal)
          .then((account) => get().profileId === profile.id && set({ account }))
          .catch(() => {});
      }
      return;
    }
    set({ refreshing: true, status: current ? 'ready' : 'loading', error: null });
    try {
      const { catalog, account } = await fetchCatalog(profile, controller.signal);
      if (controller.signal.aborted) return;
      await idbSet(`catalog:${profile.id}`, catalog).catch(() => {});
      set({ catalog, index: buildIndex(catalog), account, status: 'ready', refreshing: false, error: null });
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = (e as Error).message;
      set({ refreshing: false, error: msg, status: current ? 'ready' : 'error' });
    }
  },
}));

export function categoriesOf(c: Catalog | null, kind: ContentKind): Category[] {
  return c?.categories[kind] ?? [];
}
