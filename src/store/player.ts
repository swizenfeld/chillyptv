import { create } from 'zustand';
import type { SeekUrlBuilder } from '../player/engine';
import type { HistoryItem } from './library';
import type { PlayRequest } from '../lib/types';

export interface PlaySession {
  req: PlayRequest;
  seekUrl?: SeekUrlBuilder;
  /** Channel ids for up/down zapping (live). */
  zapList?: string[];
  /** Builds the session for the next item (next episode). */
  next?: () => PlaySession | null;
  /** Library entry written while playing (resume / continue watching). */
  history?: Omit<HistoryItem, 'position' | 'duration' | 'updatedAt'>;
  /** Where the close button goes. */
  returnTo?: string;
}

interface PlayerState {
  session: PlaySession | null;
  setSession: (s: PlaySession | null) => void;
}

export const usePlayer = create<PlayerState>()((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));
