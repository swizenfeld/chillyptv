/**
 * Sports-today matching: competitions we track, team-name normalisation, and
 * the scoring that links a fixture to the TV-guide programmes that carry it.
 * Pure functions — shared by the server, the browser and the unit tests.
 */

export type Region = 'Europe' | 'International' | 'South America' | 'North America';

/** Display order of groups; each group belongs to one region. */
export const GROUPS = [
  { id: 'England', region: 'Europe' },
  { id: 'Spain', region: 'Europe' },
  { id: 'Italy', region: 'Europe' },
  { id: 'Germany', region: 'Europe' },
  { id: 'France', region: 'Europe' },
  { id: 'Rest of Europe', region: 'Europe' },
  { id: 'European cups', region: 'Europe' },
  { id: 'FIFA', region: 'International' },
  { id: 'UEFA nations', region: 'International' },
  { id: 'CONMEBOL nations', region: 'International' },
  { id: 'Argentina', region: 'South America' },
  { id: 'CONMEBOL clubs', region: 'South America' },
  { id: 'Brazil', region: 'South America' },
  { id: 'USA & Mexico', region: 'North America' },
] as const satisfies readonly { id: string; region: Region }[];

export type LeagueGroup = (typeof GROUPS)[number]['id'];
export const REGIONS: Region[] = ['Europe', 'International', 'South America', 'North America'];

export interface League {
  /** ESPN soccer league slug, e.g. "eng.1". */
  id: string;
  name: string;
  group: LeagueGroup;
  /** How TV guides write the competition, in English and Spanish (normalised, lowercase). */
  keywords: string[];
  defaultOn: boolean;
}

