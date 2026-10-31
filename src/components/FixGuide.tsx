import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Img, Modal, Segmented } from './ui';
import { guideLinkKind, programmesFor, resolveGuideKey, useEpg } from '../store/epg';
import { useLibrary } from '../store/library';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { matchScore, normalize } from '../lib/search';
import { channelTags } from '../lib/channelTags';
import { toast } from '../store/toast';
import type { Channel } from '../lib/types';

/** What is on a guide channel right now (or next), straight from the XMLTV data. */
function onNow(id: string): string | undefined {
  const list = useEpg.getState().data?.programmes[id];
  if (!list?.length) return undefined;
  const now = Date.now();
  const cur = list.find((t) => t[0] <= now && t[1] > now) ?? list.find((t) => t[0] > now);
  return cur?.[2];
}

/** Manually link a channel to the right guide, or borrow another channel's guide. */
export function FixGuideDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const profile = useActiveProfile();
  const data = useEpg((s) => s.data);
  const invalidate = useEpg((s) => s.invalidate);
  const setOverride = useLibrary((s) => s.setEpgOverride);
  const catalog = useCatalog((s) => s.catalog);
  const [tab, setTab] = useState<'guide' | 'channel'>('guide');
  const [q, setQ] = useState('');

  const kind = guideLinkKind(channel);
  const currentKey = resolveGuideKey(channel);
  const currentName = currentKey ? (data?.channels[currentKey]?.name ?? currentKey) : undefined;
  const base = channelTags(channel).base;

  // Guide channels: search, or suggestions ranked against the channel's cleaned name.
  const guideResults = useMemo(() => {
    if (!data) return [];
    const term = q.trim() || base;
    const all = Object.values(data.channels).filter((c) => data.programmes[c.id]?.length);
    return all
      .map((c) => ({ c, score: Math.max(matchScore(term, c.name), matchScore(term, c.id) * 0.8) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x) => x.c);
  }, [data, q, base]);

  const channelResults = useMemo(() => {
    if (!catalog) return [];
    const term = normalize(q.trim() || base);
    return catalog.channels
      .filter((c) => c.id !== channel.id && normalize(c.name).includes(term))
      .filter((c) => resolveGuideKey(c))
      .slice(0, 50);
  }, [catalog, q, base, channel.id]);

  if (!profile) return null;
  const apply = (value: string | null, label: string) => {
    setOverride(profile.id, channel.id, value);
    invalidate();
    toast.success(value ? `${channel.name} now uses the guide of ${label}` : `${channel.name} is back to automatic guide matching`);
    onClose();
  };

  return (
    <Modal title={`Fix guide · ${channel.name}`} onClose={onClose} wide>
      <p className="muted">
        {kind === 'none' && 'No guide was found for this channel.'}
        {kind === 'auto' && (
          <>
            Matched automatically to <b>{currentName}</b>
            {programmesFor(channel).length ? '' : ' (no listings)'}.
          </>
        )}
        {kind === 'manual' && (
          <>
            You linked this channel to <b>{currentName}</b>.
          </>
        )}
        {kind === 'borrowed' && 'This channel uses the guide of another of your channels.'}
      </p>
      <div className="row gap wrap">
        <Segmented
          size="small"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'guide', label: 'Guide channels' },
            { value: 'channel', label: 'Copy from my channels' },
          ]}
        />
        {(kind === 'manual' || kind === 'borrowed') && (
          <button className="btn small" onClick={() => apply(null, '')}>
            Use automatic matching
          </button>
        )}
      </div>
      <div className="search-box small">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'guide' ? `Search ${Object.keys(data?.channels ?? {}).length.toLocaleString()} guide channels` : 'Search your channels'} aria-label="Search" />
      </div>
      {!q && <p className="hint">Suggestions for “{base || channel.name}”</p>}
      <div className="picker-list">
        {tab === 'guide' &&
          guideResults.map((c) => (
            <button key={c.id} className={`overlay-ch ${c.id === currentKey ? 'active' : ''}`} onClick={() => apply(`x:${c.id}`, c.name)}>
              <Img src={c.icon} alt={c.name} className="ch-logo small" />
              <span className="grow">
                <span className="ch-name">{c.name}</span>
                <span className="ch-now-title">
                  {onNow(c.id) ?? 'No current listing'} · {c.id}
                </span>
              </span>
            </button>
          ))}
        {tab === 'channel' &&
          channelResults.map((c) => {
            const now = programmesFor(c).find((p) => p.end > Date.now());
            return (
              <button key={c.id} className="overlay-ch" onClick={() => apply(`c:${c.id}`, c.name)}>
                <Img src={c.logo} alt={c.name} className="ch-logo small" />
                <span className="grow">
                  <span className="ch-name">{c.name}</span>
                  <span className="ch-now-title">{now?.title ?? ''}</span>
                </span>
              </button>
            );
          })}
        {((tab === 'guide' && !guideResults.length) || (tab === 'channel' && !channelResults.length)) && <p className="muted pad">No matches. Try another name.</p>}
      </div>
    </Modal>
  );
}
