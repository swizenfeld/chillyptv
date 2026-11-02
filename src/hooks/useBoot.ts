import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkBackend, setNetworkConfig } from '../lib/api';
import { useSettings } from '../store/settings';
import { getActiveProfile, useActiveProfile } from '../store/profiles';
import { useCatalog } from '../store/catalog';
import { useEpg } from '../store/epg';
import { useLibrary } from '../store/library';
import { toast } from '../store/toast';
import { usePlayer } from '../store/player';
import { liveSession } from './usePlay';
import { startSync } from '../lib/sync';
import { formatClock } from '../lib/format';

/** App-level side effects: backend probe, catalog/EPG loading, reminders, theming, sync. */
export function useBoot(): boolean {
  const [ready, setReady] = useState(false);
  const useProxy = useSettings((s) => s.useProxy);
  const userAgent = useSettings((s) => s.userAgent);
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const syncEnabled = useSettings((s) => s.syncEnabled);
  const profile = useActiveProfile();
  const catalog = useCatalog((s) => s.catalog);
  const loadCatalog = useCatalog((s) => s.load);
  const loadEpg = useEpg((s) => s.load);
  const navigate = useNavigate();

  useEffect(() => {
    setNetworkConfig({ useProxy, userAgent: userAgent || undefined });
  }, [useProxy, userAgent]);

  useEffect(() => {
    let alive = true;
    void checkBackend().then(() => alive && setReady(true));
    const t = setInterval(() => void checkBackend(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--accent', accent);
  }, [theme, accent]);

  useEffect(() => {
    if (ready && profile) void loadCatalog(profile);
  }, [ready, profile, loadCatalog]);

  useEffect(() => {
    if (!ready || !profile || !catalog || catalog.profileId !== profile.id) return;
    void loadEpg(profile, catalog);
    // The store decides whether anything is due: a stale guide, or an hourly retry during an outage.
    const t = setInterval(() => void loadEpg(profile, catalog), 15 * 60_000);
    return () => clearInterval(t);
  }, [ready, profile, catalog, loadEpg]);

  useEffect(() => {
    if (!ready || !syncEnabled) return;
    return startSync();
  }, [ready, syncEnabled]);

  // Programme reminders.
  useEffect(() => {
    const tick = () => {
      const { reminders, markReminder, removeReminder } = useLibrary.getState();
      const now = Date.now();
      for (const r of reminders) {
        if (r.end < now) {
          removeReminder(r.id);
          continue;
        }
        if (!r.notified && r.start - now <= 60_000) {
          markReminder(r.id);
          const clock24 = useSettings.getState().clock24;
          const msg = `${r.title} starts ${r.start > now ? `at ${formatClock(r.start, clock24)}` : 'now'} on ${r.channelName}`;
          const watch = () => {
            const prof = getActiveProfile();
            const ch = useCatalog.getState().index?.channelById.get(r.channelId);
            if (prof && ch && prof.id === r.profileId) {
              usePlayer.getState().setSession({ ...liveSession(prof, ch), returnTo: '/' });
              navigate('/play');
            }
          };
          toast.info(msg, { label: 'Watch', run: watch });
          if (useSettings.getState().notifications && 'Notification' in window && Notification.permission === 'granted') {
            try {
              const n = new Notification('ChillyPTV reminder', { body: msg, tag: r.id });
              n.onclick = () => {
                window.focus();
                watch();
              };
            } catch {
              /* ignore */
            }
          }
        }
      }
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [navigate]);

  return ready;
}
