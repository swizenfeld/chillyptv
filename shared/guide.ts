/**
 * Links playlist channels to guide (XMLTV) channels, and trims a guide to the channels a
 * playlist actually uses. Shared by the browser and the server so both resolve identically.
 */
import { parseChannelTags } from './channels.js';
import type { EpgData } from './xmltv.js';

/** Same folding as the app's search: lower case, no accents, words only. */
export function guideNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface GuideResolver {
  byId: Map<string, string>;
  byName: Map<string, string>;
  byBase: Map<string, string>;
}

/** Listings a guide channel has (in the full guide, when the data was trimmed). */
export function listingCount(data: EpgData, id: string): number {
  return data.counts?.[id] ?? data.programmes[id]?.length ?? 0;
}

/**
 * Indexes guide channels by id, display name and cleaned base name ("ESPN 2 HD" → "espn 2").
 * When several guide channels share a name, the one with the most listings wins.
 */
export function buildGuideResolver(data: EpgData): GuideResolver {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  const byBase = new Map<string, string>();
  const size = (id: string) => listingCount(data, id);
  const put = (m: Map<string, string>, k: string, id: string) => {
    const prev = m.get(k);
    if (k && (!prev || size(id) > size(prev))) m.set(k, id);
  };
  for (const id of Object.keys(data.counts ?? data.programmes)) byId.set(id.toLowerCase(), id);
  for (const ch of Object.values(data.channels)) {
    byId.set(ch.id.toLowerCase(), ch.id);
    put(byName, guideNormalize(ch.name), ch.id);
    const base = parseChannelTags(ch.name).base;
    if (base.length >= 3) put(byBase, base, ch.id);
  }
  return { byId, byName, byBase };
}

/** Automatic link for one playlist channel: guide id, exact name, id as a name, then cleaned name. */
export function autoGuideKey(r: GuideResolver, epgId: string | undefined, name: string, base = parseChannelTags(name).base): string | undefined {
  let key = epgId ? r.byId.get(epgId.toLowerCase()) : undefined;
  key ??= r.byName.get(guideNormalize(name));
  if (!key && epgId) key = r.byName.get(guideNormalize(epgId));
  if (!key && base.length >= 3) key = r.byBase.get(base);
  return key;
}

/** A playlist channel as the trimming needs it: [guide id or "", name]. */
export type GuideWant = [string, string];

/**
 * Keeps listings only for guide channels the playlist links to (plus `keep`, e.g. manual
 * links). Every guide channel's name and listing count stay, so manual linking still works.
 */
export function trimGuide(data: EpgData, wants: GuideWant[], keep: string[] = []): EpgData {
  const r = buildGuideResolver(data);
  const used = new Set(keep.filter((id) => data.programmes[id]));
  for (const [epgId, name] of wants) {
    const k = autoGuideKey(r, epgId || undefined, name);
    if (k) used.add(k);
  }
  const counts: Record<string, number> = {};
  if (data.counts) Object.assign(counts, data.counts);
  else for (const [id, list] of Object.entries(data.programmes)) counts[id] = list.length;
  const programmes: EpgData['programmes'] = {};
  for (const id of used) if (data.programmes[id]) programmes[id] = data.programmes[id];
  return { channels: data.channels, programmes, fetchedAt: data.fetchedAt, counts };
}