export const LEAGUES: League[] = [
  // Europe — domestic
  { id: 'eng.1', name: 'Premier League', group: 'England', keywords: ['premier league', 'epl', 'barclays premier', 'liga premier', 'futbol ingles'], defaultOn: true },
  { id: 'eng.2', name: 'EFL Championship', group: 'England', keywords: ['efl championship', 'sky bet championship'], defaultOn: true },
  { id: 'eng.fa', name: 'FA Cup', group: 'England', keywords: ['fa cup', 'emirates fa cup', 'copa fa'], defaultOn: true },
  { id: 'eng.league_cup', name: 'Carabao Cup', group: 'England', keywords: ['carabao cup', 'efl cup', 'league cup', 'copa de la liga inglesa'], defaultOn: true },
  { id: 'eng.charity', name: 'Community Shield', group: 'England', keywords: ['community shield'], defaultOn: true },
  { id: 'esp.1', name: 'LaLiga', group: 'Spain', keywords: ['laliga', 'la liga', 'liga ea sports', 'liga espanola', 'primera division espana', 'futbol espanol'], defaultOn: true },
  { id: 'esp.2', name: 'LaLiga 2', group: 'Spain', keywords: ['laliga 2', 'laliga hypermotion', 'segunda division'], defaultOn: false },
  { id: 'esp.copa_del_rey', name: 'Copa del Rey', group: 'Spain', keywords: ['copa del rey'], defaultOn: true },
  { id: 'esp.super_cup', name: 'Supercopa de España', group: 'Spain', keywords: ['supercopa de espana', 'spanish super cup'], defaultOn: true },
  { id: 'ita.1', name: 'Serie A', group: 'Italy', keywords: ['serie a', 'serie a enilive', 'calcio', 'liga italiana', 'futbol italiano'], defaultOn: true },
  { id: 'ita.2', name: 'Serie B', group: 'Italy', keywords: ['serie b'], defaultOn: false },
  { id: 'ita.coppa_italia', name: 'Coppa Italia', group: 'Italy', keywords: ['coppa italia', 'copa italia'], defaultOn: true },
  { id: 'ita.super_cup', name: 'Supercoppa Italiana', group: 'Italy', keywords: ['supercoppa', 'supercopa de italia', 'supercopa italiana'], defaultOn: true },
  { id: 'ger.1', name: 'Bundesliga', group: 'Germany', keywords: ['bundesliga', 'futbol aleman'], defaultOn: false },
  { id: 'ger.dfb_pokal', name: 'DFB-Pokal', group: 'Germany', keywords: ['dfb pokal', 'copa de alemania'], defaultOn: false },
  { id: 'fra.1', name: 'Ligue 1', group: 'France', keywords: ['ligue 1', 'liga francesa', 'futbol frances'], defaultOn: false },
  { id: 'fra.coupe_de_france', name: 'Coupe de France', group: 'France', keywords: ['coupe de france', 'copa de francia'], defaultOn: false },
  { id: 'por.1', name: 'Liga Portugal', group: 'Rest of Europe', keywords: ['liga portugal', 'primeira liga', 'liga portuguesa'], defaultOn: false },
  { id: 'ned.1', name: 'Eredivisie', group: 'Rest of Europe', keywords: ['eredivisie'], defaultOn: false },
  { id: 'sco.1', name: 'Scottish Premiership', group: 'Rest of Europe', keywords: ['scottish premiership'], defaultOn: false },
  // Europe — club competitions
  { id: 'uefa.champions', name: 'UEFA Champions League', group: 'European cups', keywords: ['champions league', 'uefa champions', 'ucl', 'liga de campeones', 'ligue des champions'], defaultOn: true },
  { id: 'uefa.europa', name: 'UEFA Europa League', group: 'European cups', keywords: ['europa league', 'uefa europa', 'liga europa', 'uel'], defaultOn: true },
  { id: 'uefa.europa.conf', name: 'UEFA Conference League', group: 'European cups', keywords: ['conference league', 'uecl', 'liga conferencia'], defaultOn: true },
  { id: 'uefa.super_cup', name: 'UEFA Super Cup', group: 'European cups', keywords: ['uefa super cup', 'supercopa de europa', 'supercopa uefa'], defaultOn: true },
  // International — national teams
  { id: 'fifa.world', name: 'FIFA World Cup', group: 'FIFA', keywords: ['world cup', 'copa mundial', 'copa del mundo', 'mundial'], defaultOn: true },
  { id: 'fifa.cwc', name: 'FIFA Club World Cup', group: 'FIFA', keywords: ['club world cup', 'mundial de clubes'], defaultOn: true },
  { id: 'fifa.friendly', name: 'International friendlies', group: 'FIFA', keywords: ['international friendly', 'amistoso internacional', 'partido amistoso'], defaultOn: true },
  { id: 'uefa.euro', name: 'UEFA Euro', group: 'UEFA nations', keywords: ['uefa euro', 'eurocopa', 'european championship', 'euro 2028'], defaultOn: true },
  { id: 'uefa.euroq', name: 'Euro qualifiers', group: 'UEFA nations', keywords: ['euro qualifiers', 'euro qualifying', 'clasificacion eurocopa', 'eliminatorias eurocopa'], defaultOn: true },
  { id: 'uefa.nations', name: 'UEFA Nations League', group: 'UEFA nations', keywords: ['nations league', 'liga de naciones'], defaultOn: true },
  { id: 'fifa.worldq.uefa', name: 'World Cup qualifiers (Europe)', group: 'UEFA nations', keywords: ['world cup qualifiers', 'world cup qualifying', 'eliminatorias europeas', 'clasificacion mundial europa'], defaultOn: true },
  { id: 'conmebol.america', name: 'Copa América', group: 'CONMEBOL nations', keywords: ['copa america'], defaultOn: true },
  { id: 'fifa.worldq.conmebol', name: 'World Cup qualifiers (South America)', group: 'CONMEBOL nations', keywords: ['eliminatorias sudamericanas', 'eliminatorias conmebol', 'eliminatorias'], defaultOn: true },
  // South America
  { id: 'arg.1', name: 'Liga Profesional', group: 'Argentina', keywords: ['liga profesional', 'lpf', 'torneo betano', 'futbol argentino', 'primera division argentina', 'liga argentina', 'torneo apertura', 'torneo clausura'], defaultOn: true },
  { id: 'arg.2', name: 'Primera Nacional', group: 'Argentina', keywords: ['primera nacional', 'primera b nacional'], defaultOn: true },
  { id: 'arg.copa', name: 'Copa Argentina', group: 'Argentina', keywords: ['copa argentina'], defaultOn: true },
  { id: 'arg.copa_lpf', name: 'Copa de la Liga', group: 'Argentina', keywords: ['copa de la liga', 'copa lpf'], defaultOn: true },
  { id: 'arg.supercopa', name: 'Supercopa Argentina', group: 'Argentina', keywords: ['supercopa argentina'], defaultOn: true },
  { id: 'conmebol.libertadores', name: 'Copa Libertadores', group: 'CONMEBOL clubs', keywords: ['libertadores'], defaultOn: true },
  { id: 'conmebol.sudamericana', name: 'Copa Sudamericana', group: 'CONMEBOL clubs', keywords: ['sudamericana'], defaultOn: true },
  { id: 'conmebol.recopa', name: 'Recopa Sudamericana', group: 'CONMEBOL clubs', keywords: ['recopa sudamericana', 'recopa'], defaultOn: true },
  { id: 'bra.1', name: 'Brasileirão', group: 'Brazil', keywords: ['brasileirao', 'campeonato brasileiro', 'futbol brasileno'], defaultOn: false },
  // North America
  { id: 'usa.1', name: 'MLS', group: 'USA & Mexico', keywords: ['mls', 'major league soccer'], defaultOn: true },
  { id: 'concacaf.champions', name: 'CONCACAF Champions Cup', group: 'USA & Mexico', keywords: ['concacaf champions', 'champions cup'], defaultOn: true },
  { id: 'concacaf.leagues.cup', name: 'Leagues Cup', group: 'USA & Mexico', keywords: ['leagues cup'], defaultOn: false },
  { id: 'mex.1', name: 'Liga MX', group: 'USA & Mexico', keywords: ['liga mx', 'futbol mexicano'], defaultOn: false },
];

