import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Heart, Trash2 } from 'lucide-react';
import { useActiveProfile } from '../store/profiles';
import { useCatalog } from '../store/catalog';
import { useFavorites, useLibrary, useHistory, type FavKind } from '../store/library';
import { nowNext, programmesFor } from '../store/epg';
import { usePlay } from '../hooks/usePlay';
import { PosterCard } from '../components/Cards';
import { Empty, Img } from '../components/ui';
import { relativeTime, formatDuration } from '../lib/format';

export function FavoritesPage() {
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const live = useFavorites(profile?.id, 'live');
  const movies = useFavorites(profile?.id, 'movie');
  const series = useFavorites(profile?.id, 'series');
  const history = useHistory(profile?.id);
  const { toggleFavorite, moveFavorite, removeHistory, clearHistory } = useLibrary();
  const play = usePlay();
  const navigate = useNavigate();
  if (!profile || !index) return null;
  const remove = (kind: FavKind, id: string, name: string) => toggleFavorite(profile.id, { kind, id, name });

  return (
    <div className="favorites">
      <h1>
        <Heart size={22} /> Favourites
      </h1>
      {!live.length && !movies.length && !series.length && <Empty title="No favourites yet">Use the heart icon on channels, movies and series.</Empty>}
      {live.length > 0 && (
        <section className="row-section">
          <h2>Channels</h2>
          <ul className="fav-list">
            {live.map((f, i) => {
              const ch = index.channelById.get(f.id);
              const nn = ch ? nowNext(programmesFor(ch)) : {};
              return (
                <li key={f.id}>
                  <button className="grow fav-main" disabled={!ch} onClick={() => ch && play.playChannel(ch, live.map((x) => x.id))}>
                    <Img src={ch?.logo ?? f.image} alt={f.name} className="ch-logo" />
                    <span className="grow">
                      <span className="ch-name">{ch?.name ?? f.name}</span>
                      <span className="muted small">{ch ? (nn.now?.title ?? '') : 'No longer in playlist'}</span>
                    </span>
                  </button>
                  <button className="icon-btn" disabled={i === 0} onClick={() => moveFavorite(profile.id, 'live', f.id, -1)} aria-label="Move up">
                    <ArrowUp size={16} />
                  </button>
                  <button className="icon-btn" disabled={i === live.length - 1} onClick={() => moveFavorite(profile.id, 'live', f.id, 1)} aria-label="Move down">
                    <ArrowDown size={16} />
                  </button>
                  <button className="icon-btn" onClick={() => remove('live', f.id, f.name)} aria-label="Remove">
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {movies.length > 0 && (
        <section className="row-section">
          <h2>Movies</h2>
          <div className="poster-wrap">
            {movies.map((f) => (
              <PosterCard key={f.id} title={f.name} image={index.movieById.get(f.id)?.poster ?? f.image} favorite onFavorite={() => remove('movie', f.id, f.name)} onClick={() => navigate(`/movies/${encodeURIComponent(f.id)}`)} />
            ))}
          </div>
        </section>
      )}
      {series.length > 0 && (
        <section className="row-section">
          <h2>Series</h2>
          <div className="poster-wrap">
            {series.map((f) => (
              <PosterCard key={f.id} title={f.name} image={index.seriesById.get(f.id)?.cover ?? f.image} favorite onFavorite={() => remove('series', f.id, f.name)} onClick={() => navigate(`/series/${encodeURIComponent(f.id)}`)} />
            ))}
          </div>
        </section>
      )}
      {history.length > 0 && (
        <section className="row-section">
          <div className="row-head">
            <h2>Watch history</h2>
            <button className="link-btn" onClick={() => confirm('Clear the whole watch history for this playlist?') && clearHistory(profile.id)}>
              Clear history
            </button>
          </div>
          <ul className="fav-list">
            {history.slice(0, 100).map((h) => (
              <li key={h.key}>
                <Img src={h.image} alt={h.name} className="ch-logo" />
                <span className="grow">
                  <span className="ch-name">{h.kind === 'episode' ? `${h.seriesName} · S${h.season} E${h.episode}` : h.name}</span>
                  <span className="muted small">
                    {h.kind} · {relativeTime(h.updatedAt)}
                    {h.duration ? ` · ${formatDuration(h.position)} / ${formatDuration(h.duration)}` : ''}
                  </span>
                </span>
                <button className="icon-btn" onClick={() => removeHistory(profile.id, h.key)} aria-label="Remove from history">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
