import { XtreamClient } from './xtream';
import { buildM3uCatchupUrl } from './catchup';
import { extOf } from './format';
import type { AccountInfo, Channel, Episode, Movie, PlayRequest, Profile, Programme, SeriesItem } from './types';

export function liveRequest(profile: Profile, ch: Channel): PlayRequest {
  if (profile.type === 'xtream') {
    const x = new XtreamClient(profile);
    const primary = profile.output ?? 'm3u8';
    const alt = primary === 'm3u8' ? 'ts' : 'm3u8';
    return {
      kind: 'live',
      url: x.liveUrl(ch.id, primary),
      ext: primary,
      fallbackUrl: x.liveUrl(ch.id, alt),
      fallbackExt: alt,
      title: ch.name,
      logo: ch.logo,
      userAgent: profile.userAgent,
      key: `live:${ch.id}`,
      channelId: ch.id,
    };
  }
  return {
    kind: 'live',
    url: ch.url!,
    ext: extOf(ch.url!),
    title: ch.name,
    logo: ch.logo,
    userAgent: ch.userAgent ?? profile.userAgent,
    referrer: ch.referrer,
    key: `live:${ch.id}`,
    channelId: ch.id,
  };
}

export function movieRequest(profile: Profile, m: Movie, extra: { duration?: number; startAt?: number; ext?: string } = {}): PlayRequest {
  const ext = extra.ext ?? m.ext ?? 'mp4';
  const url = profile.type === 'xtream' ? new XtreamClient(profile).movieUrl(m.id, ext) : m.url!;
  return {
    kind: 'movie',
    url,
    ext: profile.type === 'xtream' ? ext : (extOf(url) ?? ext),
    title: m.name,
    logo: m.poster,
    userAgent: profile.userAgent,
    key: `movie:${m.id}`,
    duration: extra.duration,
    startAt: extra.startAt,
  };
}

export function episodeRequest(profile: Profile, s: SeriesItem, ep: Episode, extra: { startAt?: number } = {}): PlayRequest {
  const ext = ep.ext ?? 'mp4';
  const url = profile.type === 'xtream' ? new XtreamClient(profile).episodeUrl(ep.id, ext) : ep.url!;
  return {
    kind: 'episode',
    url,
    ext: profile.type === 'xtream' ? ext : (extOf(url) ?? ext),
    title: s.name,
    subtitle: `S${ep.season} · E${ep.episode}${ep.title && !/S\d+\s*E\d+/i.test(ep.title) ? ` — ${ep.title}` : ''}`,
    logo: ep.image ?? s.cover,
    userAgent: profile.userAgent,
    key: `episode:${ep.id}`,
    duration: ep.duration,
    startAt: extra.startAt,
  };
}

export function canCatchup(ch: Channel, p: Programme, now = Date.now()): boolean {
  if (!ch.archive) return false;
  if (p.start > now) return false;
  const days = ch.archiveDays || 7;
  return p.start >= now - days * 86_400_000;
}

export function catchupRequest(profile: Profile, ch: Channel, p: Programme, account: AccountInfo | null): PlayRequest | null {
  const minutes = (p.end - p.start) / 60_000;
  let url: string | null;
  if (profile.type === 'xtream') {
    url = new XtreamClient(profile).timeshiftUrl(ch.id, p.start, minutes, account?.serverTimezone);
  } else {
    url = buildM3uCatchupUrl(ch, p.start, p.end);
  }
  if (!url) return null;
  return {
    kind: 'catchup',
    url,
    ext: extOf(url) ?? 'ts',
    title: p.title,
    subtitle: `${ch.name} · catch-up`,
    logo: ch.logo,
    userAgent: ch.userAgent ?? profile.userAgent,
    referrer: ch.referrer,
    key: `catchup:${ch.id}:${p.start}`,
    channelId: ch.id,
    duration: (p.end - p.start) / 1000,
  };
}
