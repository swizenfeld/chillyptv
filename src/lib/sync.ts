import { syncApi } from './api';
import { useProfiles } from '../store/profiles';
import { useLibrary } from '../store/library';
import { pickSettings, useSettings, type Settings } from '../store/settings';
import { toast } from '../store/toast';
import type { Profile } from './types';

interface SyncBlob {
  version: 1;
  updatedAt: number;
  profiles: Profile[];
  activeId: string | null;
  library: Pick<ReturnType<typeof useLibrary.getState>, 'favorites' | 'history' | 'reminders' | 'multiview'>;
  settings: Partial<Settings>;
}

const LOCAL_KEY = 'chilly.sync.updatedAt';
const LOCAL_ONLY: (keyof Settings)[] = ['syncEnabled', 'syncKey', 'volume', 'muted'];

export function exportState(): SyncBlob {
  const lib = useLibrary.getState();
  const settings: Partial<Settings> = { ...pickSettings(useSettings.getState()) };
  for (const k of LOCAL_ONLY) delete settings[k];
  const p = useProfiles.getState();
  return {
    version: 1,
    updatedAt: Number(localStorage.getItem(LOCAL_KEY) ?? Date.now()),
    profiles: p.profiles,
    activeId: p.activeId,
    library: { favorites: lib.favorites, history: lib.history, reminders: lib.reminders, multiview: lib.multiview },
    settings,
  };
}

export function importState(blob: SyncBlob, opts: { keepActive?: boolean } = {}): void {
  if (!blob || blob.version !== 1) throw new Error('Unsupported backup file');
  applying = true;
  try {
    const active = useProfiles.getState().activeId;
    useProfiles.getState().replaceAll(blob.profiles ?? [], opts.keepActive && blob.profiles.some((p) => p.id === active) ? active : (blob.activeId ?? null));
    useLibrary.getState().replaceAll(blob.library ?? {});
    const s = { ...blob.settings };
    for (const k of LOCAL_ONLY) delete s[k];
    useSettings.getState().set(s);
    localStorage.setItem(LOCAL_KEY, String(blob.updatedAt ?? Date.now()));
  } finally {
    applying = false;
  }
}

let applying = false;

/** Two-way sync with the ChillyPTV server (last writer wins). Returns a stop function. */
export function startSync(): () => void {
  const key = () => `sync-${useSettings.getState().syncKey.replace(/[^a-zA-Z0-9_-]/g, '') || 'default'}`;
  let timer: number | undefined;
  let stopped = false;

  const push = async () => {
    try {
      const blob = exportState();
      blob.updatedAt = Date.now();
      localStorage.setItem(LOCAL_KEY, String(blob.updatedAt));
      await syncApi.put(key(), blob);
    } catch (e) {
      console.warn('[sync] push failed', e);
    }
  };
  const schedule = () => {
    if (applying || stopped) return;
    localStorage.setItem(LOCAL_KEY, String(Date.now()));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void push(), 8000);
  };

  const pull = async () => {
    try {
      const remote = await syncApi.get<SyncBlob>(key());
      const localAt = Number(localStorage.getItem(LOCAL_KEY) ?? 0);
      if (remote && remote.updatedAt > localAt) {
        importState(remote, { keepActive: true });
        toast.info('Synced profiles and library from your server');
      } else if (!remote || remote.updatedAt < localAt) {
        await push();
      }
    } catch (e) {
      console.warn('[sync] pull failed', e);
    }
  };

  void pull();
  const unsubs = [useProfiles.subscribe(schedule), useLibrary.subscribe(schedule), useSettings.subscribe(schedule)];
  const interval = window.setInterval(() => void pull(), 5 * 60_000);
  const onFocus = () => void pull();
  window.addEventListener('focus', onFocus);
  return () => {
    stopped = true;
    unsubs.forEach((u) => u());
    window.clearInterval(interval);
    window.clearTimeout(timer);
    window.removeEventListener('focus', onFocus);
  };
}
