import { parseM3u, SERIES_RE, type M3uEntry } from '../../shared/m3u';
import { cleanTitle, extOf, hash, yearFromName } from './format';
import type { Catalog, Category, Channel, ContentKind, Episode, Movie, SeriesItem } from './types';

/** Converts a parsed M3U playlist into the app's catalog model. */
export function catalogFromM3u(profileId: string, text: string): Catalog {
  const pl = parseM3u(text);
  const catMaps: Record<ContentKind, Map<string, Category>> = { live: new Map(), movie: new Map(), series: new Map() };
  const catId = (kind: ContentKind, name: string): string => {
    const key = name || 'Uncategorized';
    let c = catMaps[kind].get(key);
    if (!c) {
      c = { id: `${kind[0]}:${hash(key)}`, name: key, kind };
      catMaps[kind].set(key, c);
    }
    return c.id;
  };

  const channels: Channel[] = [];
  const movies: Movie[] = [];
  const seriesMap = new Map<string, SeriesItem>();

  pl.entries.forEach((e: M3uEntry, index: number) => {
    if (e.kind === 'live') {
      channels.push({
        id: hash(`${e.url}|${e.name}`),
        num: e.chno ?? channels.length + 1,
        name: e.name,
        logo: e.logo,
        categoryId: catId('live', e.group),
        epgId: e.tvgId || e.tvgName || e.name,
        archive: !!e.catchup || (e.catchupDays ?? 0) > 0,
        archiveDays: e.catchupDays ?? (e.catchup ? 7 : 0),
        url: e.url,
        userAgent: e.userAgent,
        referrer: e.referrer,
        catchup: e.catchup,
        catchupSource: e.catchupSource,
      });
      return;
    }
    if (e.kind === 'movie') {
      movies.push({
        id: hash(e.url),
        name: e.name,
        poster: e.logo,
        categoryId: catId('movie', e.group),
        ext: extOf(e.url) ?? 'mp4',
        url: e.url,
        year: yearFromName(e.name),
        added: Date.now() - index,
      });
      return;
    }
    // Series: group episodes by show name parsed from "Show S01 E02".
    const m = e.name.match(SERIES_RE);
    const show = (m ? m[1] : e.name).replace(/[\s._-]+$/, '').trim() || e.name;
    const season = m ? Number(m[2]) : 1;
    const epNum = m ? Number(m[3]) : 0;
    const key = `${e.group}|${show.toLowerCase()}`;
    let s = seriesMap.get(key);
    if (!s) {
      s = { id: hash(key), name: cleanTitle(show), cover: e.logo, categoryId: catId('series', e.group), episodes: [], year: yearFromName(show) };
      seriesMap.set(key, s);
    }
    const ep: Episode = {
      id: hash(e.url),
      title: e.name,
      season,
      episode: epNum || s.episodes!.filter((x) => x.season === season).length + 1,
      ext: extOf(e.url) ?? 'mp4',
      url: e.url,
      image: e.logo,
    };
    s.episodes!.push(ep);
  });

  for (const s of seriesMap.values()) s.episodes!.sort((a, b) => a.season - b.season || a.episode - b.episode);

  return {
    profileId,
    fetchedAt: Date.now(),
    categories: {
      live: [...catMaps.live.values()],
      movie: [...catMaps.movie.values()],
      series: [...catMaps.series.values()],
    },
    channels,
    movies,
    series: [...seriesMap.values()],
    epgUrls: pl.epgUrls,
  };
}
