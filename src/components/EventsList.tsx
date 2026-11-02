import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { Empty, Img } from './ui';
import { FeedBadges } from '../pages/PlayerPage';
import { feedName } from '../lib/channelTags';
import { formatClock } from '../lib/format';
import { quickFilter } from '../lib/search';
import { useSettings } from '../store/settings';
import { SPORTS, type Sport, type SportEvent } from '../lib/events';
import type { Channel } from '../lib/types';

const SOON_MS = 3 * 3_600_000;

/** Every sport's events from event channels, by sport and time, each with its feeds. */
export function EventsList({ events, filter, now, selectedId, onSelect, onOpen }: {
  events: SportEvent[];
  filter: string;
  now: number;
  selectedId?: string;
  onSelect: (c: Channel) => void;
  onOpen: (c: Channel, e: SportEvent) => void;
}) {
  const [sport, setSport] = useState<Sport | 'all'>('all');
  const [later, setLater] = useState(false);
  const sports = useMemo(() => {
    const n = new Map<Sport, number>();
    for (const e of events) n.set(e.sport, (n.get(e.sport) ?? 0) + 1);
    return SPORTS.filter((s) => n.has(s)).map((s) => [s, n.get(s)!] as const);
  }, [events]);
  const shown = useMemo(() => {
    const bySport = sport === 'all' ? events : events.filter((e) => e.sport === sport);
    return quickFilter(bySport, filter, (e) => `${e.title} ${e.sport} ${e.feeds.map((f) => feedName(f.channel)).join(' ')}`);
  }, [events, sport, filter]);

  const endOfDay = new Date(now);
  endOfDay.setHours(24, 0, 0, 0);
  const sections: [string, SportEvent[]][] = [
    ['Live now', shown.filter((e) => e.start <= now && e.end > now)],
    ['Starting soon', shown.filter((e) => e.start > now && e.start <= now + SOON_MS)],
    ['Later today', shown.filter((e) => e.start > now + SOON_MS && e.start < endOfDay.getTime())],
  ];
  const coming = shown.filter((e) => e.start >= endOfDay.getTime());

  return (
    <div className="sports">
      <div className="sports-head">
        <div className="sports-chips" role="tablist" aria-label="Sports">
          <button role="tab" aria-selected={sport === 'all'} className={sport === 'all' ? 'active' : ''} onClick={() => setSport('all')}>
            All
          </button>
          {sports.map(([s, n]) => (
            <button key={s} role="tab" aria-selected={sport === s} className={sport === s ? 'active' : ''} onClick={() => setSport(s)}>
              {s} <span className="count">{n}</span>
            </button>
          ))}
        </div>
        <p className="sports-source">Events from your event and PPV channels, read from their names.</p>
      </div>
      {!shown.length ? (
        <Empty icon={<CalendarClock size={36} />} title={filter ? `No events match “${filter}”` : 'No events listed'}>
          {!filter && <p>Event channels that name an event and a time (“… | Team A vs. Team B (2026-11-02 19:00)”) show up here.</p>}
        </Empty>
      ) : (
        <div className="sports-scroll">
          {sections.map(([label, list]) =>
            list.length ? (
              <section key={label} className="sports-section">
                <h3>
                  {label} <span className="count">{list.length}</span>
                </h3>
                {list.map((e) => (
                  <EventCard key={`${e.key}|${e.start}`} e={e} now={now} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} />
                ))}
              </section>
            ) : null,
          )}
          {coming.length > 0 && (
            <section className="sports-section">
              <button className="sports-fold" aria-expanded={later} onClick={() => setLater((v) => !v)}>
                <ChevronDown size={16} className={later ? 'open' : ''} /> Coming days <span className="count">{coming.length}</span>
              </button>
              {later && coming.map((e) => <EventCard key={`${e.key}|${e.start}`} e={e} now={now} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} withDay />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({ e, now, selectedId, onSelect, onOpen, withDay }: {
  e: SportEvent;
  now: number;
  selectedId?: string;
  onSelect: (c: Channel) => void;
  onOpen: (c: Channel, e: SportEvent) => void;
  withDay?: boolean;
}) {
  const clock24 = useSettings((s) => s.clock24);
  const [all, setAll] = useState(false);
  const live = e.start <= now && e.end > now;
  const [title, competition] = e.title.split(' · ');
  const day = withDay ? `${new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ` : '';
  const shown = all ? e.feeds : e.feeds.slice(0, 3);
  return (
    <article className={`match-card event-card ${live ? 'state-in' : 'state-pre'}`}>
      <header className="match-head">
        <span className="match-league">
          {e.sport}
          {competition ? ` · ${competition}` : ''}
        </span>
        {live ? <span className="live-pill">Live</span> : <span className="match-time tabular">{day}{formatClock(e.start, clock24)}</span>}
      </header>
      <div className="event-title">{title}</div>
      <div className="match-channels" aria-label={`Channels showing ${title}`}>
        {shown.map((f, i) => (
          <button key={f.channel.id} className={`match-ch ${selectedId === f.channel.id ? 'active' : ''} ${i === 0 ? 'best' : ''}`} onClick={() => onSelect(f.channel)} onDoubleClick={() => onOpen(f.channel, e)} title={f.channel.name}>
            <Img src={f.channel.logo} alt="" className="match-ch-logo" />
            <span className="match-ch-name">{feedName(f.channel)}</span>
            <span className="match-ch-badges">
              <FeedBadges ch={f.channel} />
            </span>
          </button>
        ))}
        {e.feeds.length > 3 && (
          <button className="match-more" onClick={() => setAll((v) => !v)}>
            <ChevronDown size={14} /> {all ? 'Show fewer' : `${e.feeds.length - 3} more feed${e.feeds.length - 3 === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </article>
  );
}
