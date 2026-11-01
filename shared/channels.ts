/**
 * Reads what IPTV channel names encode by convention: a region prefix
 * ("LAT|", "UK:", "AR -"), quality ("FHD", "4K", "720p"), raw/backup feeds and
 * commentary language ("[ES]", "ENGLISH"). Pure — shared by browser, server and tests.
 */

export type Quality = 'uhd' | 'fhd' | 'hd' | 'sd' | 'unknown';
export const QUALITY_RANK: Record<Quality, number> = { uhd: 4, fhd: 3, hd: 2, unknown: 1.5, sd: 1 };
export const QUALITY_LABEL: Record<Quality, string> = { uhd: '4K', fhd: 'FHD', hd: 'HD', sd: 'SD', unknown: '' };

export interface ChannelTags {
  quality: Quality;
  /** ISO 639-1 commentary language when the name or region implies one. */
  lang?: string;
  /** Region code from the prefix, upper-case ("LAT", "UK", "AR"). */
  region?: string;
  /** "RAW", "BACKUP", "ALT"… — an alternative feed of the same channel. */
  variant?: string;
  /** Name without prefix, quality, variant and language markers (normalised). Used to match guides. */
  base: string;
  /**
   * Event / PPV channels that announce their state in the name:
   * "LIVE | Charlotte vs. Orlando | …" → live, "End | …" / "ENDED | …" → ended,
   * "- NO EVENT STREAMING - | …" → idle (an empty placeholder slot).
   */
  event?: 'live' | 'ended' | 'idle';
}

const EVENT_LIVE_RE = /^\W*(live|en vivo|en directo|on now)\s*[|:]/;
const EVENT_ENDED_RE = /^\W*(end|ended|finished|final|finalizado)\s*[|:]/;
const EVENT_IDLE_RE = /\b(no event( streaming)?|no events?|sin evento|off ?air|no live event)\b/;
/** Marketing labels that look like a quality but say nothing about the stream ("8K EXCLUSIVE"). */
const MARKETING_RE = /\b(8k|4k|uhd)\s+exclusive\b/g;

const REGION_LANG: Record<string, string> = {
  LAT: 'es', LATAM: 'es', LATINO: 'es', AR: 'es', ARG: 'es', ES: 'es', ESP: 'es', SPA: 'es', MX: 'es', MEX: 'es', MXC: 'es', CO: 'es', COL: 'es', CL: 'es', CHI: 'es',
  PE: 'es', PER: 'es', UY: 'es', URU: 'es', PY: 'es', EC: 'es', VE: 'es', BO: 'es', CR: 'es', DO: 'es', PR: 'es',
  UK: 'en', GB: 'en', US: 'en', USA: 'en', CA: 'en', AU: 'en', IE: 'en', NZ: 'en', EN: 'en', ENG: 'en',
  BR: 'pt', PT: 'pt', POR: 'pt', IT: 'it', ITA: 'it', FR: 'fr', FRA: 'fr', DE: 'de', GER: 'de', NL: 'nl', TR: 'tr',
};

/** Explicit language words in a name win over the region. Keys are lower-case, accent-free. */
const LANG_WORDS: [RegExp, string][] = [
  // Spanish-language networks, wherever they're listed ("US| ESPN DEPORTES", "US| TELEMUNDO (KNSO) FRESNO").
  [/\b(deportes|telemundo|univision|unimas|galavision|tudn|vix|estrella tv|azteca|canal de las estrellas)\b/, 'es'],
  // Not "esp": "Levante vs. Atlético (ESP)" names the league's country, not the commentary.
  [/\b(espanol|castellano|spanish|latino|spa)\b/, 'es'],
  [/\b(english|eng)\b/, 'en'],
  [/\b(portugues|portuguese|brasil)\b/, 'pt'],
  [/\b(italiano|italian)\b/, 'it'],
  [/\b(francais|french)\b/, 'fr'],
  [/\b(deutsch|german)\b/, 'de'],
  // bracketed two-letter tags: "[ES]", "(EN)"
  [/[([]\s*es\s*[)\]]/, 'es'],
  [/[([]\s*en\s*[)\]]/, 'en'],
  [/[([]\s*pt\s*[)\]]/, 'pt'],
];

const QUALITY_WORDS: [RegExp, Quality][] = [
  [/\b(4k|uhd|2160p?|8k)\b/, 'uhd'],
  [/\b(fhd|full\s*hd|1080[pi]?|hd\+|hevc)\b/, 'fhd'],
  [/\b(hd|720p?)\b/, 'hd'],
  [/\b(sd|480p?|576p?|lq)\b/, 'sd'],
];

const VARIANT_RE = /\b(raw|backup|bkp|alt|alternativ[oa]|multi\s*audio|vip|plus)\b/;

