import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, Bell, BellRing, Clock, Heart, LayoutGrid, List, Maximize2, Play, Search, Star, Tv } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useFavorites, useHistory, useLibrary } from '../store/library';
import { nowNext, programmesFor, useChannelProgrammes, useEpg } from '../store/epg';
import { useSettings, isCategoryLocked, isUnlocked } from '../store/settings';
import { liveSession, usePlay } from '../hooks/usePlay';
import { CategoryList } from '../components/CategoryList';
import { Empty, Img, ProgressBar, Spinner, useNow } from '../components/ui';
import { VideoPlayer } from '../player/VideoPlayer';
import { quickFilter } from '../lib/search';
import { formatClock, formatDay } from '../lib/format';
import { canCatchup } from '../lib/streams';
import { toast } from '../store/toast';
import type { Channel, Programme } from '../lib/types';

export function useVisibleChannels(cat: string, filter: string): Channel[] {
  const profile = useActiveProfile();
  const { catalog, index } = useCatalog();
  const favs = useFavorites(profile?.id, 'live');
  const history = useHistory(profile?.id);
  const settings = useSettings();
  return useMemo(() => {
    if (!catalog || !index) return [];
    let list: Channel[];
    if (cat === '__fav') list = favs.map((f) => index.channelById.get(f.id)).filter(Boolean) as Channel[];
    else if (cat === '__recent') list = history.filter((h) => h.kind === 'live').map((h) => index.channelById.get(h.id)).filter(Boolean) as Channel[];
    else if (cat === '__archive') list = catalog.channels.filter((c) => c.archive);
    else if (cat === '__all') list = catalog.channels;
    else list = index.channelsByCategory.get(cat) ?? [];
    const hidden = new Set(settings.hiddenCategories);
    const unlocked = isUnlocked();
    if (cat.startsWith('__')) {
      list = list.filter((c) => {
        if (hidden.has(c.categoryId)) return false;
        const catName = index.categoryById.get(c.categoryId)?.name ?? '';
        return unlocked || !isCategoryLocked(settings, c.categoryId, catName);
      });
    }
    list = quickFilter(list, filter, (c) => `${c.num} ${c.name}`);
    if (cat !== '__fav' && cat !== '__recent') {
      if (settings.channelSort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
      else if (settings.channelSort === 'number') list = [...list].sort((a, b) => a.num - b.num);
    }
    return list;
  }, [catalog, index, cat, filter, favs, history, settings]);
}

export function LiveTVPage() {
  const profile = useActiveProfile();
  const { catalog, index, status } = useCatalog();
  const [params, setParams] = useSearchParams();
  const cat = params.get('cat') ?? '__all';
  const [filter, setFilter] = useState('');
  const channels = useVisibleChannels(cat, filter);
  const favs = useFavorites(profile?.id, 'live');
  const history = useHistory(profile?.id);
  const settings = useSettings();
  const setSettings = useSettings((s) => s.set);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const epgVersion = useEpg((s) => s.version);
  const play = usePlay();
  const navigate = useNavigate();
  const now = useNow(30000);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('ch'));
  const selected = (selectedId && index?.channelById.get(selectedId)) || channels[0];
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (index) for (const [k, v] of index.channelsByCategory) m.set(k, v.length);
    return m;
  }, [index]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: channels.length, getScrollElement: () => parentRef.current, estimateSize: () => 64, overscan: 8 });

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [cat]);

  const previewSession = useMemo(() => (profile && selected && settings.livePreview && !narrow ? liveSession(profile, selected) : null), [profile, selected, settings.livePreview, narrow]);

  if (status === 'loading' && !catalog) return <Spinner label="Loading channels…" />;
  if (!catalog || !index || !profile) return null;

  const zapIds = channels.map((c) => c.id);
  const openFull = (ch: Channel) => play.playChannel(ch, zapIds);

  const onListKey = (e: React.KeyboardEvent) => {
    if (!channels.length) return;
    const i = Math.max(0, channels.findIndex((c) => c.id === selected?.id));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ni = Math.max(0, Math.min(channels.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelectedId(channels[ni].id);
      virtualizer.scrollToIndex(ni, { align: 'auto' });
    } else if (e.key === 'Enter' && selected) {
      openFull(selected);
    }
  };

  void epgVersion;

  return (
    <div className="browse live">
      <CategoryList
        categories={catalog.categories.live}
        counts={counts}
        value={cat}
        onChange={(id) => {
          setParams({ cat: id });
          setFilter('');
        }}
        special={[
          { id: '__all', name: 'All channels', icon: <Tv size={16} />, count: catalog.channels.length },
          { id: '__fav', name: 'Favourites', icon: <Star size={16} />, count: favs.length },
          { id: '__recent', name: 'Recently watched', icon: <Clock size={16} />, count: history.filter((h) => h.kind === 'live').length },
          { id: '__archive', name: 'With catch-up', icon: <Archive size={16} />, count: catalog.channels.filter((c) => c.archive).length },
        ]}
      />
      <section className="channel-col">
        <div className="col-head">
          <div className="search-box">
            <Search size={16} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${channels.length} channels`} aria-label="Filter channels" />
          </div>
          <select className="select" value={settings.channelSort} onChange={(e) => setSettings({ channelSort: e.target.value as typeof settings.channelSort })} aria-label="Sort channels">
            <option value="default">Provider order</option>
            <option value="number">Number</option>
            <option value="name">A–Z</option>
          </select>
        </div>
        {channels.length === 0 ? (
          <Empty icon={<List size={36} />} title={cat === '__fav' ? 'No favourite channels yet' : 'No channels here'}>
            {cat === '__fav' && <p>Tap the heart next to a channel to add it.</p>}
          </Empty>
        ) : (
          <div className="v-list" ref={parentRef} tabIndex={0} onKeyDown={onListKey} role="listbox" aria-label="Channels">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const ch = channels[vi.index];
                const nn = nowNext(programmesFor(ch), now);
                const isFav = favs.some((f) => f.id === ch.id);
                const active = selected?.id === ch.id;
                return (
                  <div
                    key={ch.id}
                    role="option"
                    aria-selected={active}
                    className={`channel-row ${active ? 'active' : ''}`}
                    style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
                    onClick={() => (narrow || !settings.livePreview ? openFull(ch) : setSelectedId(ch.id))}
                    onDoubleClick={() => openFull(ch)}
                  >
                    <span className="ch-num">{ch.num}</span>
                    <Img src={ch.logo} alt={ch.name} className="ch-logo" />
                    <div className="ch-body">
                      <div className="ch-name">
                        {ch.name} {ch.archive && <Archive size={12} className="muted" aria-label="Catch-up available" />}
                      </div>
                      {nn.now && (
                        <div className="ch-now">
                          <span className="now-title">{nn.now.title}</span>
                          <ProgressBar value={(now - nn.now.start) / (nn.now.end - nn.now.start)} />
                        </div>
                      )}
                    </div>
                    <button
                      className={`fav-inline ${isFav ? 'on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(profile.id, { kind: 'live', id: ch.id, name: ch.name, image: ch.logo });
                      }}
                      aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
                    >
                      <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {!narrow && selected && (
        <section className="preview-col">
          {previewSession ? (
            <div className="preview-player">
              <VideoPlayer session={previewSession} variant="preview" channel={selected} onExpand={() => openFull(selected)} />
            </div>
          ) : (
            <div className="preview-placeholder">
              <Img src={selected.logo} alt={selected.name} className="big-logo" />
              <button className="btn primary" onClick={() => openFull(selected)}>
                <Play size={16} /> Watch
              </button>
            </div>
          )}
          <div className="preview-actions">
            <h2 className="preview-title">
              <span className="ch-num">{selected.num}</span> {selected.name}
            </h2>
            <div className="row gap wrap">
              <button className="btn primary" onClick={() => openFull(selected)}>
                <Maximize2 size={16} /> Full screen
              </button>
              <button className="btn" onClick={() => toggleFavorite(profile.id, { kind: 'live', id: selected.id, name: selected.name, image: selected.logo })}>
                <Heart size={16} fill={favs.some((f) => f.id === selected.id) ? 'currentColor' : 'none'} /> Favourite
              </button>
              <button
                className="btn"
                onClick={() => {
                  const mv = useLibrary.getState().multiview[profile.id] ?? { layout: '4', slots: [null, null, null, null], audioSlot: 0 };
                  const slots = [...mv.slots];
                  const empty = slots.indexOf(null);
                  if (empty >= 0) slots[empty] = selected.id;
                  else slots[slots.length - 1] = selected.id;
                  useLibrary.getState().setMultiview(profile.id, { ...mv, slots });
                  navigate('/multiview');
                }}
              >
                <LayoutGrid size={16} /> Multi-View
              </button>
            </div>
          </div>
          <ChannelEpg channel={selected} />
        </section>
      )}
    </div>
  );
}

