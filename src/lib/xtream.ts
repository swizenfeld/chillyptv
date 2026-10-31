import { explainSourceError, fetchUpstreamJson } from './api';
import { yearFromName } from './format';
import type { AccountInfo, Catalog, Category, Channel, Episode, MediaInfo, Movie, Profile, Programme, SeriesDetails, SeriesItem } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export function normalizeServer(server: string): string {
  let s = server.trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  // People often paste the full API url or a get.php link.
  s = s.replace(/\/(player_api|get|xmltv)\.php.*$/i, '');
  return s;
}

/** Pulls server/username/password out of an Xtream style get.php M3U link. */
export function parseXtreamLink(link: string): { server: string; username: string; password: string } | null {
  try {
    const u = new URL(link.trim());
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    return { server: `${u.protocol}//${u.host}`, username, password };
  } catch {
    return null;
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : undefined;
};

function b64(s: string | undefined): string {
  if (!s) return '';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return s;
  }
}

function firstImage(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.find((x) => typeof x === 'string' && x) as string | undefined;
  return typeof v === 'string' && v ? v : undefined;
}

export class XtreamClient {
  readonly base: string;
  constructor(private profile: Profile) {
    this.base = normalizeServer(profile.server ?? '');
  }

  private api(params: Record<string, string> = {}): string {
    const p = new URLSearchParams({ username: this.profile.username ?? '', password: this.profile.password ?? '', ...params });
    return `${this.base}/player_api.php?${p}`;
  }

  private get<T = Json>(params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    return fetchUpstreamJson<T>(this.api(params), { ua: this.profile.userAgent, signal });
  }

  async account(signal?: AbortSignal): Promise<AccountInfo> {
    let data: Json;
    try {
      data = await this.get({}, signal);
    } catch (e) {
      throw explainSourceError(e, this.base, 'xtream');
    }
    const ui = data?.user_info;
    if (!ui || String(ui.auth) !== '1') throw new Error('Login failed — check the username and password.');
    const si = data.server_info ?? {};
    const serverNow = num(si.timestamp_now);
    return {
      username: ui.username,
      status: ui.status ?? 'Unknown',
      expDate: num(ui.exp_date) ? num(ui.exp_date)! * 1000 : undefined,
      isTrial: String(ui.is_trial) === '1',
      activeCons: num(ui.active_cons) ?? 0,
      maxConnections: num(ui.max_connections) ?? 1,
      createdAt: num(ui.created_at) ? num(ui.created_at)! * 1000 : undefined,
      message: ui.message || undefined,
      formats: Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : [],
      serverTimezone: si.timezone,
      serverUrl: si.url ? `${si.server_protocol ?? 'http'}://${si.url}:${si.port}` : undefined,
      serverTimeOffsetMs: serverNow ? serverNow * 1000 - Date.now() : undefined,
    };
  }

