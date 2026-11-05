/**
 * Links playlist channels to guide (XMLTV) channels, and trims a guide to the channels a
 * playlist actually uses. Shared by the browser and the server so both resolve identically.
 */
import { COUNTRY_WORDS, parseChannelTags } from './channels.js';
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

// ---------------------------------------------------------------- regions
// "AR| ESPN 2" and "US| ESPN 2" are different channels with different listings: Argentina's
// shows South American football in Spanish. Guide channels are linked with their country in mind.

const CANON: Record<string, string> = {
  AR: 'AR', ARG: 'AR', LAT: 'LAT', LATAM: 'LAT', LATINO: 'LAT', MX: 'MX', MEX: 'MX', MXC: 'MX', CO: 'CO', COL: 'CO', CL: 'CL', CHI: 'CL',
  PE: 'PE', PER: 'PE', UY: 'UY', URU: 'UY', PY: 'PY', EC: 'EC', VE: 'VE', BO: 'BO', CR: 'CR', DO: 'DO', PR: 'PR',
  ES: 'ES', ESP: 'ES', US: 'US', USA: 'US', UK: 'UK', GB: 'UK', CA: 'CA', AU: 'AU', IE: 'IE', NZ: 'NZ',
  BR: 'BR', PT: 'PT', IT: 'IT', ITA: 'IT', FR: 'FR', FRA: 'FR', DE: 'DE', GER: 'DE', NL: 'NL', TR: 'TR',
};

/** Country code from a playlist or guide tag ("ARG" → "AR"); language-only tags ("EN") give none. */
export function canonicalRegion(code: string | undefined): string | undefined {
  return code ? CANON[code.toUpperCase()] : undefined;
}

const COUNTRY_WORDS_RE = new RegExp(COUNTRY_WORDS.map(([re]) => re.source).join('|'), 'g');

