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
  /** Show a channels-only catalogue now; `rest` delivers the full one (movies and series) later. */
  adopt: (profileId: string, partial: { catalog: Catalog; account: AccountInfo | null }, rest: Promise<{ catalog: Catalog; account: AccountInfo | null }>) => void;
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

/** Movies and series change less often than channels and are far bigger (16 + 8 MB on a large provider). */
const LIBRARY_STALE_MS = 24 * 60 * 60 * 1000;

export async function fetchCatalog(
  profile: Profile,
  signal?: AbortSignal,
  onLive?: (partial: Catalog, account: AccountInfo) => void,
  /** Keep this catalogue's movies and series and only refresh channels. */
  keepLibraryOf?: Catalog,
): Promise<{ catalog: Catalog; account: AccountInfo | null }> {
  if (profile.type === 'xtream') {
    const client = new XtreamClient(profile);
    // Login first (a wrong password should say so, not fail six list requests), then the lists.
    const account = await client.account(signal);
    const withEpg = (c: Catalog) => (profile.epgUrl ? { ...c, epgUrls: [profile.epgUrl] } : c);
    if (keepLibraryOf) {
      const live = await client.catalog(signal, undefined, { skipLibrary: true });
      const k = keepLibraryOf;
      const merged: Catalog = { ...live, categories: { ...live.categories, movie: k.categories.movie, series: k.categories.series }, movies: k.movies, series: k.series, libraryFetchedAt: k.libraryFetchedAt };
      return { catalog: withEpg(merged), account };
    }
    const catalog = await client.catalog(signal, onLive && ((partial) => onLive(withEpg(partial), account)));
    return { catalog: withEpg(catalog), account };
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
  adopt: (profileId, partial, rest) => {
    set({ profileId, catalog: partial.catalog, index: buildIndex(partial.catalog), account: partial.account, status: 'ready', refreshing: true, error: null });
    const stillOurs = () => get().profileId === profileId && !!get().catalog?.libraryPending;
    rest
      .then(async ({ catalog, account }) => {
        await idbSet(`catalog:${profileId}`, catalog).catch(() => {});
        if (stillOurs()) set({ catalog, index: buildIndex(catalog), account: account ?? get().account, refreshing: false });
      })
      .catch((e) => {
        if (stillOurs()) set({ catalog: { ...get().catalog!, libraryPending: false }, refreshing: false, error: (e as Error).message });
      });
  },
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
      // With nothing to show yet, show channels as soon as they arrive; movies and series follow.
      const onLive = current
        ? undefined
        : (partial: Catalog, account: AccountInfo) => {
            if (!controller.signal.aborted) set({ catalog: partial, index: buildIndex(partial), account, status: 'ready' });
          };
      // Routine refreshes keep movies and series for a day; the refresh button always gets everything.
      const keep = !opts.force && current && !current.libraryPending && current.libraryFetchedAt && Date.now() - current.libraryFetchedAt < LIBRARY_STALE_MS ? current : undefined;
      const { catalog, account } = await fetchCatalog(profile, controller.signal, onLive, keep);
      if (controller.signal.aborted) return;
      await idbSet(`catalog:${profile.id}`, catalog).catch(() => {});
      set({ catalog, index: buildIndex(catalog), account, status: 'ready', refreshing: false, error: null });
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = (e as Error).message;
      const shown = get().catalog;
      set({ refreshing: false, error: msg, status: current || shown ? 'ready' : 'error', ...(shown?.libraryPending ? { catalog: { ...shown, libraryPending: false } } : {}) });
    }
  },
}));

export function categoriesOf(c: Catalog | null, kind: ContentKind): Category[] {
  return c?.categories[kind] ?? [];
}
