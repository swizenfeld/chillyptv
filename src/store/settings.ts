import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'oled';
export type AspectMode = 'contain' | 'cover' | 'fill' | '16:9' | '4:3';

export interface Settings {
  theme: Theme;
  accent: string;
  clock24: boolean;
  useProxy: boolean;
  userAgent: string;
  autoReconnect: boolean;
  liveBufferSec: number;
  defaultAspect: AspectMode;
  autoplayNext: boolean;
  preferredAudioLang: string;
  preferredSubLang: string;
  volume: number;
  muted: boolean;
  livePreview: boolean;
  showStats: boolean;
  epgShiftHours: number;
  epgPastDays: number;
  epgFutureDays: number;
  pin: string | null;
  lockedCategories: string[];
  autoLockAdult: boolean;
  hideLockedContent: boolean;
  hiddenCategories: string[];
  syncEnabled: boolean;
  syncKey: string;
  notifications: boolean;
  preferRemux: boolean;
  channelSort: 'default' | 'name' | 'number';
  movieSort: 'added' | 'name' | 'rating' | 'year';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#38bdf8',
  clock24: true,
  useProxy: true,
  userAgent: '',
  autoReconnect: true,
  liveBufferSec: 30,
  defaultAspect: 'contain',
  autoplayNext: true,
  preferredAudioLang: '',
  preferredSubLang: '',
  volume: 1,
  muted: false,
  livePreview: true,
  showStats: false,
  epgShiftHours: 0,
  epgPastDays: 3,
  epgFutureDays: 3,
  pin: null,
  lockedCategories: [],
  autoLockAdult: true,
  hideLockedContent: false,
  hiddenCategories: [],
  syncEnabled: false,
  syncKey: 'default',
  notifications: true,
  preferRemux: false,
  channelSort: 'default',
  movieSort: 'added',
};

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'chilly.settings', version: 1, merge: (persisted, current) => ({ ...current, ...(persisted as object) }) },
  ),
);

export function pickSettings(s: SettingsState): Settings {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = (s as unknown as Record<string, unknown>)[k];
  return out as unknown as Settings;
}

// ----- parental control -----------------------------------------------------
const ADULT_RE = /\b(adult|xxx|18\+|porn|erotic|for adults)\b/i;
let unlocked = false;
try {
  unlocked = sessionStorage.getItem('chilly.unlocked') === '1';
} catch {
  /* ignore */
}

export function isAdultName(name: string): boolean {
  return ADULT_RE.test(name);
}

export function isCategoryLocked(s: Settings, categoryId: string, categoryName: string): boolean {
  if (!s.pin) return false;
  if (s.lockedCategories.includes(categoryId)) return true;
  return s.autoLockAdult && isAdultName(categoryName);
}

export function isUnlocked(): boolean {
  return unlocked;
}

export function setUnlocked(v: boolean): void {
  unlocked = v;
  try {
    sessionStorage.setItem('chilly.unlocked', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
