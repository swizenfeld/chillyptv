import { useMemo, useState } from 'react';
import { Archive, History, Play, Search } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { useChannelProgrammes } from '../store/epg';
import { useSettings, isCategoryLocked, isUnlocked } from '../store/settings';
import { usePlay } from '../hooks/usePlay';
import { Empty, Img, Spinner, useNow } from '../components/ui';
import { quickFilter } from '../lib/search';
import { formatClock, formatDay } from '../lib/format';
import { canCatchup } from '../lib/streams';
import type { Channel } from '../lib/types';

export function CatchUpPage() {
  const { catalog, index } = useCatalog();
  const settings = useSettings();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Channel | null>(null);

  const channels = useMemo(() => {
    if (!catalog || !index) return [];
    const hidden = new Set(settings.hiddenCategories);
    const list = catalog.channels.filter((c) => c.archive && !hidden.has(c.categoryId) && (isUnlocked() || !isCategoryLocked(settings, c.categoryId, index.categoryById.get(c.categoryId)?.name ?? '')));
    return quickFilter(list, filter, (c) => c.name);
  }, [catalog, index, filter, settings]);

  if (!catalog) return <Spinner />;
  if (!catalog.channels.some((c) => c.archive))
    return (
      <Empty icon={<History size={36} />} title="No catch-up channels">
        <p>Your provider does not offer an archive (TV catch-up) for any channel.</p>
      </Empty>
    );
  const ch = selected ?? channels[0];

  return (
    <div className="browse catchup">
      <aside className="cat-list wide">
        <div className="search-box small">
          <Search size={16} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${channels.length} channels`} aria-label="Filter channels" />
        </div>
        <div className="cat-scroll">
          {channels.map((c) => (
            <button key={c.id} className={`cat-item ch ${ch?.id === c.id ? 'active' : ''}`} onClick={() => setSelected(c)}>
              <Img src={c.logo} alt={c.name} className="ch-logo small" />
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">{c.archiveDays || '?'}d</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="grid-col">{ch && <ArchiveList channel={ch} />}</section>
    </div>
  );
}

function ArchiveList({ channel }: { channel: Channel }) {
  const profile = useActiveProfile();
  const { list, loading } = useChannelProgrammes(profile, channel, { needArchive: true });
  const clock24 = useSettings((s) => s.clock24);
  const play = usePlay();
  const now = useNow(60000);
  const byDay = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const p of list) {
      if (p.start > now || !canCatchup(channel, p, now)) continue;
      const d = formatDay(p.start);
      (m.get(d) ?? m.set(d, []).get(d)!).push(p);
    }
    return [...m.entries()].reverse();
  }, [list, now, channel]);
  const [day, setDay] = useState<string | null>(null);
  const current = byDay.find(([d]) => d === day) ?? byDay[0];

  if (loading) return <Spinner label="Loading archive…" />;
  if (!byDay.length) return <Empty icon={<Archive size={32} />} title="No archived programmes found" />;
  return (
    <div className="archive">
      <h2 className="row gap">
        <Img src={channel.logo} alt={channel.name} className="ch-logo" /> {channel.name}
      </h2>
      <div className="day-tabs">
        {byDay.map(([d]) => (
          <button key={d} className={current?.[0] === d ? 'active' : ''} onClick={() => setDay(d)}>
            {d}
          </button>
        ))}
      </div>
      <ul className="epg-list flat">
        {[...(current?.[1] ?? [])].reverse().map((p) => {
          const live = p.end > now;
          return (
            <li key={p.start} className={`epg-item ${live ? 'now' : ''}`}>
              <div className="epg-line">
                <span className="time">
                  {formatClock(p.start, clock24)}–{formatClock(p.end, clock24)}
                </span>
                <div className="grow">
                  <div className="epg-title">{p.title}</div>
                  {p.desc && <div className="epg-desc">{p.desc}</div>}
                </div>
                <button className="btn small" onClick={() => play.playCatchup(channel, p)}>
                  <Play size={14} fill="currentColor" /> {live ? 'From start' : 'Watch'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
