import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
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
import type { Channel } from '../lib/types';

export function PlayerPage() {
  const session = usePlayer((s) => s.session);
  const setSession = usePlayer((s) => s.setSession);
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const catalog = useCatalog((s) => s.catalog);
  const navigate = useNavigate();
  const [listOpen, setListOpen] = useState(false);

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

  const switchTo = (ch: Channel) => setSession({ ...liveSession(profile, ch, zapList), returnTo: session.returnTo });

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
        onToggleChannelList={channel ? () => setListOpen((o) => !o) : undefined}
        sidePanel={
          listOpen && channel ? (
            <ChannelOverlay
              ids={zapList}
              current={channel.id}
              onPick={(ch) => {
                switchTo(ch);
              }}
              onClose={() => setListOpen(false)}
            />
          ) : null
        }
      />
    </div>
  );
}

function ChannelOverlay({ ids, current, onPick, onClose }: { ids: string[]; current: string; onPick: (c: Channel) => void; onClose: () => void }) {
  const index = useCatalog((s) => s.index);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const channels = useMemo(() => quickFilter(ids.map((id) => index?.channelById.get(id)).filter(Boolean) as Channel[], q, (c) => `${c.num} ${c.name}`), [ids, index, q]);
  useEffect(() => {
    ref.current?.querySelector('.active')?.scrollIntoView({ block: 'center' });
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
    <div className="channel-overlay" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="row gap">
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find channel" aria-label="Find channel" />
        <button className="icon-btn" onClick={onClose} aria-label="Close channel list">
          <X size={18} />
        </button>
      </div>
      <div className="overlay-scroll" ref={ref}>
        {channels.slice(0, 500).map((c) => {
          const nn = nowNext(programmesFor(c));
          return (
            <button key={c.id} className={`overlay-ch ${c.id === current ? 'active' : ''}`} onClick={() => onPick(c)}>
              <span className="ch-num">{c.num}</span>
              <Img src={c.logo} alt={c.name} className="ch-logo small" />
              <span className="grow">
                <span className="ch-name">{c.name}</span>
                {nn.now && <span className="ch-now-title">{nn.now.title}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
