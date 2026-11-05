import { normalize } from './search';
import type { Channel, Programme } from './types';

/**
 * Events across all sports, built from event/PPV channels whose names carry the event
 * ("US (ESPN+ 243) | Basketball: Hampton vs. Houston (2026-11-02 13:00:25)"). Channels showing the
 * same event (an English and a Spanish feed, a PPV slot and an app slot) become one event with
 * several feeds.
 */
export interface EventFeed {
  channel: Channel;
  programme: Programme;
}

export interface SportEvent {
  key: string;
  title: string;
  sport: Sport;
  start: number;
  end: number;
  feeds: EventFeed[];
}

export const SPORTS = [
  'Soccer', 'American football', 'Basketball', 'Hockey', 'Baseball', 'Tennis', 'Volleyball', 'Rugby',
  'Fighting', 'Motorsport', 'Cricket', 'Golf', 'Field hockey', 'Swimming', 'Other',
] as const;
export type Sport = (typeof SPORTS)[number];

/** "Soccer: …", "hockey: …" prefixes event names use (FloSports' "fc" is soccer, US "Football" is American). */
const PREFIX: Record<string, Sport> = {
  soccer: 'Soccer', fc: 'Soccer', futbol: 'Soccer', football: 'American football', basketball: 'Basketball', hoops: 'Basketball',
  hockey: 'Hockey', 'ice hockey': 'Hockey', 'field hockey': 'Field hockey', baseball: 'Baseball', softball: 'Baseball', tennis: 'Tennis',
  volleyball: 'Volleyball', 'beach volleyball': 'Volleyball', rugby: 'Rugby', wrestling: 'Fighting', boxing: 'Fighting', mma: 'Fighting',
  swimming: 'Swimming', golf: 'Golf', cricket: 'Cricket',
};

/** Keyword rules, most specific first. */
const RULES: [Sport, RegExp][] = [
  ['Field hockey', /\bfield hockey\b/],
  ['Soccer', /\b(soccer|futbol|mls|nwsl|usl|efl|english football league|premier league|la ?liga|serie a|bundesliga|ligue 1|eredivisie|champions league|europa league|conference league|uefa|copa|libertadores|sudamericana|liga mx|liga profesional|primera|fifa)\b/],
  ['American football', /\b(nfl|ncaa football|college football|cfl|redzone|xfl|ufl)\b/],
  ['Basketball', /\b(nba|wnba|basketball|ncaab|euroleague|g league)\b/],
  ['Hockey', /\b(nhl|hockey|ahl|echl|khl|ohl|whl|qmjhl|ushl|bchl)\b/],
  ['Baseball', /\b(mlb|milb|baseball|softball)\b/],
  ['Tennis', /\b(tennis|atp|wta|davis cup|billie jean king)\b/],
  ['Volleyball', /\bvolleyball\b/],
  ['Rugby', /\b(rugby|super rugby|six nations|nations championship|premiership rugby|top 14)\b/],
  ['Fighting', /\b(ufc|boxing|mma|wrestling|bellator|pfl|wwe|aew|fight night|kickboxing)\b/],
  ['Motorsport', /\b(f1|formula 1|formula one|nascar|indycar|motogp|grand prix|supercross)\b/],
  ['Cricket', /\b(cricket|ipl|psl|t20|odi|test match|big bash)\b/],
  ['Golf', /\b(golf|pga|lpga|liv golf|ryder cup)\b/],
  ['Swimming', /\b(swimming|diving|water polo)\b/],
];

/** Channel categories and slot names that name one sport ("US| NBA PASS PPV", "(Apple) (MLS) 002"); generic "SOCCER PPV" slots carry anything, so they don't count. */
const CATEGORY_RULES: [Sport, RegExp][] = [
  ['Basketball', /\b(nba|wnba)\b/],
  ['American football', /\b(nfl)\b/],
  ['Hockey', /\b(nhl)\b/],
  ['Baseball', /\b(mlb|milb)\b/],
  ['Soccer', /\b(mls|fanatiz|liga mx)\b/],
  ['Fighting', /\b(ufc|wwe|boxing)\b/],
];

export function classifySport(title: string, prefix: string | undefined, categoryName: string): Sport {
  const p = prefix?.toLowerCase().trim();
  if (p && PREFIX[p]) return PREFIX[p];
  const t = normalize(title);
  for (const [sport, re] of RULES) if (re.test(t)) return sport;
  const c = normalize(categoryName);
  for (const [sport, re] of CATEGORY_RULES) if (re.test(c)) return sport;
  return 'Other';
}

/** The event without sport prefix, language note or repeats, for matching feeds of one event. */
function eventKey(title: string): string {
  return normalize(
    title
      .replace(/^[^:]{2,30}:\s*/, '') // "Soccer: ", "NCAA Men's Basketball: "
      .replace(/\((?:spanish|english|en español|in english|home|away)\)/gi, ' ')
      .replace(/\s·\s.*$/, ''), // " · Ligue 1 - Burkina Faso"
  )
    .replace(/\b(vs|v|x|at)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Today's and upcoming events from event channels' own listings (`fromName`), grouped by event.
 * `categoryName` resolves a channel's category for sport hints.
 */
export function buildEvents(channels: Channel[], programmesFor: (c: Channel) => Programme[], categoryName: (c: Channel) => string, now = Date.now(), days = 7): SportEvent[] {
  const byKey = new Map<string, SportEvent[]>();
  for (const ch of channels) {
    const p = programmesFor(ch)[0];
    if (!p?.fromName || p.end < now || p.start > now + days * 86_400_000) continue;
    const key = eventKey(p.title);
    if (key.length < 3) continue;
    const list = byKey.get(key) ?? byKey.set(key, []).get(key)!;
    // Feeds of one event start within a few hours of each other (pre-show slots open early).
    const ev = list.find((e) => Math.abs(e.start - p.start) <= 3 * 3_600_000);
    if (ev) {
      ev.feeds.push({ channel: ch, programme: p });
      ev.start = Math.min(ev.start, p.start);
      ev.end = Math.max(ev.end, p.end);
    } else {
      list.push({ key, title: p.title, sport: classifySport(p.title, p.category, `${categoryName(ch)} ${ch.name}`), start: p.start, end: p.end, feeds: [{ channel: ch, programme: p }] });
    }
  }
  const events = [...byKey.values()].flat();
  // The tidiest title wins (no "(Spanish)" note), and a sport found on any feed beats "Other".
  for (const e of events) {
    e.title = e.feeds.map((f) => f.programme.title).sort((a, b) => Number(/\((spanish|english)\)/i.test(a)) - Number(/\((spanish|english)\)/i.test(b)) || a.length - b.length)[0];
    if (e.sport === 'Other') e.sport = e.feeds.map((f) => classifySport(f.programme.title, f.programme.category, `${categoryName(f.channel)} ${f.channel.name}`)).find((s) => s !== 'Other') ?? 'Other';
  }
  return events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
