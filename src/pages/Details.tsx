import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Heart, Play, RotateCcw, Star, Clapperboard as TrailerIcon, Zap, Check } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useHistory, useIsFavorite, useLibrary } from '../store/library';
import { isCategoryLocked, isUnlocked, useSettings } from '../store/settings';
import { usePlay } from '../hooks/usePlay';
import { useParental } from '../components/Parental';
import { XtreamClient } from '../lib/xtream';
import { backendHealth, imageUrl } from '../lib/api';
import { Empty, Img, ProgressBar, Spinner } from '../components/ui';
import { formatDuration, formatMinutes } from '../lib/format';
import type { Episode, MediaInfo, SeriesDetails } from '../lib/types';

function useLockGate(categoryId: string | undefined): boolean {
  const settings = useSettings();
  const index = useCatalog((s) => s.index);
  const { requestPin } = useParental();
  const navigate = useNavigate();
  const name = categoryId ? (index?.categoryById.get(categoryId)?.name ?? '') : '';
  const locked = !!categoryId && !isUnlocked() && isCategoryLocked(settings, categoryId, name);
  const [, force] = useState(0);
  useEffect(() => {
    if (locked) requestPin(() => force((n) => n + 1), `"${name}" is protected`);
  }, [locked, name, requestPin]);
  useEffect(() => {
    if (!locked) return;
    const t = setTimeout(() => {
      if (!isUnlocked()) navigate(-1);
    }, 60000);
    return () => clearTimeout(t);
  }, [locked, navigate]);
  return !locked;
}

function cssUrl(url: string | undefined): string | undefined {
  const u = imageUrl(url);
  if (!u || !/^(https?:|\/)/i.test(u)) return undefined;
  return `url("${u.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

function Backdrop({ src }: { src?: string }) {
  const bg = cssUrl(src);
  return bg ? <div className="detail-backdrop" style={{ backgroundImage: bg }} /> : <div className="detail-backdrop empty" />;
}

function trailerUrl(t?: string): string | undefined {
  if (!t) return undefined;
  return /^https?:/.test(t) ? t : `https://www.youtube.com/watch?v=${encodeURIComponent(t)}`;
}

