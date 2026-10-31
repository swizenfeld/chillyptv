export type SourceType = 'xtream' | 'm3u';
export type ContentKind = 'live' | 'movie' | 'series';

export interface Profile {
  id: string;
  name: string;
  type: SourceType;
  /** Xtream server base URL, e.g. http://host:8080 */
  server?: string;
  username?: string;
  password?: string;
  /** Remote M3U URL. For uploaded files the content lives in IndexedDB. */
  m3uUrl?: string;
  m3uFileName?: string;
  /** Optional XMLTV override (otherwise from the playlist header / Xtream xmltv.php). */
  epgUrl?: string;
  /** Extra XMLTV sources merged after the provider's guide (fill gaps). */
  extraEpgUrls?: string[];
  /** Custom User-Agent sent to the provider (some panels require a specific one). */
  userAgent?: string;
  output: 'm3u8' | 'ts';
  color: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  kind: ContentKind;
}

export interface Channel {
  id: string;
  num: number;
  name: string;
  logo?: string;
  categoryId: string;
  epgId?: string;
  archive: boolean;
  archiveDays: number;
  /** Direct URL (M3U sources). Xtream URLs are built on demand. */
  url?: string;
  userAgent?: string;
  referrer?: string;
  catchup?: string;
  catchupSource?: string;
}

export interface Movie {
  id: string;
  name: string;
  poster?: string;
  categoryId: string;
  rating?: number;
  added?: number;
  ext?: string;
  url?: string;
  year?: number;
}

export interface Episode {
  id: string;
  title: string;
  season: number;
  episode: number;
  ext?: string;
  plot?: string;
  image?: string;
  duration?: number;
  url?: string;
}

export interface SeriesItem {
  id: string;
  name: string;
  cover?: string;
  categoryId: string;
  plot?: string;
  rating?: number;
  genre?: string;
  year?: number;
  lastModified?: number;
  /** M3U sources carry their episodes inline. */
  episodes?: Episode[];
}

export interface MediaInfo {
  title: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: number;
  duration?: number;
  poster?: string;
  backdrop?: string;
  trailer?: string;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
}

export interface SeriesDetails {
  info: MediaInfo;
  seasons: { number: number; name: string; cover?: string }[];
  episodes: Record<number, Episode[]>;
}

export interface Catalog {
  profileId: string;
  fetchedAt: number;
  categories: Record<ContentKind, Category[]>;
  channels: Channel[];
  movies: Movie[];
  series: SeriesItem[];
  epgUrls: string[];
  /** Channels are in; movies and series are still downloading (first load of a big playlist). */
  libraryPending?: boolean;
}

export interface Programme {
  start: number;
  end: number;
  title: string;
  desc?: string;
  subtitle?: string;
  category?: string;
  episode?: string;
  /** Provider says an archive exists (Xtream full EPG). */
  archive?: boolean;
  /** Read from an event channel's name, not from a TV guide. */
  fromName?: boolean;
}

export interface AccountInfo {
  username: string;
  status: string;
  expDate?: number;
  isTrial: boolean;
  activeCons: number;
  maxConnections: number;
  createdAt?: number;
  message?: string;
  formats: string[];
  serverTimezone?: string;
  serverUrl?: string;
  serverTimeOffsetMs?: number;
}

/** A thing the user can play; produced by stream builders and consumed by the player. */
export interface PlayRequest {
  kind: 'live' | 'movie' | 'episode' | 'catchup' | 'recording' | 'url';
  url: string;
  title: string;
  subtitle?: string;
  logo?: string;
  /** Container hint ("m3u8", "ts", "mp4", "mkv"...). */
  ext?: string;
  userAgent?: string;
  referrer?: string;
  /** Seconds to resume from. */
  startAt?: number;
  /** Known duration in seconds (needed for remux seeking). */
  duration?: number;
  /** Library key used for resume/history (e.g. "movie:123"). */
  key?: string;
  channelId?: string;
  /** Alternative URL to try if the first one fails (e.g. TS fallback for HLS). */
  fallbackUrl?: string;
  fallbackExt?: string;
}