export function ChannelEpg({ channel, compact }: { channel: Channel; compact?: boolean }) {
  const profile = useActiveProfile();
  const { list, loading } = useChannelProgrammes(profile, channel, { needArchive: true });
  const clock24 = useSettings((s) => s.clock24);
  const reminders = useLibrary((s) => s.reminders);
  const addReminder = useLibrary((s) => s.addReminder);
  const removeReminder = useLibrary((s) => s.removeReminder);
  const play = usePlay();
  const now = useNow(30000);
  const listRef = useRef<HTMLUListElement>(null);

  const visible = useMemo(() => {
    const past = channel.archive ? list.filter((p) => p.end <= now && canCatchup(channel, p, now)).slice(-24) : [];
    const upcoming = list.filter((p) => p.end > now).slice(0, compact ? 6 : 30);
    return [...past, ...upcoming];
  }, [list, now, channel, compact]);

  useEffect(() => {
    listRef.current?.querySelector('.epg-item.now')?.scrollIntoView({ block: 'center' });
  }, [channel.id, visible.length]);

  if (loading) return <Spinner size={20} label="Loading guide…" />;
  if (!visible.length) return <p className="muted pad">No programme guide for this channel.</p>;

  const toggleReminder = (p: Programme) => {
    if (!profile) return;
    const id = `${profile.id}:${channel.id}:${p.start}`;
    if (reminders.some((r) => r.id === id)) {
      removeReminder(id);
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    addReminder({ id, profileId: profile.id, channelId: channel.id, channelName: channel.name, title: p.title, start: p.start, end: p.end });
    toast.success(`Reminder set for ${p.title}`);
  };

  let lastDay = '';
  return (
    <ul className="epg-list" ref={listRef}>
      {visible.map((p) => {
        const isNow = p.start <= now && p.end > now;
        const past = p.end <= now;
        const day = formatDay(p.start);
        const showDay = day !== lastDay;
        lastDay = day;
        const reminderOn = reminders.some((r) => r.id === `${profile?.id}:${channel.id}:${p.start}`);
        return (
          <li key={`${p.start}-${p.title}`} className={`epg-item ${isNow ? 'now' : ''} ${past ? 'past' : ''}`}>
            {showDay && <div className="epg-day">{day}</div>}
            <div className="epg-line">
              <span className="time">{formatClock(p.start, clock24)}</span>
              <div className="grow">
                <div className="epg-title">{p.title}</div>
                {isNow && <ProgressBar value={(now - p.start) / (p.end - p.start)} />}
                {p.desc && (isNow || !compact) && <div className="epg-desc">{p.desc}</div>}
              </div>
              {past && canCatchup(channel, p, now) && (
                <button className="btn small" onClick={() => play.playCatchup(channel, p)} title="Watch from archive">
                  <Archive size={14} /> Watch
                </button>
              )}
              {isNow && channel.archive && (
                <button className="btn small" onClick={() => play.playCatchup(channel, p)} title="Start this programme from the beginning">
                  <Play size={14} /> From start
                </button>
              )}
              {!past && !isNow && (
                <button className={`icon-btn ${reminderOn ? 'active' : ''}`} onClick={() => toggleReminder(p)} title={reminderOn ? 'Remove reminder' : 'Remind me'}>
                  {reminderOn ? <BellRing size={16} /> : <Bell size={16} />}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