export function MovieDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const movie = index?.movieById.get(id);
  const [info, setInfo] = useState<(MediaInfo & { ext?: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const history = useHistory(profile?.id);
  const isFav = useIsFavorite(profile?.id, 'movie', id);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const play = usePlay();
  const allowed = useLockGate(movie?.categoryId);

  useEffect(() => {
    if (!profile || profile.type !== 'xtream' || !movie) return;
    const ctrl = new AbortController();
    setLoading(true);
    new XtreamClient(profile)
      .movieInfo(movie.id, ctrl.signal)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [profile, movie]);

  if (!index) return <Spinner />;
  if (!movie || !profile) return <Empty title="Movie not found" />;
  if (!allowed) return <Empty title="Locked" />;
  const h = history.find((x) => x.key === `movie:${movie.id}`);
  const resumable = h && h.duration && h.position > 10 && h.position < h.duration * 0.95;
  const ext = info?.ext ?? movie.ext;
  const needsRemux = ext && !['mp4', 'm4v', 'webm', 'mov'].includes(ext.toLowerCase());
  const start = (fromStart: boolean) => play.playMovie(movie, { duration: info?.duration ?? (h?.duration || undefined), ext, fromStart });

  return (
    <div className="detail">
      <Backdrop src={info?.backdrop ?? info?.poster ?? movie.poster} />
      <button className="btn ghost back" onClick={() => navigate(-1)}>
        <ArrowLeft size={18} /> Back
      </button>
      <div className="detail-body">
        <Img src={info?.poster ?? movie.poster} alt={movie.name} className="detail-poster" />
        <div className="detail-info">
          <h1>{movie.name}</h1>
          <div className="meta">
            {(info?.releaseDate || movie.year) && <span>{info?.releaseDate?.slice(0, 4) ?? movie.year}</span>}
            {info?.duration ? <span>{formatMinutes(info.duration)}</span> : null}
            {(info?.rating ?? movie.rating) ? (
              <span className="rating">
                <Star size={14} fill="currentColor" /> {(info?.rating ?? movie.rating)!.toFixed(1)}
              </span>
            ) : null}
            {info?.genre && <span>{info.genre}</span>}
            {ext && <span className="chip subtle">{ext.toUpperCase()}</span>}
            {info?.resolution && <span className="chip subtle">{info.resolution}</span>}
            {info?.audioCodec && <span className="chip subtle">{info.audioCodec.toUpperCase()}</span>}
          </div>
          {loading && <Spinner size={18} />}
          {info?.plot && <p className="plot">{info.plot}</p>}
          {info?.cast && (
            <p className="credits">
              <b>Cast:</b> {info.cast}
            </p>
          )}
          {info?.director && (
            <p className="credits">
              <b>Director:</b> {info.director}
            </p>
          )}
          {resumable && (
            <div className="resume-bar">
              <ProgressBar value={h!.position / h!.duration} />
              <span className="muted small">{formatDuration(h!.duration - h!.position)} left</span>
            </div>
          )}
          <div className="row gap wrap">
            <button className="btn primary big" onClick={() => start(false)} autoFocus>
              <Play size={18} fill="currentColor" /> {resumable ? `Resume from ${formatDuration(h!.position)}` : 'Play'}
            </button>
            {resumable && (
              <button className="btn big" onClick={() => start(true)}>
                <RotateCcw size={18} /> From beginning
              </button>
            )}
            <button className="btn big" onClick={() => toggleFavorite(profile.id, { kind: 'movie', id: movie.id, name: movie.name, image: movie.poster })}>
              <Heart size={18} fill={isFav ? 'currentColor' : 'none'} /> {isFav ? 'Favourited' : 'Favourite'}
            </button>
            {trailerUrl(info?.trailer) && (
              <a className="btn big" href={trailerUrl(info?.trailer)} target="_blank" rel="noreferrer">
                <TrailerIcon size={18} /> Trailer
              </a>
            )}
          </div>
          {needsRemux && backendHealth()?.ffmpeg && (
            <p className="hint">
              <Zap size={14} /> {ext!.toUpperCase()} files are converted on the fly by your ChillyPTV server if the browser cannot play them.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SeriesDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const series = index?.seriesById.get(id);
  const [details, setDetails] = useState<SeriesDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const history = useHistory(profile?.id);
  const isFav = useIsFavorite(profile?.id, 'series', id);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const play = usePlay();
  const allowed = useLockGate(series?.categoryId);

  useEffect(() => {
    if (!profile || !series) return;
    if (profile.type !== 'xtream') {
      const episodes: Record<number, Episode[]> = {};
      for (const e of series.episodes ?? []) (episodes[e.season] ??= []).push(e);
      setDetails({ info: { title: series.name, poster: series.cover, plot: series.plot }, seasons: Object.keys(episodes).map(Number).sort((a, b) => a - b).map((n) => ({ number: n, name: `Season ${n}` })), episodes });
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    new XtreamClient(profile)
      .seriesInfo(series.id, ctrl.signal)
      .then(setDetails)
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [profile, series]);

  const allEpisodes = useMemo(() => (details ? details.seasons.flatMap((s) => details.episodes[s.number] ?? []) : []), [details]);
  const progress = useMemo(() => {
    const m = new Map<string, { position: number; duration: number }>();
    for (const h of history) if (h.kind === 'episode' && h.seriesId === id) m.set(h.id, { position: h.position, duration: h.duration });
    return m;
  }, [history, id]);
  const lastWatched = history.find((h) => h.kind === 'episode' && h.seriesId === id);

  // Pick the season of the last watched episode, or the first one.
  useEffect(() => {
    if (!details || season !== null) return;
    const resumeId = params.get('resume') ?? lastWatched?.id;
    const ep = allEpisodes.find((e) => e.id === resumeId);
    setSeason(ep?.season ?? details.seasons[0]?.number ?? 1);
  }, [details, season, params, lastWatched, allEpisodes]);

  // Deep link from "continue watching": start immediately.
  useEffect(() => {
    const resumeId = params.get('resume');
    if (!resumeId || !series || !allEpisodes.length) return;
    const i = allEpisodes.findIndex((e) => e.id === resumeId);
    if (i >= 0) {
      navigate(`/series/${encodeURIComponent(id)}`, { replace: true });
      play.playEpisode(series, allEpisodes, i);
    }
  }, [params, allEpisodes, series]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!index) return <Spinner />;
  if (!series || !profile) return <Empty title="Series not found" />;
  if (!allowed) return <Empty title="Locked" />;

  const info = details?.info;
  const eps = season !== null ? (details?.episodes[season] ?? []) : [];
  const nextUp = (() => {
    if (!lastWatched) return null;
    const i = allEpisodes.findIndex((e) => e.id === lastWatched.id);
    if (i < 0) return null;
    const p = progress.get(lastWatched.id);
    if (p && p.duration && p.position / p.duration > 0.95) return i + 1 < allEpisodes.length ? i + 1 : null;
    return i;
  })();

  return (
    <div className="detail">
      <Backdrop src={info?.backdrop ?? info?.poster ?? series.cover} />
      <button className="btn ghost back" onClick={() => navigate(-1)}>
        <ArrowLeft size={18} /> Back
      </button>
      <div className="detail-body">
        <Img src={info?.poster ?? series.cover} alt={series.name} className="detail-poster" />
        <div className="detail-info">
          <h1>{series.name}</h1>
          <div className="meta">
            {(info?.releaseDate || series.year) && <span>{info?.releaseDate?.slice(0, 4) ?? series.year}</span>}
            {details && <span>{details.seasons.length} season{details.seasons.length === 1 ? '' : 's'}</span>}
            {(info?.rating ?? series.rating) ? (
              <span className="rating">
                <Star size={14} fill="currentColor" /> {(info?.rating ?? series.rating)!.toFixed(1)}
              </span>
            ) : null}
            {(info?.genre ?? series.genre) && <span>{info?.genre ?? series.genre}</span>}
          </div>
          {(info?.plot ?? series.plot) && <p className="plot">{info?.plot ?? series.plot}</p>}
          {info?.cast && (
            <p className="credits">
              <b>Cast:</b> {info.cast}
            </p>
          )}
          <div className="row gap wrap">
            {allEpisodes.length > 0 && (
              <button className="btn primary big" onClick={() => play.playEpisode(series, allEpisodes, nextUp ?? 0)} autoFocus>
                <Play size={18} fill="currentColor" />{' '}
                {nextUp !== null ? `${progress.get(allEpisodes[nextUp].id)?.position ? 'Resume' : 'Play'} S${allEpisodes[nextUp].season} E${allEpisodes[nextUp].episode}` : 'Play S1 E1'}
              </button>
            )}
            <button className="btn big" onClick={() => toggleFavorite(profile.id, { kind: 'series', id: series.id, name: series.name, image: series.cover })}>
              <Heart size={18} fill={isFav ? 'currentColor' : 'none'} /> {isFav ? 'Favourited' : 'Favourite'}
            </button>
            {trailerUrl(info?.trailer) && (
              <a className="btn big" href={trailerUrl(info?.trailer)} target="_blank" rel="noreferrer">
                <TrailerIcon size={18} /> Trailer
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="episodes">
        {loading && <Spinner label="Loading episodes…" />}
        {error && <div className="error-box">{error}</div>}
        {details && details.seasons.length > 0 && (
          <div className="season-tabs" role="tablist">
            {details.seasons.map((s) => (
              <button key={s.number} role="tab" aria-selected={s.number === season} className={s.number === season ? 'active' : ''} onClick={() => setSeason(s.number)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <ul className="episode-list">
          {eps.map((ep) => {
            const p = progress.get(ep.id);
            const done = p && p.duration && p.position / p.duration > 0.95;
            const i = allEpisodes.indexOf(ep);
            return (
              <li key={ep.id}>
                <button className="episode" onClick={() => play.playEpisode(series, allEpisodes, i)}>
                  <div className="ep-thumb">
                    <Img src={ep.image ?? info?.backdrop ?? series.cover} alt={ep.title} />
                    <span className="poster-play">
                      <Play size={20} fill="currentColor" />
                    </span>
                    {p && p.duration > 0 && <ProgressBar value={p.position / p.duration} className="poster-progress" />}
                  </div>
                  <div className="ep-body">
                    <div className="ep-title">
                      <span className="ep-num">E{ep.episode}</span> {ep.title}
                      {done && <Check size={14} className="ok" aria-label="Watched" />}
                    </div>
                    {ep.duration ? <div className="muted small">{formatMinutes(ep.duration)}</div> : null}
                    {ep.plot && <div className="ep-plot">{ep.plot}</div>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
