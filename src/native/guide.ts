import { registerPlugin } from '@capacitor/core';
import { autoGuideKey, buildGuideResolver, regionFromUrl, type GuideWant } from '../../shared/guide';
import type { EpgData } from '../../shared/xmltv';

interface NativeGuidePlugin {
  scan(o: { url: string; userAgent?: string }): Promise<{ file: string; channels: { id: string; name: string; icon?: string }[]; counts: Record<string, number> }>;
  programmes(o: { file: string; ids: string[]; from: number; to: number }): Promise<{ json: string }>;
}

const NativeGuide = registerPlugin<NativeGuidePlugin>('NativeGuide');

/**
 * Loads an XMLTV guide on the device (Android / Fire TV app) keeping only the listings the playlist
 * needs: the native side scans the guide's channels, the shared resolver picks the ones linked to
 * playlist channels (or linked by hand), and only those listings come back to the web view.
 */
export async function loadGuideNatively(url: string, ua: string | undefined, wants: GuideWant[], keep: string[], window: { from: number; to: number }): Promise<EpgData> {
  const scan = await NativeGuide.scan({ url, userAgent: ua });
  const channels: EpgData['channels'] = {};
  for (const c of scan.channels) if (c.id) channels[c.id] = { id: c.id, name: c.name, icon: c.icon };
  const skeleton: EpgData = { channels, programmes: {}, counts: scan.counts, fetchedAt: Date.now() };
  const resolver = buildGuideResolver(skeleton, regionFromUrl(url));
  const ids = new Set(keep.filter((id) => scan.counts[id]));
  for (const [epgId, name, region] of wants) {
    const k = autoGuideKey(resolver, epgId || undefined, name, undefined, region || undefined);
    if (k && scan.counts[k]) ids.add(k);
  }
  const { json } = await NativeGuide.programmes({ file: scan.file, ids: [...ids], from: window.from, to: window.to });
  return { ...skeleton, programmes: JSON.parse(json) as EpgData['programmes'] };
}
