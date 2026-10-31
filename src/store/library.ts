import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

export type FavKind = 'live' | 'movie' | 'series';

export interface FavItem {
  kind: FavKind;
  id: string;
  name: string;
  image?: string;
  addedAt: number;
}

export interface HistoryItem {
  /** e.g. "live:12", "movie:5001", "episode:123" */
  key: string;
  kind: 'live' | 'movie' | 'episode' | 'catchup';
  id: string;
  name: string;
  image?: string;
  position: number;
  duration: number;
  updatedAt: number;
  seriesId?: string;
  seriesName?: string;
  season?: number;
  episode?: number;
  ext?: string;
}

export interface Reminder {
  id: string;
  profileId: string;
  channelId: string;
  channelName: string;
  title: string;
  start: number;
  end: number;
  notified?: boolean;
}

export type MultiLayout = '1' | '2' | '3' | '4' | '1+3' | '9';

export interface MultiViewState {
  layout: MultiLayout;
  slots: (string | null)[];
  audioSlot: number;
}

interface LibraryState {
  favorites: Record<string, FavItem[]>;
  history: Record<string, HistoryItem[]>;
  reminders: Reminder[];
  multiview: Record<string, MultiViewState>;
  lastChannel: Record<string, string[]>;
  toggleFavorite: (profileId: string, item: Omit<FavItem, 'addedAt'>) => void;
  moveFavorite: (profileId: string, kind: FavKind, id: string, dir: -1 | 1) => void;
  recordProgress: (profileId: string, item: Omit<HistoryItem, 'updatedAt'>) => void;
  removeHistory: (profileId: string, key: string) => void;
  clearHistory: (profileId: string) => void;
  addReminder: (r: Reminder) => void;
  removeReminder: (id: string) => void;
  markReminder: (id: string) => void;
  setMultiview: (profileId: string, mv: MultiViewState) => void;
  pushChannel: (profileId: string, channelId: string) => void;
  replaceAll: (data: Partial<Pick<LibraryState, 'favorites' | 'history' | 'reminders' | 'multiview'>>) => void;
}

const MAX_HISTORY = 200;

export const useLibrary = create<LibraryState>()(
  persist(
    (set) => ({
      favorites: {},
      history: {},
      reminders: [],
      multiview: {},
      lastChannel: {},
      toggleFavorite: (profileId, item) =>
        set((s) => {
          const list = s.favorites[profileId] ?? [];
          const exists = list.some((f) => f.kind === item.kind && f.id === item.id);
          const next = exists ? list.filter((f) => !(f.kind === item.kind && f.id === item.id)) : [...list, { ...item, addedAt: Date.now() }];
          return { favorites: { ...s.favorites, [profileId]: next } };
        }),
      moveFavorite: (profileId, kind, id, dir) =>
        set((s) => {
          const list = [...(s.favorites[profileId] ?? [])];
          const ofKind = list.filter((f) => f.kind === kind);
          const idx = ofKind.findIndex((f) => f.id === id);
          const swap = idx + dir;
          if (idx < 0 || swap < 0 || swap >= ofKind.length) return s;
          [ofKind[idx], ofKind[swap]] = [ofKind[swap], ofKind[idx]];
          const others = list.filter((f) => f.kind !== kind);
          return { favorites: { ...s.favorites, [profileId]: [...others, ...ofKind] } };
        }),
      recordProgress: (profileId, item) =>
        set((s) => {
          const list = (s.history[profileId] ?? []).filter((h) => h.key !== item.key);
          list.unshift({ ...item, updatedAt: Date.now() });
          return { history: { ...s.history, [profileId]: list.slice(0, MAX_HISTORY) } };
        }),
      removeHistory: (profileId, key) => set((s) => ({ history: { ...s.history, [profileId]: (s.history[profileId] ?? []).filter((h) => h.key !== key) } })),
      clearHistory: (profileId) => set((s) => ({ history: { ...s.history, [profileId]: [] } })),
      addReminder: (r) => set((s) => ({ reminders: [...s.reminders.filter((x) => x.id !== r.id), r].sort((a, b) => a.start - b.start) })),
      removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),
      markReminder: (id) => set((s) => ({ reminders: s.reminders.map((r) => (r.id === id ? { ...r, notified: true } : r)) })),
      setMultiview: (profileId, mv) => set((s) => ({ multiview: { ...s.multiview, [profileId]: mv } })),
      pushChannel: (profileId, channelId) =>
        set((s) => {
          const list = (s.lastChannel[profileId] ?? []).filter((c) => c !== channelId);
          list.unshift(channelId);
          return { lastChannel: { ...s.lastChannel, [profileId]: list.slice(0, 20) } };
        }),
      replaceAll: (data) => set(data),
    }),
    { name: 'chilly.library', version: 1 },
  ),
);

export function useFavorites(profileId: string | undefined, kind?: FavKind): FavItem[] {
  return useLibrary(
    useShallow((s) => {
      const list = profileId ? (s.favorites[profileId] ?? EMPTY_FAVS) : EMPTY_FAVS;
      return kind ? list.filter((f) => f.kind === kind) : list;
    }),
  );
}

export function useIsFavorite(profileId: string | undefined, kind: FavKind, id: string): boolean {
  return useLibrary((s) => !!profileId && (s.favorites[profileId] ?? []).some((f) => f.kind === kind && f.id === id));
}

export function useHistory(profileId: string | undefined): HistoryItem[] {
  return useLibrary((s) => (profileId ? (s.history[profileId] ?? EMPTY_HIST) : EMPTY_HIST));
}

const EMPTY_FAVS: FavItem[] = [];
const EMPTY_HIST: HistoryItem[] = [];
