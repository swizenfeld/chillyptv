import { useEffect, useState } from 'react';
import { backendHealth, probe } from './api';
import type { MediaProbe } from '../../shared/media';

/**
 * Audio/subtitle tracks of a movie or episode file, read by the ChillyPTV server (cached there too).
 * The details pages start the read while you look at the page; the player then finds it done
 * instead of making you wait before playback.
 *
 * Reading a file uses a provider connection. On a one-connection plan a read nobody waits for
 * any more would block the stream that's about to open, so unwanted reads are cancelled
 * (the server stops ffmpeg when every request for it has gone).
 */
interface Entry {
  promise: Promise<MediaProbe | null>;
  controller: AbortController;
  pending: boolean;
  /** The player wants it: leaving the details page must not cancel it. */
  claimed: boolean;
}
const cache = new Map<string, Entry>();

export function fileTracks(url: string, ua?: string, opts: { claim?: boolean } = {}): Promise<MediaProbe | null> {
  if (!backendHealth()?.ffmpeg) return Promise.resolve(null);
  let e = cache.get(url);
  if (!e) {
    const controller = new AbortController();
    const entry: Entry = { promise: probe(url, ua, controller.signal), controller, pending: true, claimed: false };
    e = entry;
    cache.set(url, entry);
    void entry.promise.then((r) => {
      entry.pending = false;
      if (!r && cache.get(url) === entry) cache.delete(url);
    });
  }
  if (opts.claim) e.claimed = true;
  return e.promise;
}

/** A read of this file was started (and hasn't failed): waiting for it is worthwhile. */
export function tracksRequested(url: string): boolean {
  return cache.has(url);
}

/** Stops a read still in progress (the player gave up waiting and is about to open the stream). */
export function cancelTracks(url: string): void {
  const e = cache.get(url);
  if (e?.pending) {
    e.controller.abort();
    cache.delete(url);
  }
}

/** The details page went away: cancel its read shortly unless the player took it over. */
export function releaseTracks(url: string): void {
  setTimeout(() => {
    const e = cache.get(url);
    if (e && !e.claimed) cancelTracks(url);
  }, 3000);
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
      releaseTracks(url);
    };
  }, [url, ua]);
  return tracks && tracks.url === url ? tracks.probe : null;
}