function fold(s: string): string {
  // Fold superscript letters some providers use ("ᴿᴬᵂ") and accents.
  const SUP: Record<string, string> = { ᴬ: 'a', ᴮ: 'b', ᴰ: 'd', ᴱ: 'e', ᴳ: 'g', ᴴ: 'h', ᴵ: 'i', ᴶ: 'j', ᴷ: 'k', ᴸ: 'l', ᴹ: 'm', ᴺ: 'n', ᴼ: 'o', ᴾ: 'p', ᴿ: 'r', ᵀ: 't', ᵁ: 'u', ᵂ: 'w' };
  return s
    .replace(/[ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁᵂ]+/g, (m) => ` ${[...m].map((c) => SUP[c] ?? '').join('')} `)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const PREFIX_RE = /^\s*[[(]?\s*([a-z]{2,6})\s*[\])]?\s*(?:[|:»>]|\s-\s|\s–\s)\s*/i;

/** Parses tags from a channel name, using the category name as a fallback for region/language. */
export function parseChannelTags(name: string, categoryName = ''): ChannelTags {
  const folded = fold(name);
  let event: ChannelTags['event'];
  if (EVENT_IDLE_RE.test(folded)) event = 'idle';
  else if (EVENT_ENDED_RE.test(folded)) event = 'ended';
  else if (EVENT_LIVE_RE.test(folded)) event = 'live';
  let rest = folded.replace(MARKETING_RE, ' ');
  let region: string | undefined;
  const pm = folded.match(PREFIX_RE);
  if (pm && REGION_LANG[pm[1].toUpperCase()] !== undefined) {
    region = pm[1].toUpperCase();
    rest = folded.slice(pm[0].length);
  }
  if (!region) {
    const cm = fold(categoryName).match(PREFIX_RE);
    if (cm && REGION_LANG[cm[1].toUpperCase()] !== undefined) region = cm[1].toUpperCase();
  }

  let quality: Quality = 'unknown';
  for (const [re, q] of QUALITY_WORDS) {
    if (re.test(rest)) {
      quality = q;
      break;
    }
  }
  let lang: string | undefined;
  for (const [re, l] of LANG_WORDS) {
    if (re.test(rest)) {
      lang = l;
      break;
    }
  }
  lang ??= region ? REGION_LANG[region] : undefined;
  const vm = rest.match(VARIANT_RE);

  const base = rest
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\b(4k|uhd|2160p?|8k|fhd|full\s*hd|1080[pi]?|hd\+|hevc|hd|720p?|sd|480p?|576p?|lq|h\.?26[45]|50\s*fps|60\s*fps)\b/g, ' ')
    .replace(VARIANT_RE, ' ')
    .replace(/\b(espanol|castellano|spanish|latino|english|portugues|portuguese)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  return { quality, lang, region, variant: vm ? vm[1].toUpperCase().replace(/\s+/g, ' ') : undefined, base, ...(event ? { event } : {}) };
}

/**
 * A short label for event / PPV channels whose names carry the whole fixture, e.g.
 *   "ENDED | EN ESPAÑOL-LEVANTE VS. ATLÉTICO … | 8K EXCLUSIVE | US: ESPN+ PPV 6" → "ESPN+ PPV 6"
 *   "US (Peacock 003) | Bournemouth v. Leeds United (2026-10-31 10:50:05)"   → "Peacock 003"
 *   "(Apple) (MLS) 002 |  Charlotte vs. Orlando (Spanish) (…)"                 → "Apple MLS 002"
 *   "Serie A: Bologna vs Monza @ Oct 31 9:50 AM :Paramount+  05"               → "Paramount+ 05"
 * Returns undefined for ordinary channel names.
 */
export function eventLabel(name: string): string | undefined {
  const clean = (s: string) => s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  // Provider slot at the end: "| US: ESPN+ PPV 6", "| US: MLS PPV 1".
  const tail = name.match(/\|\s*(?:[A-Z]{2,4}\s*[:|]\s*)?([^|]*?\b(?:PPV|EVENT|EVENTS)\b[^|]*?\d+)\s*$/i);
  if (tail && name.includes('|')) return clean(tail[1]);
  // Provider slot at the start: "US (ESPN+ 166) | …", "AU (STAN 10) | …", "(Apple) (MLS) 002 | …", "(FLSP 342) | …".
  const head = name.match(/^\s*(?:[A-Z]{2,4}\s*)?((?:\([^)]*\)\s*)+[\w+]*\s*\d*)\s*\|/);
  if (head && /\d/.test(head[1])) return clean(head[1]);
  // "… @ Oct 31 9:50 AM :Paramount+  05"
  const at = name.match(/@[^:]*\d{1,2}:\d{2}\s*[AP]M\s*:\s*(.+?)\s*$/i);
  if (at) return clean(at[1]);
  return undefined;
}

export interface FeedPrefs {
  /** Commentary languages in order of preference, e.g. ["es", "en"]. */
  languages: string[];
  /** Highest quality worth preferring; "fhd" avoids 4K feeds on slow connections. */
  maxQuality: 'uhd' | 'fhd' | 'hd';
}

/**
 * Sort key for alternative feeds of the same content (lower = better):
 * preferred language first, then the best quality within the cap, then non-variant feeds.
 */
export function feedRank(tags: ChannelTags, prefs: FeedPrefs): [number, number, number] {
  const li = tags.lang ? prefs.languages.indexOf(tags.lang) : -1;
  const langScore = li >= 0 ? li : tags.lang ? prefs.languages.length + 1 : prefs.languages.length; // unknown beats a known non-preferred language
  const cap = QUALITY_RANK[prefs.maxQuality];
  const q = QUALITY_RANK[tags.quality];
  const qualityScore = q > cap ? cap - (q - cap) * 0.5 : q; // over the cap still beats SD, but loses to the cap itself
  return [langScore, -qualityScore, tags.variant ? 1 : 0];
}

export function compareRank(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
