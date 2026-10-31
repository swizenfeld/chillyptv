import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { del } from 'idb-keyval';
import type { Profile } from '../lib/types';

interface ProfilesState {
  profiles: Profile[];
  activeId: string | null;
  add: (p: Profile) => void;
  update: (id: string, patch: Partial<Profile>) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  replaceAll: (profiles: Profile[], activeId?: string | null) => void;
}

export const PROFILE_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#f97316'];

export const useProfiles = create<ProfilesState>()(
  persist(
    (set) => ({
      profiles: [],
      activeId: null,
      add: (p) => set((s) => ({ profiles: [...s.profiles, p], activeId: p.id })),
      update: (id, patch) => set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => {
        void del(`catalog:${id}`);
        void del(`epg:${id}`);
        void del(`m3u:${id}`);
        set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id), activeId: s.activeId === id ? null : s.activeId }));
      },
      setActive: (id) => set({ activeId: id }),
      replaceAll: (profiles, activeId) => set((s) => ({ profiles, activeId: activeId === undefined ? s.activeId : activeId })),
    }),
    { name: 'chilly.profiles', version: 1 },
  ),
);

export function useActiveProfile(): Profile | null {
  return useProfiles((s) => s.profiles.find((p) => p.id === s.activeId) ?? null);
}

export function getActiveProfile(): Profile | null {
  const s = useProfiles.getState();
  return s.profiles.find((p) => p.id === s.activeId) ?? null;
}
