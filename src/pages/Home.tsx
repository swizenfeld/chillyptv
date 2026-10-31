import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, Clapperboard, Film, History, LayoutGrid, Search, Trash2, Tv, UserRound, Video } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useFavorites, useHistory, useLibrary } from '../store/library';
import { nowNext, programmesFor } from '../store/epg';
import { useSettings } from '../store/settings';
import { usePlay } from '../hooks/usePlay';
import { useParental } from '../components/Parental';
import { ChannelTile, PosterCard, Row, WideCard } from '../components/Cards';
import { Empty, Spinner, useNow } from '../components/ui';
import { formatClock, formatDay, formatDuration } from '../lib/format';

export function HomePage() {
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const { catalog, index, status, error, account } = useCatalog();
  const history = useHistory(profile?.id);
  const favChannels = useFavorites(profile?.id, 'live');
  const reminders = useLibrary((s) => s.reminders);
  const removeReminder = useLibrary((s) => s.removeReminder);
  const clock24 = useSettings((s) => s.clock24);
  const play = usePlay();
  const { locked } = useParental();
  useNow(60000);

  const recentMovies = useMemo(() => {
    if (!catalog || !index) return [];
    return [...catalog.movies]
      .filter((m) => {
        const c = index.categoryById.get(m.categoryId);
        return !locked(m.categoryId, c?.name ?? '');
      })
      .sort((a, b) => (b.added ?? 0) - (a.added ?? 0))
      .slice(0, 20);
  }, [catalog, index, locked]);

  if (!profile) return null;
  if (status === 'loading' && !catalog) return <Spinner label="Loading your playlist…" />;
  if (status === 'error' && !catalog)
    return (
      <Empty title="Could not load the playlist">
        <p>{error}</p>
        <button className="btn primary" onClick={() => navigate('/profiles')}>
          Check playlist settings
        </button>
      </Empty>
    );
  if (!catalog || !index) return null;

  const continueWatching = history.filter((h) => h.kind !== 'live' && h.duration > 0 && h.position / h.duration < 0.95).slice(0, 20);
  const recentChannels = history.filter((h) => h.kind === 'live').slice(0, 20);
  const myReminders = reminders.filter((r) => r.profileId === profile.id);

  const resumeHistory = (h: (typeof history)[number]) => {
    if (h.kind === 'movie') {
      const m = index.movieById.get(h.id);
      if (m) play.playMovie(m, { duration: h.duration || undefined, ext: h.ext });
    } else if (h.kind === 'episode' && h.seriesId) {
      navigate(`/series/${encodeURIComponent(h.seriesId)}?resume=${encodeURIComponent(h.id)}`);
    } else if (h.kind === 'catchup') {
      navigate('/catchup');
    }
  };

  const tiles = [
    { to: '/live', icon: Tv, label: 'Live TV', count: catalog.channels.length, cls: 'tile-live' },
    { to: '/movies', icon: Film, label: 'Movies', count: catalog.movies.length, cls: 'tile-movies' },
    { to: '/series', icon: Clapperboard, label: 'Series', count: catalog.series.length, cls: 'tile-series' },
  ];
  const small = [
    { to: '/guide', icon: CalendarClock, label: 'TV Guide' },
    { to: '/catchup', icon: History, label: 'Catch-up' },
    { to: '/multiview', icon: LayoutGrid, label: 'Multi-View' },
    { to: '/search', icon: Search, label: 'Search' },
    { to: '/recordings', icon: Video, label: 'Recordings' },
    ...(account ? [{ to: '/account', icon: UserRound, label: 'Account' }] : []),
  ];

  return (
    <div className="home">
      <div className="home-tiles">
        {tiles.map((t) => (
          <button key={t.to} className={`home-tile ${t.cls}`} onClick={() => navigate(t.to)}>
            <t.icon size={42} />
            <span className="tile-label">{t.label}</span>
            <span className="tile-count">{t.count.toLocaleString()}</span>
          </button>
        ))}
        <div className="home-small">
          {small.map((t) => (
            <button key={t.to} className="small-tile" onClick={() => navigate(t.to)}>
              <t.icon size={22} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {continueWatching.length > 0 && (
        <Row title="Continue watching">
          {continueWatching.map((h) => (
            <WideCard
              key={h.key}
              title={h.kind === 'episode' ? `${h.seriesName ?? h.name}` : h.name}
              subtitle={h.kind === 'episode' ? `S${h.season} E${h.episode} · ${formatDuration(h.duration - h.position)} left` : `${formatDuration(h.duration - h.position)} left`}
              image={h.image}
              progress={h.position / h.duration}
              onClick={() => resumeHistory(h)}
            />
          ))}
        </Row>
      )}

      {favChannels.length > 0 && (
        <Row title="Favourite channels" action={<button className="link-btn" onClick={() => navigate('/live?cat=__fav')}>See all</button>}>
          {favChannels.map((f) => {
            const ch = index.channelById.get(f.id);
            if (!ch) return null;
            const nn = nowNext(programmesFor(ch));
            return <ChannelTile key={f.id} name={ch.name} logo={ch.logo} num={ch.num} now={nn.now?.title} onClick={() => play.playChannel(ch, favChannels.map((x) => x.id))} />;
          })}
        </Row>
      )}

      {recentChannels.length > 0 && (
        <Row title="Recently watched channels">
          {recentChannels.map((h) => {
            const ch = index.channelById.get(h.id);
            if (!ch) return null;
            const nn = nowNext(programmesFor(ch));
            return <ChannelTile key={h.key} name={ch.name} logo={ch.logo} num={ch.num} now={nn.now?.title} onClick={() => play.playChannel(ch, recentChannels.map((x) => x.id))} />;
          })}
        </Row>
      )}

      {myReminders.length > 0 && (
        <section className="row-section">
          <div className="row-head">
            <h2>
              <Bell size={18} /> Reminders
            </h2>
          </div>
          <ul className="reminder-list">
            {myReminders.map((r) => (
              <li key={r.id}>
                <span className="time">
                  {formatDay(r.start)} {formatClock(r.start, clock24)}
                </span>
                <span className="grow">
                  <b>{r.title}</b> · {r.channelName}
                </span>
                <button className="icon-btn" onClick={() => removeReminder(r.id)} aria-label="Remove reminder">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentMovies.length > 0 && (
        <Row title="Recently added movies" action={<button className="link-btn" onClick={() => navigate('/movies')}>Browse</button>}>
          {recentMovies.map((m) => (
            <PosterCard key={m.id} title={m.name} image={m.poster} rating={m.rating} subtitle={m.year} onClick={() => navigate(`/movies/${encodeURIComponent(m.id)}`)} />
          ))}
        </Row>
      )}
    </div>
  );
}
