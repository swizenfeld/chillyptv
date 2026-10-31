/**
 * Event / PPV channels carry the event in their name instead of the TV guide:
 *   "US (ESPN+ 166) | Green Bay vs. Milwaukee Oct 31 2:00PM ET (2026-10-31 14:03:05)"
 *   "LIVE | CHARLOTTE VS. ORLANDO | Sat 31 Oct 13:00 EDT (US) | 8K EXCLUSIVE | US: MLS PPV 1"
 *   "English Football League: Lincoln City vs Birmingham City @ Oct 31 8:20 AM :Paramount+  01"
 *   "LAT| ARG FANATIZ PPV 3: Boca vs River 20:00"
 * This reads the event title and start time so those channels get a guide listing.
 */

export interface EventListing {
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  /** Sport or competition when the name says it ("hockey", "Soccer", "Serie A"). */
  category?: string;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** UTC offsets (hours) for zone abbreviations event names use. */
const ABBR: Record<string, number> = {
  utc: 0, gmt: 0, bst: 1, wet: 0, west: 1, cet: 1, cest: 2, eet: 2, eest: 3,
  est: -5, edt: -4, et: -4.5, cst: -6, cdt: -5, ct: -5.5, mst: -7, mdt: -6, mt: -6.5, pst: -8, pdt: -7, pt: -7.5,
  art: -3, brt: -3, aest: 10, aedt: 11,
};
/** Zone used for bare times, by the name's region prefix. US-style providers stamp Eastern time. */
const REGION_ZONE: Record<string, string> = {
  US: 'America/New_York', CA: 'America/Toronto', UK: 'Europe/London', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  LAT: 'America/Argentina/Buenos_Aires', ARG: 'America/Argentina/Buenos_Aires', AR: 'America/Argentina/Buenos_Aires', MX: 'America/Mexico_City', MXC: 'America/Mexico_City',
  ES: 'Europe/Madrid', IT: 'Europe/Rome', FR: 'Europe/Paris', DE: 'Europe/Berlin', NL: 'Europe/Amsterdam', BR: 'America/Sao_Paulo', CO: 'America/Bogota',
};
const DEFAULT_ZONE = 'America/New_York';
const DURATION = 3 * 3_600_000;

/** UTC epoch for a wall-clock time in an IANA zone (no library: two-pass offset lookup). */
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  const offset = (t: number) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t);
      const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - t;
    } catch {
      return 0;
    }
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** The year that puts month/day closest to `now` (names rarely carry a year). */
function nearestYear(mo: number, d: number, now: number): number {
  const y = new Date(now).getUTCFullYear();
  let best = y;
  for (const c of [y - 1, y + 1]) if (Math.abs(Date.UTC(c, mo, d) - now) < Math.abs(Date.UTC(best, mo, d) - now)) best = c;
  return best;
}

const to24 = (h: number, ap?: string) => (ap ? (h % 12) + (/p/i.test(ap) ? 12 : 0) : h);

function regionZone(name: string): string {
  const m = name.match(/^\s*\(?([A-Z]{2,4})\)?\s*[|:(]/);
  return (m && REGION_ZONE[m[1]]) || DEFAULT_ZONE;
}

/** Start time from the name, or undefined when it has none (or only a placeholder). */
function parseStart(name: string, now: number): number | undefined {
  const zone = regionZone(name);
  // "(2026-10-31 14:03:05)"
  let m = name.match(/\((\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\)/);
  if (m) {
    const t = zonedTime(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], zone);
    return Math.abs(t - now) < 30 * 86_400_000 ? t : undefined; // "(2098-12-31 …)" placeholders
  }
  // "Sat 31 Oct 13:00 EDT", "31 Oct 08:55 EDT"
  m = name.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}):(\d{2})\s*([AP]M)?\s*([A-Z]{2,4})?\b/i);
  // "Oct 31 2:00PM ET", "@ Oct 31 8:20 AM"
  const m2 = m ? null : name.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+\d{4})?\s+(\d{1,2}):(\d{2})\s*([AP]M)?\s*([A-Z]{2,4})?\b/i);
  if (m || m2) {
    const [day, mon, hh, mm, ap, abbr] = m ? [+m[1], m[2], +m[3], +m[4], m[5], m[6]] : [+m2![2], m2![1], +m2![3], +m2![4], m2![5], m2![6]];
    const mo = MONTHS[mon.slice(0, 3).toLowerCase()];
    const y = nearestYear(mo, day, now);
    const h = to24(hh, ap);
    const off = abbr ? ABBR[abbr.toLowerCase()] : undefined;
    if (off !== undefined && !Number.isInteger(off)) return zonedTime(y, mo, day, h, mm, off < -6 ? 'America/Los_Angeles' : off < -5.6 ? 'America/Denver' : off < -5 ? 'America/Chicago' : 'America/New_York');
    if (off !== undefined) return Date.UTC(y, mo, day, h, mm) - off * 3_600_000;
    return zonedTime(y, mo, day, h, mm, zone);
  }
  // "PPV 3: Boca vs River 20:00" — a bare time after the match, today in the region's zone.
  m = name.match(/\bvs?\.?\s[^|]*?\s(\d{1,2}):(\d{2})\s*([AP]M)?\s*$/i);
  if (m) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return zonedTime(n('year'), n('month') - 1, n('day'), to24(+m[1], m[3]), +m[2], zone);
  }
  return undefined;
}