export const LEAGUE_BY_ID = new Map(LEAGUES.map((l) => [l.id, l]));
export const DEFAULT_LEAGUES = LEAGUES.filter((l) => l.defaultOn).map((l) => l.id);

export interface Team {
  name: string;
  short?: string;
  abbr?: string;
  logo?: string;
  score?: string;
}

export interface Fixture {
  id: string;
  leagueId: string;
  leagueName: string;
  /** Kick-off, epoch ms. */
  start: number;
  state: 'pre' | 'in' | 'post';
  /** "67'", "HT", "FT", or a kick-off string from the source. */
  detail?: string;
  home: Team;
  away: Team;
  venue?: string;
  /** Broadcaster names from the fixtures source (e.g. "TNT Sports", "Peacock"). */
  broadcasts: string[];
  /** Where the fixture came from: the online feed or detected from the TV guide. */
  source: 'feed' | 'guide';
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Club suffixes/prefixes that guides drop freely. */
const NOISE = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'cd', 'ud', 'sd', 'rcd', 'ca', 'club', 'de', 'del', 'la', 'the', 'and', 'hotspur', 'cp', 'sad', 'calcio']);
/** Tokens too common to identify a club on their own. */
const AMBIGUOUS = new Set([
  'united', 'city', 'real', 'sporting', 'athletic', 'atletico', 'deportivo', 'racing', 'inter', 'madrid', 'manchester', 'san', 'santa', 'union',
  'independiente', 'central', 'juniors', 'plate', 'rovers', 'wanderers', 'town', 'county', 'albion', 'villa', 'palace', 'forest', 'ham', 'west',
  'galaxy', 'new', 'york', 'los', 'angeles', 'paris', 'saint', 'germain', 'munich', 'borussia', 'olympique', 'nacional', 'velez', 'estudiantes',
]);

