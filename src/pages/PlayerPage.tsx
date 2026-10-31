import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Layers, Search, X } from 'lucide-react';
import { usePlayer } from '../store/player';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useLibrary } from '../store/library';
import { nowNext, programmesFor } from '../store/epg';
import { liveSession } from '../hooks/usePlay';
import { VideoPlayer } from '../player/VideoPlayer';
import { Img } from '../components/ui';
import { quickFilter } from '../lib/search';
import { toast } from '../store/toast';
import { formatMinutes } from '../lib/format';
import { channelTags, feedName } from '../lib/channelTags';
import { QUALITY_LABEL } from '../../shared/channels';
import { useSettings } from '../store/settings';
import type { Channel } from '../lib/types';

export function PlayerPage() {
  const session = usePlayer((s) => s.session);
  const setSession = usePlayer((s) => s.setSession);
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const catalog = useCatalog((s) => s.catalog);
  const navigate = useNavigate();
  const [listOpen, setListOpen] = useState<false | 'channels' | 'feeds'>(false);
  const autoFailover = useSettings((s) => s.autoFailover);

  const channel = session?.req.channelId ? index?.channelById.get(session.req.channelId) : undefined;
  const zapList = useMemo(() => session?.zapList ?? catalog?.channels.map((c) => c.id) ?? [], [session?.zapList, catalog]);

  useEffect(() => {
    document.body.classList.add('playing');
    return () => {
      document.body.classList.remove('playing');
      // Clear on unmount (not in close()) so the <Navigate to="/"> fallback never races the route change.
      usePlayer.getState().setSession(null);
    };
  }, []);

  if (!session || !profile) return <Navigate to="/" replace />;

  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    const to = session.returnTo ?? '/';
    navigate(to, { replace: true });
  };

  const alt = session.alternates;
  // Staying inside the match's feeds keeps the backup list; any other channel drops it.
  const switchTo = (ch: Channel, auto = false) => {
    const keep = alt && alt.all.includes(ch.id);
    setSession({
      ...liveSession(profile, ch, zapList),
      alternates: keep ? { ...alt, tried: auto ? [...alt.tried, ch.id] : [ch.id] } : undefined,
      returnTo: session.returnTo,
    });
  };

  /** Automatic backup: the stream died for good, move to the best feed not tried yet. */
  const onFatal = () => {
    if (!alt || !autoFailover || !index) return;
    const nextId = alt.all.find((id) => !alt.tried.includes(id));
    const next = nextId ? index.channelById.get(nextId) : undefined;
    if (!next) {
      toast.error(`All ${alt.all.length} feeds for ${alt.label} failed`);
      return;
    }
    toast.info(`${channel ? feedName(channel) : 'This feed'} stopped. Switched to ${feedName(next)}.`);
    switchTo(next, true);
  };

  const zap = (dir: 1 | -1) => {
    if (!channel || !index || !zapList.length) return;
    const i = zapList.indexOf(channel.id);
    const next = zapList[(i + dir + zapList.length) % zapList.length];
    const ch = index.channelById.get(next);
    if (ch) switchTo(ch);
  };

  const zapTo = (num: number) => {
    const ch = catalog?.channels.find((c) => c.num === num);
    if (ch) switchTo(ch);
    else toast.info(`No channel ${num}`);
  };

  const prevChannel = () => {
    const recent = useLibrary.getState().lastChannel[profile.id] ?? [];
    const prev = recent.find((id) => id !== channel?.id);
    const ch = prev ? index?.channelById.get(prev) : undefined;
    if (ch) switchTo(ch);
  };

  const next = session.next
    ? () => {
        const n = session.next!();
        if (n) setSession({ ...n, returnTo: session.returnTo });
      }
    : undefined;

  return (
    <div className="player-page">
      <VideoPlayer
        session={session}
        variant="full"
        channel={channel}
        onClose={close}
        onZap={channel ? zap : undefined}
        onZapTo={channel ? zapTo : undefined}
        onPrevChannel={channel ? prevChannel : undefined}
        onNext={next}
        onFatal={onFatal}
        onToggleChannelList={channel ? () => setListOpen((o) => (o ? false : 'channels')) : undefined}
        topActions={
          alt && alt.all.length > 1 ? (
            <button className="btn small glass" onClick={() => setListOpen((o) => (o === 'feeds' ? false : 'feeds'))} title={`Other channels showing ${alt.label}`}>
              <Layers size={14} /> Feeds · {alt.all.length}
            </button>
          ) : null
        }
        sidePanel={
          listOpen && channel ? (
            <ChannelOverlay
              ids={listOpen === 'feeds' && alt ? alt.all : zapList}
              title={listOpen === 'feeds' && alt ? alt.label : undefined}
              current={channel.id}
              onPick={(ch) => switchTo(ch)}
              onClose={() => setListOpen(false)}
            />
          ) : null
        }
      />
    </div>
  );
}

