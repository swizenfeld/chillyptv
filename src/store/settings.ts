import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LEAGUES } from '../../shared/sports';

/** Competitions that existed before settings v3 (anything else is new to existing users). */
const V2_LEAGUES = ['usa.1', 'uefa.champions', 'concacaf.champions', 'conmebol.libertadores', 'eng.1', 'eng.2', 'eng.fa', 'eng.league_cup', 'esp.1', 'esp.2', 'esp.copa_del_rey', 'arg.1', 'arg.copa'];

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
  /** ESPN league slugs tracked by Sports today. */
  sportsLeagues: string[];
  /** Fetch fixtures online (ESPN) instead of relying on the TV guide only. */
  sportsOnline: boolean;
  /** Commentary languages in order of preference, for ranking feeds of the same match. */
  feedLanguages: string[];
  /** Best quality worth preferring when several feeds show the same match. */
  feedMaxQuality: 'uhd' | 'fhd' | 'hd';
  /** Switch to another feed of the same match automatically when the stream fails. */
  autoFailover: boolean;
  followedTeams: FollowedTeam[];
  /** Alert this many minutes before a followed team kicks off (0 = off). */
  teamAlertMinutes: number;
}

export interface FollowedTeam {
  name: string;
  logo?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#e50914',
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
  sportsLeagues: DEFAULT_LEAGUES,
  sportsOnline: true,
  feedLanguages: defaultLanguages(),
  feedMaxQuality: 'uhd',
  autoFailover: true,
  followedTeams: [],
  teamAlertMinutes: 10,
};

function defaultLanguages(): string[] {
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2).toLowerCase() : '';
  return nav && nav !== 'en' ? [nav, 'en'] : ['en', 'es'];
}

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
    {
      name: 'chilly.settings',
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<Settings>;
        // v2: the default accent moved from sky blue to cinema red; keep any colour the viewer chose.
        if (version < 2 && (!state.accent || state.accent === '#38bdf8')) state.accent = '#e50914';
        // v3: many more competitions. Switch on the new defaults without touching earlier choices.
        if (version < 3 && Array.isArray(state.sportsLeagues)) {
          const known = new Set(V2_LEAGUES);
          state.sportsLeagues = [...new Set([...state.sportsLeagues, ...DEFAULT_LEAGUES.filter((id) => !known.has(id))])];
        }
        return state as SettingsState;
      },
      merge: (persisted, current) => ({ ...current, ...(persisted as object) }),
    },
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
