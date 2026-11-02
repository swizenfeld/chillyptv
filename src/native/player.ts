import { Capacitor, registerPlugin } from '@capacitor/core';
import { liveRequest } from '../lib/streams';
import { feedName } from '../lib/channelTags';
import { nowNext, programmesFor } from '../store/epg';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import type { PlaySession } from '../store/player';
import type { Channel, Profile } from '../lib/types';

interface NativeItem {
  id: string;
  url: string;
  title: string;
  subtitle?: string;
  backups?: string[];
}

interface NativePlayerPlugin {
  play(opts: {
    items: NativeItem[];
    index: number;
    live: boolean;
    startAt?: number;
    userAgent?: string;
    preferredAudioLang?: string;
    preferredSubLang?: string;
    autoplayNext?: boolean;
  }): Promise<{ index: number; id: string | null; position: number; duration: number; ended: boolean }>;
}

const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');

/** Running as the Android / Fire TV app (Capacitor), not in a browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Channels around the current one for Up/Down zapping (a zap list can hold 15,000 channels). */
const ZAP_WINDOW = 400;

function liveItem(profile: Profile, ch: Channel): NativeItem {
  const req = liveRequest(profile, ch);
  const now = nowNext(programmesFor(ch)).now;
  return { id: ch.id, url: req.url, title: `${ch.num}  ${feedName(ch)}`, subtitle: now?.title, backups: req.fallbackUrl ? [req.fallbackUrl] : [] };
}

/**
 * Plays a session in the native full-screen player (ExoPlayer) and, when it closes, records what
 * was watched (history, resume position, recent channels) the way the web player does.
 */
export async function playNative(session: PlaySession, profile: Profile): Promise<void> {
  const s = useSettings.getState();
  const index = useCatalog.getState().index;
  const lib = useLibrary.getState();
  const prefs = { userAgent: profile.userAgent, preferredAudioLang: s.preferredAudioLang || undefined, preferredSubLang: s.preferredSubLang || undefined };

  if (session.req.kind === 'live' && index) {
    const ids = session.zapList?.length ? session.zapList : session.history ? [session.history.id] : [];
    const at = Math.max(0, ids.indexOf(session.history?.id ?? ''));
    const from = Math.max(0, Math.min(at - ZAP_WINDOW / 2, ids.length - ZAP_WINDOW));
    const window = ids.slice(from, from + ZAP_WINDOW);
    const channels = window.map((id) => index.channelById.get(id)).filter(Boolean) as Channel[];
    const items = channels.map((ch) => liveItem(profile, ch));
    const cur = Math.max(0, channels.findIndex((c) => c.id === session.history?.id));
    // A match's other feeds are backups for the one chosen (after its own HLS/TS alternative).
    if (session.alternates && items[cur]) {
      for (const id of session.alternates.all) {
        const ch = index.channelById.get(id);
        if (ch && id !== items[cur].id) items[cur].backups!.push(liveRequest(profile, ch).url);
      }
    }
    if (!items.length) return;
    const r = await NativePlayer.play({ items, index: cur, live: true, ...prefs });
    const watched = channels[r.index] ?? channels[cur];
    lib.pushChannel(profile.id, watched.id);
    lib.recordProgress(profile.id, { key: `live:${watched.id}`, kind: 'live', id: watched.id, name: watched.name, image: watched.logo, position: 0, duration: 0 });
    return;
  }

  // Movies, episodes (with the following episodes queued), catch-up.
  const sessions: PlaySession[] = [session];
  for (let next = session.next?.(); next && sessions.length < 30; next = next.next?.()) sessions.push(next);
  const items: NativeItem[] = sessions.map((x, i) => ({
    id: x.history?.key ?? String(i),
    url: x.req.url,
    title: x.req.title,
    subtitle: x.req.subtitle,
    backups: x.req.fallbackUrl ? [x.req.fallbackUrl] : [],
  }));
  const r = await NativePlayer.play({ items, index: 0, live: false, startAt: session.req.startAt ?? 0, autoplayNext: s.autoplayNext, ...prefs });
  const watched = sessions[r.index] ?? session;
  if (watched.history && r.duration > 0) {
    lib.recordProgress(profile.id, { ...watched.history, position: r.ended ? r.duration : r.position, duration: r.duration });
  }
}