function ChannelOverlay({ ids, current, onPick, onClose, title }: { ids: string[]; current: string; onPick: (c: Channel) => void; onClose: () => void; title?: string }) {
  const index = useCatalog((s) => s.index);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('__all');
  const ref = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const all = useMemo(() => ids.map((id) => index?.channelById.get(id)).filter(Boolean) as Channel[], [ids, index]);
  // Category chips for the categories present in this channel list, in list order.
  const cats = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of all) if (!seen.has(c.categoryId)) seen.set(c.categoryId, index?.categoryById.get(c.categoryId)?.name ?? '');
    return [...seen.entries()].filter(([, name]) => name).slice(0, 16);
  }, [all, index]);
  const channels = useMemo(() => quickFilter(cat === '__all' ? all : all.filter((c) => c.categoryId === cat), q, (c) => `${c.num} ${c.name}`), [all, cat, q]);
  useEffect(() => {
    const list = ref.current;
    const active = list?.querySelector<HTMLElement>('.active');
    if (list && active) list.scrollTop = active.offsetTop - list.clientHeight / 3;
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="channel-overlay" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="dialog" aria-label="Channels">
      <div className="overlay-head">
        <div className="search-box small">
          <Search size={16} aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find channel or number" aria-label="Find channel" />
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close channel list">
          <X size={18} />
        </button>
      </div>
      {title && <p className="overlay-feeds-title">Feeds for {title}, best first</p>}
      {!title && cats.length > 1 && (
        <div className="overlay-cats" role="tablist" aria-label="Categories">
          {[['__all', 'All'] as [string, string], ...cats].map(([id, name]) => (
            <button key={id} role="tab" aria-selected={cat === id} className={cat === id ? 'active' : ''} onClick={() => setCat(id)}>
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="overlay-scroll" ref={ref}>
        {channels.slice(0, 500).map((c) => {
          const p = nowNext(programmesFor(c), now).now;
          const watching = c.id === current;
          return (
            <button key={c.id} className={`overlay-ch ${watching ? 'active' : ''}`} onClick={() => onPick(c)} aria-current={watching}>
              <Img src={c.logo} alt="" className="overlay-logo" />
              <span className="grow">
                {watching && <span className="watching-pill">Watching</span>}
                <span className="overlay-title">{p?.title ?? c.name}</span>
                <span className="overlay-meta">
                  {title && <FeedBadges ch={c} />}
                  <span className="tabular">{c.num}</span> {title ? feedName(c) : c.name}
                  {p ? ` · ${formatMinutes(Math.max(0, p.end - now) / 1000)} left` : ''}
                </span>
              </span>
            </button>
          );
        })}
        {!channels.length && <p className="overlay-empty">No channels match.</p>}
      </div>
    </div>
  );
}

/** Quality / language / variant badges for a feed. */
export function FeedBadges({ ch }: { ch: Channel }) {
  const t = channelTags(ch);
  const q = QUALITY_LABEL[t.quality];
  return (
    <>
      {q && <span className="feed-badge">{q}</span>}
      {t.lang && <span className="feed-badge">{t.lang.toUpperCase()}</span>}
      {t.variant && <span className="feed-badge">{t.variant}</span>}
      {t.event === 'ended' && <span className="feed-badge muted">Ended</span>}
    </>
  );
}
