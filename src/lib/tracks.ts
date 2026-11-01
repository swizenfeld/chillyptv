import { useEffect, useState } from 'react';
import { backendHealth, probe } from './api';
import type { MediaProbe } from '../../shared/media';

/**
 * Audio/subtitle tracks of a movie or episode file, read by the ChillyPTV server (cached there too).
 * Shared by the details pages, which start the read while you look at the page, and the player,
 * which then finds it done instead of making you wait before playback.
 */
const cache = new Map<string, Promise<MediaProbe | null>>();

export function fileTracks(url: string, ua?: string): Promise<MediaProbe | null> {
  if (!backendHealth()?.ffmpeg) return Promise.resolve(null);
  let p = cache.get(url);
  if (!p) {
    p = probe(url, ua);
    cache.set(url, p);
    void p.then((r) => !r && cache.delete(url));
  }
  return p;
}

/** Starts reading tracks for `url` (if any) and returns them once known. */
export function useFileTracks(url: string | undefined, ua?: string): MediaProbe | null {
  const [tracks, setTracks] = useState<{ url: string; probe: MediaProbe | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void fileTracks(url, ua).then((probe) => alive && setTracks({ url, probe }));
    return () => {
      alive = false;
    };
  }, [url, ua]);
  return tracks && tracks.url === url ? tracks.probe : null;
}
