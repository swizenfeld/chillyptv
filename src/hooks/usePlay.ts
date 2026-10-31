import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useActiveProfile } from '../store/profiles';
import { useCatalog } from '../store/catalog';
import { usePlayer, type PlaySession } from '../store/player';
import { useLibrary } from '../store/library';
import { catchupRequest, episodeRequest, liveRequest, movieRequest } from '../lib/streams';
import { XtreamClient } from '../lib/xtream';
import { buildM3uCatchupUrl } from '../lib/catchup';
import type { Channel, Episode, Movie, Profile, Programme, SeriesItem } from '../lib/types';

export function liveSession(profile: Profile, ch: Channel, zapList?: string[]): PlaySession {
  return {
    req: liveRequest(profile, ch),
    zapList,
    history: { key: `live:${ch.id}`, kind: 'live', id: ch.id, name: ch.name, image: ch.logo },
  };
}

export function episodeSession(profile: Profile, s: SeriesItem, eps: Episode[], index: number, startAt?: number): PlaySession {
  const ep = eps[index];
  return {
    req: episodeRequest(profile, s, ep, { startAt }),
    history: { key: `episode:${ep.id}`, kind: 'episode', id: ep.id, name: s.name, image: ep.image ?? s.cover, seriesId: s.id, seriesName: s.name, season: ep.season, episode: ep.episode, ext: ep.ext },
    next: index + 1 < eps.length ? () => episodeSession(profile, s, eps, index + 1) : undefined,
  };
}

export function catchupSession(profile: Profile, ch: Channel, p: Programme): PlaySession | null {
  const account = useCatalog.getState().account;
  const req = catchupRequest(profile, ch, p, account);
  if (!req) return null;
  const totalMin = (p.end - p.start) / 60_000;
  const seekUrl = (offsetSec: number) => {
    const start = p.start + offsetSec * 1000;
    if (profile.type === 'xtream') return new XtreamClient(profile).timeshiftUrl(ch.id, start, totalMin - offsetSec / 60, account?.serverTimezone);
    return buildM3uCatchupUrl(ch, start, p.end);
  };
  return { req, seekUrl, history: { key: req.key!, kind: 'catchup', id: ch.id, name: `${p.title} (${ch.name})`, image: ch.logo } };
}

export function usePlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useActiveProfile();
  const setSession = usePlayer((s) => s.setSession);

  const start = useCallback(
    (session: PlaySession | null) => {
      if (!session) return;
      setSession({ ...session, returnTo: session.returnTo ?? location.pathname + location.search });
      navigate('/play');
    },
    [navigate, location, setSession],
  );

  const resumePosition = (key: string): number | undefined => {
    if (!profile) return undefined;
    const h = (useLibrary.getState().history[profile.id] ?? []).find((x) => x.key === key);
    if (!h || !h.duration) return undefined;
    // Ignore if nearly finished.
    return h.position > 10 && h.position < h.duration * 0.95 ? h.position : undefined;
  };

  return {
    profile,
    start,
    resumePosition,
    playChannel: (ch: Channel, zapList?: string[]) => profile && start(liveSession(profile, ch, zapList)),
    playMovie: (m: Movie, extra: { duration?: number; ext?: string; fromStart?: boolean } = {}) => {
      if (!profile) return;
      const startAt = extra.fromStart ? undefined : resumePosition(`movie:${m.id}`);
      start({
        req: movieRequest(profile, m, { duration: extra.duration, startAt, ext: extra.ext }),
        history: { key: `movie:${m.id}`, kind: 'movie', id: m.id, name: m.name, image: m.poster, ext: extra.ext ?? m.ext },
      });
    },
    playEpisode: (s: SeriesItem, eps: Episode[], index: number, fromStart = false) => {
      if (!profile) return;
      start(episodeSession(profile, s, eps, index, fromStart ? undefined : resumePosition(`episode:${eps[index].id}`)));
    },
    playCatchup: (ch: Channel, p: Programme) => profile && start(catchupSession(profile, ch, p)),
  };
}