  async catalog(signal?: AbortSignal): Promise<Catalog> {
    const [liveCats, vodCats, seriesCats, live, vod, series] = await Promise.all([
      this.get<Json[]>({ action: 'get_live_categories' }, signal),
      this.get<Json[]>({ action: 'get_vod_categories' }, signal).catch(() => []),
      this.get<Json[]>({ action: 'get_series_categories' }, signal).catch(() => []),
      this.get<Json[]>({ action: 'get_live_streams' }, signal),
      this.get<Json[]>({ action: 'get_vod_streams' }, signal).catch(() => []),
      this.get<Json[]>({ action: 'get_series' }, signal).catch(() => []),
    ]);
    const cats = (list: Json[], kind: Category['kind']): Category[] =>
      (Array.isArray(list) ? list : []).map((c) => ({ id: String(c.category_id), name: String(c.category_name ?? 'Unnamed'), kind }));

    const channels: Channel[] = (Array.isArray(live) ? live : []).map((s, i) => ({
      id: String(s.stream_id),
      num: num(s.num) ?? i + 1,
      name: String(s.name ?? '').trim() || `Channel ${i + 1}`,
      logo: s.stream_icon || undefined,
      categoryId: String(s.category_id ?? ''),
      epgId: s.epg_channel_id || undefined,
      archive: String(s.tv_archive) === '1',
      archiveDays: num(s.tv_archive_duration) ?? 0,
    }));
    const movies: Movie[] = (Array.isArray(vod) ? vod : []).map((s) => ({
      id: String(s.stream_id),
      name: String(s.name ?? '').trim(),
      poster: s.stream_icon || undefined,
      categoryId: String(s.category_id ?? ''),
      rating: num(s.rating),
      added: num(s.added) ? num(s.added)! * 1000 : undefined,
      ext: s.container_extension || 'mp4',
      year: num(s.year) ?? yearFromName(String(s.name ?? '')),
    }));
    const seriesItems: SeriesItem[] = (Array.isArray(series) ? series : []).map((s) => ({
      id: String(s.series_id),
      name: String(s.name ?? '').trim(),
      cover: s.cover || undefined,
      categoryId: String(s.category_id ?? ''),
      plot: s.plot || undefined,
      rating: num(s.rating),
      genre: s.genre || undefined,
      year: num(String(s.releaseDate ?? s.release_date ?? '').slice(0, 4)) ?? yearFromName(String(s.name ?? '')),
      lastModified: num(s.last_modified) ? num(s.last_modified)! * 1000 : undefined,
    }));
    return {
      profileId: this.profile.id,
      fetchedAt: Date.now(),
      categories: { live: cats(liveCats, 'live'), movie: cats(vodCats, 'movie'), series: cats(seriesCats, 'series') },
      channels,
      movies,
      series: seriesItems,
      epgUrls: [this.xmltvUrl()],
    };
  }

  xmltvUrl(): string {
    const p = new URLSearchParams({ username: this.profile.username ?? '', password: this.profile.password ?? '' });
    return `${this.base}/xmltv.php?${p}`;
  }

  async movieInfo(id: string, signal?: AbortSignal): Promise<MediaInfo & { ext?: string }> {
    const data = await this.get({ action: 'get_vod_info', vod_id: id }, signal);
    const info = data?.info ?? {};
    const md = data?.movie_data ?? {};
    return {
      title: md.name ?? info.name ?? '',
      plot: info.plot || info.description || undefined,
      cast: info.cast || info.actors || undefined,
      director: info.director || undefined,
      genre: info.genre || undefined,
      releaseDate: info.releasedate || info.release_date || undefined,
      rating: num(info.rating),
      duration: num(info.duration_secs),
      poster: info.movie_image || info.cover_big || undefined,
      backdrop: firstImage(info.backdrop_path),
      trailer: info.youtube_trailer || undefined,
      videoCodec: info.video?.codec_name,
      audioCodec: info.audio?.codec_name,
      resolution: info.video?.width ? `${info.video.width}×${info.video.height}` : undefined,
      ext: md.container_extension,
    };
  }