/** Common nicknames TV guides use. Keys and values are normalised. */
const ALIASES: Record<string, string[]> = {
  'manchester united': ['man utd', 'man united', 'man u'],
  'manchester city': ['man city'],
  'tottenham': ['spurs', 'tottenham hotspur'],
  'wolverhampton wanderers': ['wolves'],
  'brighton and hove albion': ['brighton'],
  'nottingham forest': ['nottm forest', 'nott m forest', 'forest'],
  'newcastle united': ['newcastle'],
  'west ham united': ['west ham'],
  'leeds united': ['leeds'],
  'crystal palace': ['palace'],
  'aston villa': ['villa'],
  'atletico madrid': ['atletico', 'atleti', 'atl madrid', 'atletico de madrid'],
  'athletic club': ['athletic bilbao', 'athletic'],
  'deportivo alaves': ['alaves'],
  'celta vigo': ['celta', 'rc celta'],
  'barcelona': ['barca', 'fc barcelona'],
  'real betis': ['betis'],
  'rayo vallecano': ['rayo'],
  'paris saint germain': ['psg', 'paris sg'],
  'bayern munich': ['bayern', 'bayern munchen'],
  'internazionale': ['inter milan', 'inter'],
  'inter miami': ['miami'],
  'la galaxy': ['galaxy', 'los angeles galaxy'],
  'boca juniors': ['boca'],
  'river plate': ['river'],
  'velez sarsfield': ['velez'],
  'san lorenzo': ['san lorenzo de almagro'],
  'estudiantes de la plata': ['estudiantes', 'estudiantes lp'],
  'talleres': ['talleres cordoba', 'talleres de cordoba'],
  'deportivo riestra': ['riestra'],
};

const ALIAS_INDEX: { canon: string; names: string[] }[] = Object.entries(ALIASES).map(([canon, names]) => ({ canon, names: [canon, ...names] }));

function strip(s: string): string {
  return normalize(s)
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .join(' ');
}

/** All strings that identify a team in free text, most specific first. */
export function teamNames(t: Team): string[] {
  const out = new Set<string>();
  for (const raw of [t.name, t.short]) {
    if (!raw) continue;
    const n = normalize(raw);
    const s = strip(raw);
    if (n) out.add(n);
    if (s) out.add(s);
  }
  for (const entry of ALIAS_INDEX) {
    if ([...out].some((n) => entry.names.includes(n) || n.includes(entry.canon))) entry.names.forEach((a) => out.add(a));
  }
  // A single distinctive word (e.g. "chelsea", "sarsfield") is enough on its own.
  for (const n of [...out]) {
    for (const w of n.split(' ')) if (w.length >= 5 && !AMBIGUOUS.has(w) && !NOISE.has(w)) out.add(w);
  }
  return [...out].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
}

