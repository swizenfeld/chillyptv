import { GuideOutageNote } from '../components/GuideOutage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CalendarClock, Search } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { programmesFor, useEpg } from '../store/epg';
import { useSettings } from '../store/settings';
import { useParental } from '../components/Parental';
import { usePlay } from '../hooks/usePlay';
import { useVisibleChannels } from './LiveTV';
import { ProgrammeModal } from '../components/ProgrammeModal';
import { Empty, Img, Spinner, useNow } from '../components/ui';
import { formatClock, formatDay } from '../lib/format';
import { canCatchup } from '../lib/streams';
import type { Channel, Programme } from '../lib/types';

const PPM = 5; // pixels per minute
const ROW_H = 64;
const CH_W_WIDE = 210;
const CH_W_COMPACT = 64;

function useCompact(query = '(max-width: 900px)'): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function GuidePage() {
  const profile = useActiveProfile();
  const { catalog } = useCatalog();
  const epgStatus = useEpg((s) => s.status);
  const epgError = useEpg((s) => s.error);
  const epgVersion = useEpg((s) => s.version);
  const settings = useSettings();
  const { guard } = useParental();
  const play = usePlay();
  const now = useNow(30000);
  const [cat, setCat] = useState('__all');
  const [filter, setFilter] = useState('');
  const [dayOffset, setDayOffset] = useState(0);
  const [modal, setModal] = useState<{ ch: Channel; p: Programme } | null>(null);
  const compact = useCompact();
  const CH_W = compact ? CH_W_COMPACT : CH_W_WIDE;
  const allChannels = useVisibleChannels(cat, filter);
  // Only channels that actually have guide data make sense here.
  const channels = useMemo(() => allChannels.filter((c) => programmesFor(c).length > 0), [allChannels, epgVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + dayOffset * 86_400_000;
  }, [dayOffset]);
  const dayEnd = dayStart + 86_400_000;
  const width = 24 * 60 * PPM;

  const scrollRef = useRef<HTMLDivElement>(null);
  const dayTabsRef = useRef<HTMLDivElement>(null);
  // Keep the selected day in view when the tab strip overflows (phones).
  useEffect(() => {
    const strip = dayTabsRef.current;
    const active = strip?.querySelector<HTMLElement>('.active');
    if (strip && active) strip.scrollLeft = active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  }, [dayOffset, epgStatus]);
  const v = useVirtualizer({ count: channels.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 6 });

  const scrollToNow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const x = ((Date.now() - dayStart) / 60000) * PPM - 120;
    el.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (dayOffset === 0) el.scrollLeft = Math.max(0, ((Date.now() - dayStart) / 60000) * PPM - 120);
    else el.scrollLeft = 18 * 60 * PPM; // 18:00 prime time
  }, [dayOffset, dayStart, channels.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!catalog || !profile) return <Spinner />;
  if (epgStatus === 'loading' && !channels.length) return <Spinner label="Loading TV guide…" />;

  const days = [];
  for (let i = -settings.epgPastDays; i <= settings.epgFutureDays; i++) days.push(i);
  const zapIds = channels.map((c) => c.id);

  return (
    <div className={`guide ${compact ? 'compact' : ''}`}>
      <div className="guide-head">
        <select
          className="select"
          value={cat}
          onChange={(e) => {
            const id = e.target.value;
            const c = catalog.categories.live.find((x) => x.id === id);
            if (c) guard(c.id, c.name, () => setCat(id));
            else setCat(id);
          }}
          aria-label="Category"
        >
          <option value="__all">All channels</option>
          <option value="__fav">Favourites</option>
          <option value="__archive">With catch-up</option>
          {catalog.categories.live
            .filter((c) => !settings.hiddenCategories.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <div className="search-box">
          <Search size={16} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" aria-label="Filter channels" />
        </div>
        <div className="day-tabs" ref={dayTabsRef}>
          {days.map((d) => (
            <button key={d} className={d === dayOffset ? 'active' : ''} onClick={() => setDayOffset(d)}>
              {formatDay(Date.now() + d * 86_400_000)}
            </button>
          ))}
        </div>
        <button
          className="btn small guide-now-btn"
          onClick={() => {
            if (dayOffset !== 0) setDayOffset(0);
            else scrollToNow();
          }}
        >
          Now
        </button>
      </div>
      <GuideOutageNote />
      {!channels.length ? (
        <Empty icon={<CalendarClock size={36} />} title="No guide data">
          <p>{epgError ?? 'Your provider did not supply an EPG for these channels. You can set an XMLTV URL in the playlist settings.'}</p>
        </Empty>
      ) : (
        <div className="guide-scroll" ref={scrollRef}>
          <div className="guide-inner" style={{ width: width + CH_W, height: v.getTotalSize() + 40 }}>
            <div className="guide-times" style={{ width: width + CH_W }}>
              <div className="guide-corner" style={{ width: CH_W }} />
              {Array.from({ length: 48 }, (_, i) => (
                <div key={i} className="guide-time" style={{ left: CH_W + i * 30 * PPM, width: 30 * PPM }}>
                  {formatClock(dayStart + i * 30 * 60_000, settings.clock24)}
                </div>
              ))}
            </div>
            {now >= dayStart && now < dayEnd && <div className="guide-now" style={{ left: CH_W + ((now - dayStart) / 60000) * PPM, height: v.getTotalSize() }} />}
            {v.getVirtualItems().map((vi) => {
              const ch = channels[vi.index];
              const progs = programmesFor(ch).filter((p) => p.end > dayStart && p.start < dayEnd);
              return (
                <div key={ch.id} className="guide-row" style={{ transform: `translateY(${vi.start + 40}px)`, height: ROW_H, width: width + CH_W }}>
                  <button className="guide-ch" style={{ width: CH_W }} onClick={() => play.playChannel(ch, zapIds)} title={`Watch ${ch.name}`}>
                    <span className="ch-num">{ch.num}</span>
                    <Img src={ch.logo} alt={ch.name} className="ch-logo small" />
                    <span className="guide-ch-name">{ch.name}</span>
                  </button>
                  {progs.map((p) => {
                    const left = CH_W + (Math.max(p.start, dayStart) - dayStart) / 60000 * PPM;
                    const w = (Math.min(p.end, dayEnd) - Math.max(p.start, dayStart)) / 60000 * PPM;
                    const isNow = p.start <= now && p.end > now;
                    const past = p.end <= now;
                    return (
                      <button
                        key={p.start}
                        className={`guide-prog ${isNow ? 'now' : ''} ${past ? 'past' : ''} ${past && canCatchup(ch, p, now) ? 'archive' : ''}`}
                        style={{ left, width: Math.max(2, w - 2) }}
                        onClick={() => setModal({ ch, p })}
                        title={`${p.title} (${formatClock(p.start, settings.clock24)}–${formatClock(p.end, settings.clock24)})`}
                      >
                        <span className="gp-title">{p.title}</span>
                        <span className="gp-time">
                          {formatClock(p.start, settings.clock24)} – {formatClock(p.end, settings.clock24)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {modal && <ProgrammeModal channel={modal.ch} programme={modal.p} zapList={zapIds} onClose={() => setModal(null)} />}
    </div>
  );
}
