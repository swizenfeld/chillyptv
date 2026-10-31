import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSportsToday, type SportsToday } from './sports';
import { useSettings } from './settings';
import { toast } from './toast';
import { usePlay } from '../hooks/usePlay';
import { formatClock } from '../lib/format';

interface SportsCtx {
  data: SportsToday;
  setDemand: (fn: (n: number) => number) => void;
}

const Ctx = createContext<SportsCtx | null>(null);

/**
 * One shared "sports today" computation for Live TV, Home, team alerts and the player.
 * It only runs while a screen asks for it (useSports) or the viewer follows a team.
 */
export function SportsProvider({ children }: { children: ReactNode }) {
  const [demand, setDemand] = useState(0);
  const following = useSettings((s) => s.followedTeams.length > 0);
  const data = useSportsToday(demand > 0 || following);
  const value = useMemo(() => ({ data, setDemand }), [data]);
  return (
    <Ctx.Provider value={value}>
      <TeamAlerts data={data} />
      {children}
    </Ctx.Provider>
  );
}

/** Today's matches; mounting a consumer switches the computation on. */
export function useSports(): SportsToday {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('SportsProvider missing');
  const { setDemand } = ctx;
  useEffect(() => {
    setDemand((n) => n + 1);
    return () => setDemand((n) => n - 1);
  }, [setDemand]);
  return ctx.data;
}

const ALERTED_KEY = 'chilly.teamAlerts';

function loadAlerted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ALERTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** "Boca Juniors v River Plate starts at 20:00" — once per match, shortly before kick-off. */
function TeamAlerts({ data }: { data: SportsToday }) {
  const minutes = useSettings((s) => s.teamAlertMinutes);
  const notify = useSettings((s) => s.notifications);
  const clock24 = useSettings((s) => s.clock24);
  const play = usePlay();
  useEffect(() => {
    if (!minutes) return;
    const now = Date.now();
    const alerted = loadAlerted();
    let changed = false;
    for (const m of data.matches) {
      if (!m.followed || alerted.has(m.fixture.id)) continue;
      const until = m.fixture.start - now;
      const soon = m.state === 'pre' && until <= minutes * 60_000;
      const justStarted = m.state === 'in' && until > -20 * 60_000;
      if (!soon && !justStarted) continue;
      alerted.add(m.fixture.id);
      changed = true;
      const title = `${m.fixture.home.name} v ${m.fixture.away.name}`;
      const when = m.state === 'in' ? 'is on now' : `starts at ${formatClock(m.fixture.start, clock24)}`;
      const where = m.channels[0] ? ` on ${m.channels[0].channel.name}` : ' (not found in your channels)';
      const watch = m.channels.length ? { label: 'Watch', run: () => play.playMatch(m) } : undefined;
      toast.info(`${title} ${when}${where}`, watch);
      if (notify && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body: `${m.fixture.leagueName} · ${when}${where}`, tag: m.fixture.id });
          n.onclick = () => {
            window.focus();
            watch?.run();
          };
        } catch {
          /* ignore */
        }
      }
    }
    if (changed) {
      try {
        localStorage.setItem(ALERTED_KEY, JSON.stringify([...alerted].slice(-200)));
      } catch {
        /* ignore */
      }
    }
  }, [data.matches, minutes, notify, clock24]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