/** "espn 2 argentina" → "espn 2": the country is matched separately. */
function withoutCountry(base: string): string {
  return base.replace(COUNTRY_WORDS_RE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The country of a guide channel: its own id ("TyCSports.ar", "ESPN2.us@East"), its name
 * ("AR: ESPN 2", "ESPN 2 Argentina", "ESPN 2 (AR)"), else the guide it came from.
 */
export function guideChannelRegion(id: string, name: string, sourceRegion?: string): string | undefined {
  const fromId = id.match(/\.([a-z]{2,3})(?:@[\w-]*)?$/i)?.[1];
  const r = canonicalRegion(fromId) ?? canonicalRegion(parseChannelTags(name).region) ?? canonicalRegion(name.match(/[([]\s*([a-z]{2,3})\s*[)\]]\s*$/i)?.[1]);
  if (r) return r;
  const folded = guideNormalize(name);
  for (const [re, code] of COUNTRY_WORDS) if (re.test(folded)) return code;
  return sourceRegion;
}

/** The country a guide address is for: ".../epg_ripper_AR1.xml.gz", ".../epg-ar.xml", ".../argentina.xml". */
export function regionFromUrl(url: string): string | undefined {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* not a URL: use as is */
  }
  const file = path.split('/').pop() ?? '';
  const code = file.match(/^(?:.*[_-])?([a-z]{2})\d?\.xml(?:\.gz)?$/i)?.[1];
  const r = canonicalRegion(code);
  if (r) return r;
  const folded = guideNormalize(path);
  for (const [re, c] of COUNTRY_WORDS) if (re.test(folded)) return c;
  return undefined;
}

const LATAM = ['LAT', 'AR', 'CL', 'UY', 'PY', 'CO', 'PE', 'EC', 'BO', 'VE', 'MX', 'CR', 'DO', 'PR'];

/** Guide countries acceptable for a channel of `region`, best first. */
export function guideRegionsFor(region: string): string[] {
  if (region === 'LAT') return LATAM;
  if (region === 'AR') return ['AR', 'LAT', 'UY', 'PY'];
  if (LATAM.includes(region)) return [region, 'LAT'];
  if (region === 'UK') return ['UK', 'IE'];
  if (region === 'IE') return ['IE', 'UK'];
  return [region];
}

export interface GuideResolver {
  byId: Map<string, string>;
  /** Candidates per normalised display name / cleaned base name, most listings first. */
  byName: Map<string, string[]>;
  byBase: Map<string, string[]>;
  regionOf: Map<string, string | undefined>;
}

/** Listings a guide channel has (in the full guide, when the data was trimmed). */
export function listingCount(data: EpgData, id: string): number {
  return data.counts?.[id] ?? data.programmes[id]?.length ?? 0;
}

/**
 * Indexes guide channels by id, display name and cleaned base name ("ESPN 2 HD" → "espn 2"), with
 * each one's country. `sourceRegion` is the country of the whole guide (an Argentina guide).
 */
export function buildGuideResolver(data: EpgData, sourceRegion?: string): GuideResolver {
  const byId = new Map<string, string>();
  const byName = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  const regionOf = new Map<string, string | undefined>();
  const add = (m: Map<string, string[]>, k: string, id: string) => {
    if (!k) return;
    const list = m.get(k);
    if (list) list.push(id);
    else m.set(k, [id]);
  };
  for (const id of Object.keys(data.counts ?? data.programmes)) byId.set(id.toLowerCase(), id);
  for (const ch of Object.values(data.channels)) {
    byId.set(ch.id.toLowerCase(), ch.id);
    regionOf.set(ch.id, canonicalRegion(ch.region) ?? guideChannelRegion(ch.id, ch.name, sourceRegion));
    add(byName, guideNormalize(ch.name), ch.id);
    const base = withoutCountry(parseChannelTags(ch.name).base);
    if (base.length >= 3) add(byBase, base, ch.id);
  }
  const size = (id: string) => listingCount(data, id);
  for (const m of [byName, byBase]) for (const list of m.values()) if (list.length > 1) list.sort((a, b) => size(b) - size(a));
  return { byId, byName, byBase, regionOf };
}

/**
 * The best of several same-named guide channels for a channel of `region`: one from that country
 * (or a neighbour sharing its feeds), else one of unknown country. One from another country never
 * fits: "AR| ESPN 2" showing the US ESPN 2's listings is worse than no guide at all.
 */
function pick(r: GuideResolver, list: string[] | undefined, region: string | undefined): string | undefined {
  if (!list?.length) return undefined;
  if (!region) return list[0];
  for (const want of guideRegionsFor(region)) {
    const hit = list.find((id) => r.regionOf.get(id) === want);
    if (hit) return hit;
  }
  return list.find((id) => !r.regionOf.get(id));
}

/**
 * Automatic link for one playlist channel: guide id, exact name, id as a name, then cleaned name,
 * keeping to the channel's country when it has one ("AR| ESPN 2" → Argentina's ESPN 2).
 */
export function autoGuideKey(r: GuideResolver, epgId: string | undefined, name: string, base?: string, region?: string): string | undefined {
  if (base === undefined || region === undefined) {
    const tags = parseChannelTags(name);
    base ??= tags.base;
    region ??= tags.region;
  }
  const country = canonicalRegion(region);
  let key = epgId ? r.byId.get(epgId.toLowerCase()) : undefined;
  key ??= pick(r, r.byName.get(guideNormalize(name)), country);
  if (!key && epgId) key = pick(r, r.byName.get(guideNormalize(epgId)), country);
  const b = withoutCountry(base);
  if (!key && b.length >= 3) key = pick(r, r.byBase.get(b), country);
  return key;
}

/** A playlist channel as the trimming needs it: [guide id or "", name, country tag?]. */
export type GuideWant = [string, string, string?];

/**
 * Keeps listings only for guide channels the playlist links to (plus `keep`, e.g. manual
 * links). Every guide channel's name and listing count stay, so manual linking still works.
 */
export function trimGuide(data: EpgData, wants: GuideWant[], keep: string[] = [], sourceRegion?: string): EpgData {
  const r = buildGuideResolver(data, sourceRegion);
  const used = new Set(keep.filter((id) => data.programmes[id]));
  for (const [epgId, name, region] of wants) {
    const k = autoGuideKey(r, epgId || undefined, name, undefined, region || undefined);
    if (k) used.add(k);
  }
  const counts: Record<string, number> = {};
  if (data.counts) Object.assign(counts, data.counts);
  else for (const [id, list] of Object.entries(data.programmes)) counts[id] = list.length;
  const programmes: EpgData['programmes'] = {};
  for (const id of used) if (data.programmes[id]) programmes[id] = data.programmes[id];
  return { channels: data.channels, programmes, fetchedAt: data.fetchedAt, counts };
}