const VERSUS = /\s(?:vs?\.?|x|@)\s/i;

const UPPER = new Set(['fc', 'cf', 'ud', 'sc', 'ac', 'cd', 'afc', 'rcd', 'sd', 'usa', 'nyc', 'lafc', 'psg', 'ii', 'u15', 'u17', 'u19', 'u20', 'u21', 'u23', 'nfl', 'nba', 'nhl', 'mlb', 'mls', 'ufc', 'wwe']);
const LOWER = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'of', 'the', 'and', 'vs', 'v', 'at']);

/** "LEVANTE UD VS. ATLÉTICO DE MADRID" → "Levante UD vs. Atlético de Madrid"; mixed case is left alone. */
function titleCase(s: string): string {
  if (/[a-z]/.test(s)) return s;
  let first = true;
  return s.toLowerCase().replace(/[\p{L}\p{N}]+/gu, (w) => {
    const out = UPPER.has(w) ? w.toUpperCase() : LOWER.has(w) && !first ? w : w[0].toUpperCase() + w.slice(1);
    first = false;
    return out;
  });
}

/** The event's title from the name, cleaned of slot numbers, dates and labels. */
export function eventTitle(name: string): string | undefined {
  let text = name;
  // "Serie A: Bologna vs Monza @ Oct 31 9:50 AM :Paramount+ 05" → before the "@ date".
  const at = text.match(/^(.*?)\s@\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (at) text = at[1];
  const segments = text.split('|').map((s) => s.trim());
  let seg = segments.find((s) => VERSUS.test(` ${s} `)) ?? segments.find((s) => /:\s*\S/.test(s) && !/^\s*(?:[A-Z]{2,4}:\s*)?[\w+ ]*(PPV|EVENTS?)\s*\d+\s*$/i.test(s) && s.length > 12 && segments.length > 1);
  if (!seg) return undefined;
  seg = seg
    .replace(/\(\d{4}-\d{2}-\d{2}[^)]*\)/g, ' ') // "(2026-10-31 14:03:05)"
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s+\d{1,2}:\d{2}\s*([AP]M)?\s*([A-Z]{2,4})?\b.*$/i, ' ') // "Oct 31 2:00PM ET"
    .replace(/\s\d{1,2}:\d{2}\s*([AP]M)?\s*$/i, ' ') // trailing "20:00"
    .replace(/^[^:]*\b(PPV|EVENTS?)\s*\d+\s*:\s*/i, '') // "LAT| ARG FANATIZ PPV 3: "
    .replace(/^\s*(?:EN ESPA[NÑ]OL|IN ENGLISH)\s*[-–:]\s*/i, '') // "EN ESPAÑOL-LEVANTE…"
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "Soccer: Levante vs. Atlético Madrid (Levante vs. Atlético de Madrid (ESP))" → drop the repeat.
  seg = seg.replace(/\s*\((?:[^()]|\([^()]*\))*\bvs?\.?\s(?:[^()]|\([^()]*\))*\)\s*$/i, '').trim();
  if (seg.length < 5 || /no event/i.test(seg)) return undefined;
  return titleCase(seg);
}

/** A guide listing built from an event channel's name, or undefined for ordinary channels. */
export function eventListing(name: string, now = Date.now()): EventListing | undefined {
  if (!name.includes('|') && !/@\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|PPV\s*\d+\s*:/i.test(name)) return undefined;
  const title = eventTitle(name);
  if (!title) return undefined;
  const start = parseStart(name, now);
  if (start === undefined) return undefined;
  const cat = title.match(/^([\p{L} ]{3,30}):\s/u)?.[1];
  return { title, start, end: start + DURATION, ...(cat ? { category: cat } : {}) };
}
