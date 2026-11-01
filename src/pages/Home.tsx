import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, Clapperboard, Film, Heart, History, LayoutGrid, Play, Search, Trash2, Tv, UserRound, Video } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useFavorites, useHistory, useIsFavorite, useLibrary } from '../store/library';
import { nowNext, programmesFor, useChannelProgrammes } from '../store/epg';
import { newReleases, releaseCategory } from '../lib/releases';
import { useSettings } from '../store/settings';
import { useSports } from '../store/SportsProvider';
import { MatchCard } from '../components/SportsToday';
import { liveSession, usePlay } from '../hooks/usePlay';
import { useParental } from '../components/Parental';
import { LiveCard, PosterCard, Row, RowLink, WideCard, channelHue } from '../components/Cards';
import { Empty, Img, ProgressBar, Spinner, useNow } from '../components/ui';
import { VideoPlayer } from '../player/VideoPlayer';
import { formatClock, formatDay, formatDuration, formatMinutes } from '../lib/format';
import type { Channel, Movie, Profile } from '../lib/types';

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
  const now = useNow(30000);
  const following = useSettings((s) => s.followedTeams.length > 0);

  const allowed = useMemo(() => {
    return (catId: string) => !locked(catId, index?.categoryById.get(catId)?.name ?? '');
  }, [locked, index]);

  // The provider's own "New released" category when it has one, newest additions first;
  // otherwise the newest films by release year.
  const releases = useMemo(() => {
    if (!catalog) return { movies: [] as Movie[], categoryId: undefined as string | undefined };
    const counts = new Map<string, number>();
    for (const m of catalog.movies) counts.set(m.categoryId, (counts.get(m.categoryId) ?? 0) + 1);
    const cat = releaseCategory(catalog.categories.movie.filter((c) => allowed(c.id)), (id) => counts.get(id) ?? 0);
    if (cat) {
      const inCat = catalog.movies.filter((m) => m.categoryId === cat.id).sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
      return { movies: inCat.slice(0, 20), categoryId: cat.id };
    }
    return { movies: newReleases(catalog.movies.filter((m) => allowed(m.categoryId))), categoryId: undefined };
  }, [catalog, allowed]);

  const recentSeries = useMemo(() => {
    if (!catalog) return [];
    return catalog.series.filter((s) => allowed(s.categoryId)).sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)).slice(0, 20);
  }, [catalog, allowed]);

  // The hero shows what is on now: last watched channel, else a favourite, else the first channel.
  const heroChannel = useMemo<Channel | undefined>(() => {
    if (!catalog || !index) return undefined;
    const ok = (c?: Channel): c is Channel => !!c && allowed(c.categoryId);
    const recent = history.filter((h) => h.kind === 'live').map((h) => index.channelById.get(h.id)).find(ok);
    if (recent) return recent;
    const fav = favChannels.map((f) => index.channelById.get(f.id)).find(ok);
    return fav ?? catalog.channels.find(ok);
  }, [catalog, index, history, favChannels, allowed]);

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
  const recentChannels = history
    .filter((h) => h.kind === 'live')
    .map((h) => index.channelById.get(h.id))
    .filter((c): c is Channel => !!c && allowed(c.categoryId))
    .slice(0, 20);
  const favList = favChannels.map((f) => index.channelById.get(f.id)).filter((c): c is Channel => !!c);
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

  const shortcuts = [
    { to: '/live', icon: Tv, label: 'Live TV', count: catalog.channels.length },
    { to: '/movies', icon: Film, label: 'Movies', count: catalog.movies.length },
    { to: '/series', icon: Clapperboard, label: 'Series', count: catalog.series.length },
    { to: '/guide', icon: CalendarClock, label: 'TV Guide' },
    { to: '/catchup', icon: History, label: 'Catch-up' },
    { to: '/multiview', icon: LayoutGrid, label: 'Multi-View' },
    { to: '/search', icon: Search, label: 'Search' },
    { to: '/recordings', icon: Video, label: 'Recordings' },
    ...(account ? [{ to: '/account', icon: UserRound, label: 'Account' }] : []),
  ];

  const liveCards = (list: Channel[]) =>
    list.map((ch) => (
      <LiveCard key={ch.id} channel={ch} programme={nowNext(programmesFor(ch), now).now} now={now} onClick={() => play.playChannel(ch, list.map((x) => x.id))} />
    ));

  return (
    <div className="home">
      {heroChannel && <LiveHero profile={profile} channel={heroChannel} now={now} onWatch={() => play.playChannel(heroChannel, recentChannels.length > 1 ? recentChannels.map((c) => c.id) : undefined)} />}

      <nav className="shortcuts" aria-label="Browse">
        {shortcuts.map((t) => (
          <button key={t.to} className="shortcut-chip" onClick={() => navigate(t.to)}>
            <t.icon size={18} aria-hidden />
            <span>{t.label}</span>
            {t.count !== undefined && <span className="shortcut-count">{t.count.toLocaleString()}</span>}
          </button>
        ))}
      </nav>

      {following && <YourTeamsRow />}

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

      {favList.length > 0 && (
        <Row title="Favourite channels" action={<RowLink to="/live?cat=__fav" />}>
          {liveCards(favList)}
        </Row>
      )}

      {recentChannels.length > 0 && (
        <Row title="Recently watched" action={<RowLink to="/live?cat=__recent" />}>
          {liveCards(recentChannels)}
        </Row>
      )}

      {myReminders.length > 0 && (
        <section className="row-section">
          <div className="row-head inline">
            <h2>
              <Bell size={18} aria-hidden /> Reminders
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

      {releases.movies.length > 0 && (
        <Row title="New releases" action={<RowLink to={releases.categoryId ? `/movies?cat=${encodeURIComponent(releases.categoryId)}&sort=added` : '/movies?sort=year'} />}>
          {releases.movies.map((m) => (
            <PosterCard key={m.id} title={m.name} image={m.poster} rating={m.rating} subtitle={m.year} onClick={() => navigate(`/movies/${encodeURIComponent(m.id)}`)} />
          ))}
        </Row>
      )}

      {recentSeries.length > 0 && (
        <Row title="Recently updated series" action={<RowLink to="/series" />}>
          {recentSeries.map((s) => (
            <PosterCard key={s.id} title={s.name} image={s.cover} rating={s.rating} subtitle={s.year} onClick={() => navigate(`/series/${encodeURIComponent(s.id)}`)} />
          ))}
        </Row>
      )}
    </div>
  );
}

/** Billboard for live TV: a muted live preview (or channel art) with what is on now. */
function LiveHero({ profile, channel, now, onWatch }: { profile: Profile; channel: Channel; now: number; onWatch: () => void }) {
  const navigate = useNavigate();
  const livePreview = useSettings((s) => s.livePreview);
  const clock24 = useSettings((s) => s.clock24);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const isFav = useIsFavorite(profile.id, 'live', channel.id);
  const { list } = useChannelProgrammes(profile, channel);
  const nn = nowNext(list, now);
  const session = useMemo(() => (livePreview ? liveSession(profile, channel) : null), [livePreview, profile, channel]);
  const p = nn.now;

  return (
    <section className="hero" aria-label={`On now: ${channel.name}`} style={{ '--hue': channelHue(channel.name) } as React.CSSProperties}>
      <div className="hero-media" aria-hidden>
        <div className="hero-art">
          <Img src={channel.logo} alt="" className="hero-art-logo" />
        </div>
        {session && <VideoPlayer session={session} variant="tile" muted channel={channel} />}
      </div>
      <div className="hero-scrim" />
      <div className="hero-body">
        <h1 className="hero-title">{p?.title ?? channel.name}</h1>
        <div className="hero-meta">
          <span className="live-pill">Live</span>
          {p && (
            <span className="tabular">
              {formatClock(p.start, clock24)}–{formatClock(p.end, clock24)}
            </span>
          )}
          <span className="hero-channel">
            <Img src={channel.logo} alt="" className="hero-channel-logo" />
            {channel.name}
          </span>
          {p && <span>{formatMinutes(Math.max(0, p.end - now) / 1000)} left</span>}
        </div>
        {p && <ProgressBar value={(now - p.start) / (p.end - p.start)} className="hero-progress" />}
        {p?.desc && <p className="hero-desc">{p.desc}</p>}
        <div className="hero-actions">
          <button className="btn primary big" onClick={onWatch}>
            <Play size={18} fill="currentColor" /> Watch live
          </button>
          <button className="btn big glass" onClick={() => navigate(`/live?ch=${encodeURIComponent(channel.id)}`)}>
            <CalendarClock size={18} /> <span className="label-long">Programme guide</span>
            <span className="label-short">Guide</span>
          </button>
          <button
            className={`icon-btn glass round ${isFav ? 'active' : ''}`}
            onClick={() => toggleFavorite(profile.id, { kind: 'live', id: channel.id, name: channel.name, image: channel.logo })}
            aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={isFav}
          >
            <Heart size={20} fill={isFav ? 'currentColor' : 'none'} />
          </button>
        </div>
        {nn.next && (
          <p className="hero-next">
            Up next · <span className="tabular">{formatClock(nn.next.start, clock24)}</span> {nn.next.title}
          </p>
        )}
      </div>
    </section>
  );
}

/** Followed teams' matches today, live first. Mounted only when the viewer follows a team. */
function YourTeamsRow() {
  const sports = useSports();
  const play = usePlay();
  const navigate = useNavigate();
  const matches = sports.matches.filter((m) => m.followed && m.state !== 'post');
  if (!matches.length) return null;
  return (
    <Row title="Your teams today" action={<RowLink to="/live?cat=__sports" />}>
      {matches.map((m) => (
        <div key={m.fixture.id} className="team-row-card">
          <MatchCard m={m} compact onSelect={(ch) => play.playMatch(m, ch)} onOpen={(mm, ch) => (mm.channels.length ? play.playMatch(mm, ch) : navigate('/live?cat=__sports'))} />
        </div>
      ))}
    </Row>
  );
}
