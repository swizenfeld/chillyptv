import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, Film, Search, Star } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useFavorites, useHistory, useLibrary } from '../store/library';
import { isCategoryLocked, isUnlocked, useSettings } from '../store/settings';
import { CategoryList } from '../components/CategoryList';
import { VirtualGrid } from '../components/VirtualGrid';
import { PosterCard } from '../components/Cards';
import { Empty, Spinner } from '../components/ui';
import { quickFilter } from '../lib/search';
import type { ContentKind, Movie, SeriesItem } from '../lib/types';

type Item = Movie | SeriesItem;

export function MoviesPage() {
  return <VodBrowser kind="movie" />;
}

export function SeriesPage() {
  return <VodBrowser kind="series" />;
}

function VodBrowser({ kind }: { kind: Extract<ContentKind, 'movie' | 'series'> }) {
  const profile = useActiveProfile();
  const { catalog, index, status } = useCatalog();
  const [params, setParams] = useSearchParams();
  const cat = params.get('cat') ?? '__all';
  const [filter, setFilter] = useState('');
  const settings = useSettings();
  const setSettings = useSettings((s) => s.set);
  const favs = useFavorites(profile?.id, kind);
  const history = useHistory(profile?.id);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const navigate = useNavigate();
  // "See all" links can pick the sort ("/movies?sort=year" from New releases); it then sticks like a manual choice.
  const sortParam = params.get('sort');
  useEffect(() => {
    if (sortParam === 'added' || sortParam === 'name' || sortParam === 'rating' || sortParam === 'year') {
      setSettings({ movieSort: sortParam });
      const next = new URLSearchParams(params);
      next.delete('sort');
      setParams(next, { replace: true });
    }
  }, [sortParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const all: Item[] = useMemo(() => (kind === 'movie' ? (catalog?.movies ?? []) : (catalog?.series ?? [])), [catalog, kind]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of all) m.set(it.categoryId, (m.get(it.categoryId) ?? 0) + 1);
    return m;
  }, [all]);

  const progress = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) {
      if (kind === 'movie' && h.kind === 'movie' && h.duration) m.set(h.id, h.position / h.duration);
      if (kind === 'series' && h.kind === 'episode' && h.seriesId && !m.has(h.seriesId) && h.duration) m.set(h.seriesId, h.position / h.duration);
    }
    return m;
  }, [history, kind]);

  const items = useMemo(() => {
    if (!index) return [];
    let list: Item[];
    if (cat === '__fav') {
      const ids = new Set(favs.map((f) => f.id));
      list = all.filter((x) => ids.has(x.id));
    } else if (cat === '__recent') {
      const ids = history.filter((h) => (kind === 'movie' ? h.kind === 'movie' : h.kind === 'episode')).map((h) => (kind === 'movie' ? h.id : h.seriesId));
      const seen = new Set<string>();
      list = ids.filter((id): id is string => !!id && !seen.has(id) && !!seen.add(id)).map((id) => (kind === 'movie' ? index.movieById.get(id) : index.seriesById.get(id))).filter(Boolean) as Item[];
    } else if (cat === '__all') list = all;
    else list = all.filter((x) => x.categoryId === cat);
    if (cat.startsWith('__')) {
      const hidden = new Set(settings.hiddenCategories);
      const unlocked = isUnlocked();
      list = list.filter((x) => !hidden.has(x.categoryId) && (unlocked || !isCategoryLocked(settings, x.categoryId, index.categoryById.get(x.categoryId)?.name ?? '')));
    }
    list = quickFilter(list, filter, (x) => x.name);
    if (cat !== '__recent') {
      const s = settings.movieSort;
      const addedOf = (x: Item) => ('added' in x ? (x.added ?? 0) : ((x as SeriesItem).lastModified ?? 0));
      if (s === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
      else if (s === 'rating') list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      else if (s === 'year') list = [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      else if (s === 'added') list = [...list].sort((a, b) => addedOf(b) - addedOf(a));
    }
    return list;
  }, [all, cat, filter, favs, history, index, kind, settings]);

  if (status === 'loading' && !catalog) return <Spinner label="Loading library…" />;
  if (!catalog || !profile) return null;
  const label = kind === 'movie' ? 'movies' : 'series';
  const open = (it: Item) => navigate(`/${kind === 'movie' ? 'movies' : 'series'}/${encodeURIComponent(it.id)}`);

  return (
    <div className="browse vod">
      <CategoryList
        categories={catalog.categories[kind]}
        counts={counts}
        value={cat}
        onChange={(id) => {
          setParams({ cat: id });
          setFilter('');
        }}
        special={[
          { id: '__all', name: `All ${label}`, icon: <Film size={16} />, count: all.length },
          { id: '__fav', name: 'Favourites', icon: <Star size={16} />, count: favs.length },
          { id: '__recent', name: 'Recently watched', icon: <Clock size={16} /> },
        ]}
      />
      <section className="grid-col">
        <div className="col-head">
          <div className="search-box">
            <Search size={16} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${items.length} ${label}`} aria-label={`Filter ${label}`} />
          </div>
          <select className="select" value={settings.movieSort} onChange={(e) => setSettings({ movieSort: e.target.value as typeof settings.movieSort })} aria-label="Sort">
            <option value="added">Recently added</option>
            <option value="name">A–Z</option>
            <option value="rating">Top rated</option>
            <option value="year">Newest year</option>
          </select>
        </div>
        {items.length === 0 && catalog?.libraryPending ? (
          <Spinner label={`Loading ${label}… Live TV is ready while this finishes.`} />
        ) : items.length === 0 ? (
          <Empty icon={<Film size={36} />} title={`No ${label} here`} />
        ) : (
          <VirtualGrid
            resetKey={cat}
            items={items}
            render={(it) => (
              <PosterCard
                key={it.id}
                title={it.name}
                image={'poster' in it ? it.poster : (it as SeriesItem).cover}
                rating={it.rating}
                subtitle={it.year}
                progress={progress.get(it.id)}
                favorite={favs.some((f) => f.id === it.id)}
                onFavorite={() => toggleFavorite(profile.id, { kind, id: it.id, name: it.name, image: 'poster' in it ? it.poster : (it as SeriesItem).cover })}
                onClick={() => open(it)}
              />
            )}
          />
        )}
      </section>
    </div>
  );
}