  async seriesInfo(id: string, signal?: AbortSignal): Promise<SeriesDetails> {
    const data = await this.get({ action: 'get_series_info', series_id: id }, signal);
    const info = data?.info ?? {};
    const episodes: Record<number, Episode[]> = {};
    const rawEps = data?.episodes ?? {};
    const entries: [string, Json[]][] = Array.isArray(rawEps) ? rawEps.map((list: Json[], i: number) => [String(i + 1), list]) : Object.entries(rawEps);
    for (const [season, list] of entries) {
      const s = Number(season);
      episodes[s] = (list ?? []).map((e: Json, i: number) => ({
        id: String(e.id),
        title: String(e.title ?? `Episode ${i + 1}`),
        season: num(e.season) ?? s,
        episode: num(e.episode_num) ?? i + 1,
        ext: e.container_extension || 'mp4',
        plot: e.info?.plot || undefined,
        image: e.info?.movie_image || undefined,
        duration: num(e.info?.duration_secs),
      }));
      episodes[s].sort((a, b) => a.episode - b.episode);
    }
    const seasonNums = Object.keys(episodes).map(Number).sort((a, b) => a - b);
    const declared: Json[] = Array.isArray(data?.seasons) ? data.seasons : [];
    return {
      info: {
        title: info.name ?? '',
        plot: info.plot || undefined,
        cast: info.cast || undefined,
        director: info.director || undefined,
        genre: info.genre || undefined,
        releaseDate: info.releaseDate || info.release_date || undefined,
        rating: num(info.rating),
        poster: info.cover || undefined,
        backdrop: firstImage(info.backdrop_path),
        trailer: info.youtube_trailer || undefined,
      },
      seasons: seasonNums.map((n) => {
        const d = declared.find((x) => num(x.season_number) === n);
        return { number: n, name: d?.name || `Season ${n}`, cover: d?.cover || undefined };
      }),
      episodes,
    };
  }

  /** Full EPG for one channel (includes past programmes with archive flags). */
  async channelEpg(streamId: string, signal?: AbortSignal): Promise<Programme[]> {
    const data = await this.get({ action: 'get_simple_data_table', stream_id: streamId }, signal);
    return parseXtreamListings(data?.epg_listings);
  }

  async shortEpg(streamId: string, limit = 6, signal?: AbortSignal): Promise<Programme[]> {
    const data = await this.get({ action: 'get_short_epg', stream_id: streamId, limit: String(limit) }, signal);
    return parseXtreamListings(data?.epg_listings);
  }

  liveUrl(id: string, ext: string = this.profile.output): string {
    return `${this.base}/live/${encodeURIComponent(this.profile.username ?? '')}/${encodeURIComponent(this.profile.password ?? '')}/${id}.${ext}`;
  }
  movieUrl(id: string, ext = 'mp4'): string {
    return `${this.base}/movie/${encodeURIComponent(this.profile.username ?? '')}/${encodeURIComponent(this.profile.password ?? '')}/${id}.${ext}`;
  }
  episodeUrl(id: string, ext = 'mp4'): string {
    return `${this.base}/series/${encodeURIComponent(this.profile.username ?? '')}/${encodeURIComponent(this.profile.password ?? '')}/${id}.${ext}`;
  }
  /** Xtream timeshift URL. The start time must be expressed in the provider's timezone. */
  timeshiftUrl(id: string, start: number, durationMin: number, timezone?: string): string {
    return `${this.base}/timeshift/${encodeURIComponent(this.profile.username ?? '')}/${encodeURIComponent(this.profile.password ?? '')}/${Math.max(1, Math.ceil(durationMin))}/${formatInTimezone(start, timezone)}/${id}.ts`;
  }
}

export function parseXtreamListings(list: unknown): Programme[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((p: Json) => {
      const start = num(p.start_timestamp) ? num(p.start_timestamp)! * 1000 : Date.parse(String(p.start).replace(' ', 'T') + 'Z');
      const end = num(p.stop_timestamp) ? num(p.stop_timestamp)! * 1000 : Date.parse(String(p.end ?? p.stop).replace(' ', 'T') + 'Z');
      return { start, end, title: b64(p.title) || 'Untitled', desc: b64(p.description) || undefined, archive: String(p.has_archive) === '1' } as Programme;
    })
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end))
    .sort((a, b) => a.start - b.start);
}

/** Formats a timestamp as YYYY-MM-DD:HH-MM in the given IANA timezone (provider local time). */
export function formatInTimezone(ms: number, timezone?: string): string {
  let parts: Record<string, string> = {};
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  } catch {
    const d = new Date(ms);
    const p2 = (n: number) => String(n).padStart(2, '0');
    parts = { year: String(d.getFullYear()), month: p2(d.getMonth() + 1), day: p2(d.getDate()), hour: p2(d.getHours()), minute: p2(d.getMinutes()) };
  }
  return `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
}
