import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, Clapperboard, Film, Search as SearchIcon, Tv } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { searchProgrammes, nowNext, programmesFor, useEpg } from '../store/epg';
import { useSettings, isCategoryLocked, isUnlocked } from '../store/settings';
import { usePlay } from '../hooks/usePlay';
import { searchList } from '../lib/search';
import { formatClock, formatDay } from '../lib/format';
import { PosterCard } from '../components/Cards';
import { ProgrammeModal } from '../components/ProgrammeModal';
import { Empty, Img, useDebounced } from '../components/ui';
import type { Channel, Programme } from '../lib/types';

type Tab = 'all' | 'live' | 'movie' | 'series' | 'epg';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebounced(q, 250);
  const [tab, setTab] = useState<Tab>('all');
  const { catalog, index } = useCatalog();
  const epgVersion = useEpg((s) => s.version);
  const settings = useSettings();
  const clock24 = settings.clock24;
  const play = usePlay();
  const navigate = useNavigate();
  const [modal, setModal] = useState<{ ch: Channel; p: Programme } | null>(null);

  const allowed = useMemo(() => {
    const hidden = new Set(settings.hiddenCategories);
    return (catId: string) => {
      if (hidden.has(catId)) return false;
      if (isUnlocked()) return true;
      return !isCategoryLocked(settings, catId, index?.categoryById.get(catId)?.name ?? '');
    };
  }, [settings, index]);

  const results = useMemo(() => {
    if (!catalog || query.trim().length < 2) return null;
    const channels = catalog.channels.filter((c) => allowed(c.categoryId));
    return {
      live: searchList(channels, query, (c) => c.name, 60),
      movie: searchList(catalog.movies.filter((m) => allowed(m.categoryId)), query, (m) => m.name, 60),
      series: searchList(catalog.series.filter((s) => allowed(s.categoryId)), query, (s) => s.name, 60),
      epg: searchProgrammes(channels, query, 60),
    };
  }, [catalog, query, allowed, epgVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = (t: Tab, total: number, shown: number) =>
    tab === 'all' && total > shown ? (
      <button className="link-btn" onClick={() => setTab(t)}>
        Show all {total}
      </button>
    ) : null;

  const counts = results ? { live: results.live.length, movie: results.movie.length, series: results.series.length, epg: results.epg.length } : null;
  const show = (t: Tab) => tab === 'all' || tab === t;

  return (
    <div className="search-page">
      <div className="search-box big">
        <SearchIcon size={22} />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
          placeholder="Search channels, movies, series and TV programmes…"
          aria-label="Search"
        />
      </div>
      {counts && (
        <div className="search-tabs">
          {(
            [
              ['all', 'All', null],
              ['live', 'Channels', counts.live],
              ['movie', 'Movies', counts.movie],
              ['series', 'Series', counts.series],
              ['epg', 'On TV', counts.epg],
            ] as [Tab, string, number | null][]
          ).map(([t, label, n]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
              {n !== null && <span className="count">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {!results && <Empty icon={<SearchIcon size={36} />} title="Search everything">Type at least two letters. Search also looks through the TV guide, so you can find where a match or show is on — even across channels.</Empty>}
      {results && counts && !counts.live && !counts.movie && !counts.series && !counts.epg && <Empty title={`Nothing found for “${query}”`} />}
      {results && show('live') && results.live.length > 0 && (
        <section className="row-section">
          <div className="row-head">
            <h2>
              <Tv size={18} /> Channels
            </h2>
            {more('live', results.live.length, 8)}
          </div>
          <div className="result-list">
            {results.live.slice(0, tab === 'all' ? 8 : 60).map((c) => {
              const nn = nowNext(programmesFor(c));
              return (
                <button key={c.id} className="result-item" onClick={() => play.playChannel(c, results.live.map((x) => x.id))}>
                  <Img src={c.logo} alt={c.name} className="ch-logo" />
                  <span className="grow">
                    <span className="ch-name">{c.name}</span>
                    <span className="muted small">{nn.now ? `Now: ${nn.now.title}` : index?.categoryById.get(c.categoryId)?.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {results && show('epg') && results.epg.length > 0 && (
        <section className="row-section">
          <div className="row-head">
            <h2>
              <CalendarClock size={18} /> On TV
            </h2>
            {more('epg', results.epg.length, 8)}
          </div>
          <div className="result-list">
            {results.epg.slice(0, tab === 'all' ? 8 : 60).map((h) => {
              const now = Date.now();
              const live = h.programme.start <= now && h.programme.end > now;
              return (
                <button key={`${h.channel.id}-${h.programme.start}`} className="result-item" onClick={() => setModal({ ch: h.channel, p: h.programme })}>
                  <Img src={h.channel.logo} alt={h.channel.name} className="ch-logo" />
                  <span className="grow">
                    <span className="ch-name">
                      {live && <span className="live-dot">LIVE</span>} {h.programme.title}
                    </span>
                    <span className="muted small">
                      {h.channel.name} · {formatDay(h.programme.start)} {formatClock(h.programme.start, clock24)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {results && show('movie') && results.movie.length > 0 && (
        <section className="row-section">
          <div className="row-head">
            <h2>
              <Film size={18} /> Movies
            </h2>
            {more('movie', results.movie.length, 12)}
          </div>
          <div className="poster-wrap">
            {results.movie.slice(0, tab === 'all' ? 12 : 60).map((m) => (
              <PosterCard key={m.id} title={m.name} image={m.poster} rating={m.rating} subtitle={m.year} onClick={() => navigate(`/movies/${encodeURIComponent(m.id)}`)} />
            ))}
          </div>
        </section>
      )}
      {results && show('series') && results.series.length > 0 && (
        <section className="row-section">
          <div className="row-head">
            <h2>
              <Clapperboard size={18} /> Series
            </h2>
            {more('series', results.series.length, 12)}
          </div>
          <div className="poster-wrap">
            {results.series.slice(0, tab === 'all' ? 12 : 60).map((s) => (
              <PosterCard key={s.id} title={s.name} image={s.cover} rating={s.rating} subtitle={s.year} onClick={() => navigate(`/series/${encodeURIComponent(s.id)}`)} />
            ))}
          </div>
        </section>
      )}
      {modal && <ProgrammeModal channel={modal.ch} programme={modal.p} onClose={() => setModal(null)} />}
    </div>
  );
}