/** Word-boundary containment on normalised text. */
export function mentions(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function mentionsTeam(text: string, t: Team): boolean {
  return teamNames(t).some((n) => mentions(text, n));
}

export function mentionsLeague(text: string, leagueId: string): boolean {
  const l = LEAGUE_BY_ID.get(leagueId);
  return !!l && l.keywords.some((k) => mentions(text, k));
}

export interface GuideProgramme {
  start: number;
  end: number;
  title: string;
  desc?: string;
  subtitle?: string;
}

/**
 * How strongly a TV-guide programme looks like a broadcast of the fixture.
 * 1 = both teams named; 0.6 = one team plus the competition; 0 = no match.
 * The programme must overlap the match window (15 min before kick-off to ~2h after).
 */
export function programmeScore(p: GuideProgramme, f: Fixture): number {
  return scorePrepared(normalize(`${p.title} ${p.subtitle ?? ''} ${p.desc ?? ''}`), p.start, p.end, prepareFixture(f), normalize(p.title));
}

export interface PreparedFixture {
  fixture: Fixture;
  home: string[];
  away: string[];
  league: string[];
}

/** Pre-computes the names to look for, so scoring thousands of programmes stays cheap. */
export function prepareFixture(f: Fixture): PreparedFixture {
  return { fixture: f, home: teamNames(f.home), away: teamNames(f.away), league: LEAGUE_BY_ID.get(f.leagueId)?.keywords ?? [] };
}

const HEAD_TO_HEAD = / (v|vs|versus|x) /;

/** `text` and `title` must already be normalised. */
export function scorePrepared(text: string, start: number, end: number, pf: PreparedFixture, title = ''): number {
  const f = pf.fixture;
  if (end <= f.start - 15 * 60_000 || start >= f.start + 115 * 60_000) return 0;
  const home = pf.home.some((n) => mentions(text, n));
  const away = pf.away.some((n) => mentions(text, n));
  if (home && away) return 1;
  // "Atlético vs Sevilla" is a different match from Real Madrid v Sevilla, even though it names Sevilla.
  if (HEAD_TO_HEAD.test(` ${title} `)) return 0;
  if ((home || away) && pf.league.some((k) => mentions(text, k))) return 0.6;
  return 0;
}

/**
 * Event / PPV channels that carry the match in their name, e.g.
 * "LAT| ARG FANATIZ PPV 3: Boca Juniors vs River Plate 19:00". `nameNorm` must be normalised.
 */
export function channelNameScore(nameNorm: string, pf: PreparedFixture): number {
  return pf.home.some((n) => mentions(nameNorm, n)) && pf.away.some((n) => mentions(nameNorm, n)) ? 1 : 0;
}

/** Cheap test on raw text before normalising it: could it name a tracked competition? */
export function competitionHint(leagueIds: string[]): RegExp {
  const accent: Record<string, string> = { a: '[aáà]', e: '[eéè]', i: '[ií]', o: '[oóò]', u: '[uúü]', n: '[nñ]', c: '[cç]' };
  const words = leagueIds
    .flatMap((id) => LEAGUE_BY_ID.get(id)?.keywords ?? [])
    .map((k) => [...k].map((ch) => (ch === ' ' ? '[\\s._:-]*' : (accent[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).join(''));
  return new RegExp(words.length ? words.join('|') : '(?!)', 'i');
}

/** Channel names that look like one of the fixture's broadcasters ("TNT Sports 1 HD" ~ "TNT Sports"). */
export function broadcasterScore(channelName: string, f: Fixture): number {
  const ch = normalize(channelName.replace(/^[a-z]{2,3}\s*[:|]\s*/i, ''));
  for (const b of f.broadcasts) {
    const n = normalize(b);
    if (n.length >= 3 && mentions(ch, n)) return 0.35;
  }
  return 0;
}

// ------------------------------------------------------------------ guide-only detection
const VS = /\s+(?:vs?\.?|x|-|–|—)\s+/i;

/**
 * Detects soccer matches from programme titles alone, for when no fixtures feed is
 * reachable: "Premier League: Chelsea v Man Utd", "LALIGA - Barcelona vs Alavés".
 */
export function detectGuideFixture(p: GuideProgramme, leagueIds: string[]): Fixture | null {
  const text = normalize(`${p.title} ${p.subtitle ?? ''}`);
  // Most specific competition across the whole catalogue ("club world cup" beats "world cup",
  // "brasileirao serie a" beats "serie a"), then keep it only if the viewer follows it.
  let league: League | undefined;
  let bestLen = 0;
  for (const l of LEAGUES) for (const k of l.keywords) if (k.length > bestLen && mentions(text, k)) [league, bestLen] = [l, k.length];
  if (!league || !leagueIds.includes(league.id)) return null;
  // Drop the competition prefix ("Premier League:", "LALIGA EA SPORTS -", "Live:") then split on vs/v/-.
  let title = p.title.replace(/^\s*(live|en vivo|directo)\s*[:|-]\s*/i, '');
  const colon = title.search(/[:|]/);
  if (colon >= 0) title = title.slice(colon + 1);
  else {
    for (const k of league.keywords) {
      const re = new RegExp(`^\\s*${k.replace(/ /g, '[\\s._-]*')}(\\s*ea sports)?\\s*[-–—]?\\s*`, 'i');
      const t2 = title.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (re.test(t2)) {
        title = t2.replace(re, '');
        break;
      }
    }
  }
  const parts = title.split(VS).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2 || parts.some((s) => s.length < 3 || s.length > 40)) return null;
  const [home, away] = parts.map((s) => s.replace(/\s*\(.*?\)\s*$/, ''));
  return {
    id: `guide:${league.id}:${strip(home)}:${strip(away)}:${Math.round(p.start / 60_000)}`,
    leagueId: league.id,
    leagueName: league.name,
    // Guide slots usually open with ~10–15 min of build-up; kick-offs fall on 5-minute marks.
    start: Math.round((p.start + Math.min(15 * 60_000, (p.end - p.start) * 0.1)) / 300_000) * 300_000,
    state: 'pre',
    home: { name: home },
    away: { name: away },
    broadcasts: [],
    source: 'guide',
  };
}

/** Same fixture from two sources (or two channels) → one key. */
export function fixtureKey(f: Fixture): string {
  const t = (x: Team) => teamNames(x)[0] ?? normalize(x.name);
  return `${f.leagueId}|${[t(f.home), t(f.away)].sort().join('|')}|${new Date(f.start).toISOString().slice(0, 10)}`;
}

/** Live state for guide-detected fixtures, from the clock. */
export function stateAt(f: Fixture, now: number): Fixture['state'] {
  if (f.source === 'feed') return f.state;
  if (now < f.start) return 'pre';
  return now < f.start + 115 * 60_000 ? 'in' : 'post';
}

// ------------------------------------------------------------------ ESPN feed
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Normalises one ESPN scoreboard response into fixtures. */
export function parseEspnScoreboard(json: any, leagueId: string): Fixture[] {
  const leagueName = LEAGUE_BY_ID.get(leagueId)?.name ?? json?.leagues?.[0]?.name ?? leagueId;
  const events: any[] = Array.isArray(json?.events) ? json.events : [];
  return events.flatMap((ev) => {
    const comp = ev?.competitions?.[0];
    const competitors: any[] = comp?.competitors ?? [];
    const side = (h: string) => competitors.find((c) => c.homeAway === h);
    const home = side('home');
    const away = side('away');
    if (!home || !away) return [];
    const team = (c: any): Team => ({
      name: c.team?.displayName ?? c.team?.name ?? '?',
      short: c.team?.shortDisplayName,
      abbr: c.team?.abbreviation,
      logo: c.team?.logo,
      score: c.score,
    });
    const broadcasts = new Set<string>();
    for (const b of comp?.broadcasts ?? []) for (const n of b?.names ?? []) broadcasts.add(String(n));
    for (const g of comp?.geoBroadcasts ?? []) if (g?.media?.shortName) broadcasts.add(String(g.media.shortName));
    const type = ev?.status?.type ?? {};
    const state: Fixture['state'] = type.state === 'in' ? 'in' : type.state === 'post' ? 'post' : 'pre';
    const start = Date.parse(ev?.date);
    if (!Number.isFinite(start)) return [];
    return [
      {
        id: `espn:${ev.id}`,
        leagueId,
        leagueName,
        start,
        state,
        detail: state === 'in' ? (ev?.status?.displayClock ?? type.shortDetail) : state === 'post' ? (type.shortDetail ?? 'FT') : undefined,
        home: team(home),
        away: team(away),
        venue: comp?.venue?.fullName,
        broadcasts: [...broadcasts],
        source: 'feed' as const,
      },
    ];
  });
}
