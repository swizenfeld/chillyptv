import { useMemo, useState } from 'react';
import { LayoutGrid, Maximize2, Plus, Volume2, VolumeX, X, Replace } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useLibrary, type MultiLayout, type MultiViewState } from '../store/library';
import { liveSession, usePlay } from '../hooks/usePlay';
import { VideoPlayer } from '../player/VideoPlayer';
import { Img, Modal, Segmented, Spinner } from '../components/ui';
import { quickFilter } from '../lib/search';
import { useSettings, isCategoryLocked, isUnlocked } from '../store/settings';
import type { Channel } from '../lib/types';

const SLOT_COUNT: Record<MultiLayout, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '1+3': 4, '9': 9 };

export function MultiViewPage() {
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const account = useCatalog((s) => s.account);
  const stored = useLibrary((s) => (profile ? s.multiview[profile.id] : undefined));
  const setMultiview = useLibrary((s) => s.setMultiview);
  const [picking, setPicking] = useState<number | null>(null);
  const play = usePlay();
  const mv: MultiViewState = stored ?? { layout: '4', slots: [null, null, null, null], audioSlot: 0 };

  if (!profile || !index) return <Spinner />;

  const save = (patch: Partial<MultiViewState>) => setMultiview(profile.id, { ...mv, ...patch });
  const setLayout = (layout: MultiLayout) => {
    const n = SLOT_COUNT[layout];
    const slots = [...mv.slots, ...Array(9).fill(null)].slice(0, n);
    save({ layout, slots, audioSlot: Math.min(mv.audioSlot, n - 1) });
  };
  const n = SLOT_COUNT[mv.layout];
  const slots = [...mv.slots, ...Array(9).fill(null)].slice(0, n);

  return (
    <div className="multiview">
      <div className="mv-head">
        <h1>
          <LayoutGrid size={22} /> Multi-View
        </h1>
        <Segmented<MultiLayout>
          value={mv.layout}
          onChange={setLayout}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '4', label: '2×2' },
            { value: '1+3', label: '1+3' },
            { value: '9', label: '3×3' },
          ]}
        />
        <span className="muted small">Click a tile to give it the audio. Each tile uses one of your provider's connections.</span>
      </div>
      {account && slots.filter(Boolean).length > account.maxConnections && (
        <p className="mv-limit" role="status">
          Your plan allows {account.maxConnections === 1 ? 'one stream' : `${account.maxConnections} streams`} at a time, so only{' '}
          {account.maxConnections === 1 ? 'one tile' : `${account.maxConnections} tiles`} can play. The provider will refuse or cut off the others.
        </p>
      )}
      <div className={`mv-grid layout-${mv.layout.replace('+', 'p')}`}>
        {slots.map((id, i) => {
          const ch = id ? index.channelById.get(id) : undefined;
          return (
            <div key={i} className={`mv-tile ${ch && mv.audioSlot === i ? 'audio' : ''}`} onClick={() => ch && save({ audioSlot: i })}>
              {ch ? (
                <MultiTile
                  channel={ch}
                  muted={mv.audioSlot !== i}
                  actions={
                    <>
                      <span className="tile-name">{ch.name}</span>
                      <span className="spacer" />
                      <button className="icon-btn" title={mv.audioSlot === i ? 'Has audio' : 'Listen'} onClick={(e) => { e.stopPropagation(); save({ audioSlot: i }); }}>
                        {mv.audioSlot === i ? <Volume2 size={16} /> : <VolumeX size={16} />}
                      </button>
                      <button className="icon-btn" title="Change channel" onClick={(e) => { e.stopPropagation(); setPicking(i); }}>
                        <Replace size={16} />
                      </button>
                      <button className="icon-btn" title="Full screen" onClick={(e) => { e.stopPropagation(); play.playChannel(ch); }}>
                        <Maximize2 size={16} />
                      </button>
                      <button className="icon-btn" title="Remove" onClick={(e) => { e.stopPropagation(); const s = [...slots]; s[i] = null; save({ slots: s }); }}>
                        <X size={16} />
                      </button>
                    </>
                  }
                />
              ) : (
                <button className="mv-empty" onClick={() => setPicking(i)}>
                  <Plus size={30} />
                  <span>Add channel</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {picking !== null && (
        <ChannelPicker
          onClose={() => setPicking(null)}
          onPick={(ch) => {
            const s = [...slots];
            s[picking] = ch.id;
            save({ slots: s, audioSlot: slots.every((x) => !x) ? picking : mv.audioSlot });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function MultiTile({ channel, muted, actions }: { channel: Channel; muted: boolean; actions: React.ReactNode }) {
  const profile = useActiveProfile();
  const session = useMemo(() => (profile ? liveSession(profile, channel) : null), [profile, channel]);
  if (!session) return null;
  return <VideoPlayer session={session} variant="tile" muted={muted} channel={channel} tileActions={actions} />;
}

export function ChannelPicker({ onPick, onClose }: { onPick: (c: Channel) => void; onClose: () => void }) {
  const catalog = useCatalog((s) => s.catalog);
  const index = useCatalog((s) => s.index);
  const settings = useSettings();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    if (!catalog || !index) return [];
    const hidden = new Set(settings.hiddenCategories);
    return quickFilter(
      catalog.channels.filter((c) => !hidden.has(c.categoryId) && (isUnlocked() || !isCategoryLocked(settings, c.categoryId, index.categoryById.get(c.categoryId)?.name ?? ''))),
      q,
      (c) => `${c.num} ${c.name} ${index.categoryById.get(c.categoryId)?.name ?? ''}`,
    ).slice(0, 300);
  }, [catalog, index, q, settings]);
  return (
    <Modal title="Choose a channel" onClose={onClose}>
      <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels or categories" aria-label="Search channels" />
      <div className="picker-list">
        {list.map((c) => (
          <button key={c.id} className="overlay-ch" onClick={() => onPick(c)}>
            <span className="ch-num">{c.num}</span>
            <Img src={c.logo} alt={c.name} className="ch-logo small" />
            <span className="grow">
              <span className="ch-name">{c.name}</span>
              <span className="ch-now-title">{index?.categoryById.get(c.categoryId)?.name}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
