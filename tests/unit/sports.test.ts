import { describe, expect, it } from 'vitest';
import { broadcasterScore, channelNameScore, competitionHint, detectGuideFixture, fixtureKey, normalize, parseEspnScoreboard, prepareFixture, programmeScore, teamNames, type Fixture } from '../../shared/sports';

const KO = Date.UTC(2026, 9, 31, 12, 30);
const fx = (home: string, away: string, leagueId = 'eng.1', patch: Partial<Fixture> = {}): Fixture => ({
  id: 'x', leagueId, leagueName: 'Premier League', start: KO, state: 'pre', home: { name: home }, away: { name: away }, broadcasts: [], source: 'feed', ...patch,
});
const prog = (title: string, offsetMin = -15, lenMin = 135, desc?: string) => ({ start: KO + offsetMin * 60_000, end: KO + (offsetMin + lenMin) * 60_000, title, desc });

describe('team names', () => {
  it('include nicknames guides use', () => {
    expect(teamNames({ name: 'Manchester United' })).toEqual(expect.arrayContaining(['manchester united', 'man utd']));
    expect(teamNames({ name: 'Tottenham Hotspur' })).toEqual(expect.arrayContaining(['spurs', 'tottenham']));
    expect(teamNames({ name: 'Vélez Sarsfield' })).toEqual(expect.arrayContaining(['velez sarsfield', 'velez', 'sarsfield']));
    expect(teamNames({ name: 'Paris Saint-Germain' })).toContain('psg');
  });
  it('never reduce a club to an ambiguous single word', () => {
    expect(teamNames({ name: 'Real Madrid' })).not.toContain('madrid');
    expect(teamNames({ name: 'Real Madrid' })).not.toContain('real');
    expect(teamNames({ name: 'Manchester City' })).not.toContain('manchester');
  });
});

describe('programme ↔ fixture scoring', () => {
  const f = fx('Chelsea', 'Manchester United');
  it('both teams named → certain, whatever the spelling', () => {
    expect(programmeScore(prog('Premier League: Chelsea v Man Utd'), f)).toBe(1);
    expect(programmeScore(prog('Live: Chelsea vs Manchester United'), f)).toBe(1);
  });
  it('one team plus the competition → likely', () => {
    expect(programmeScore(prog('Premier League Live', -15, 135, 'Chelsea host the visitors at Stamford Bridge.'), f)).toBe(0.6);
  });
  it('one team without the competition, or the wrong time → no match', () => {
    expect(programmeScore(prog('Chelsea: The Documentary'), f)).toBe(0);
    expect(programmeScore(prog('Premier League: Chelsea v Man Utd', 300, 120), f)).toBe(0);
  });
  it('does not confuse Real Madrid with Atlético Madrid', () => {
    expect(programmeScore(prog('LaLiga: Atlético Madrid vs Sevilla'), fx('Real Madrid', 'Sevilla', 'esp.1'))).toBe(0);
    expect(programmeScore(prog('LaLiga: Real Madrid vs Sevilla'), fx('Real Madrid', 'Sevilla', 'esp.1'))).toBe(1);
  });
});

describe('broadcaster channels', () => {
  it('matches channel names to listed broadcasters, ignoring country prefixes', () => {
    const f = fx('Vélez Sarsfield', 'San Lorenzo', 'arg.1', { broadcasts: ['TNT Sports'] });
    expect(broadcasterScore('AR: TNT Sports HD', f)).toBe(0.35);
    expect(broadcasterScore('TNT Comedy', f)).toBe(0);
  });
});

describe('event / PPV channel names', () => {
  const f = prepareFixture(fx('Boca Juniors', 'River Plate', 'arg.1'));
  it('finds the match in the channel name, with nicknames', () => {
    expect(channelNameScore(normalize('LAT| ARG FANATIZ PPV 3: Boca vs River 20:00'), f)).toBe(1);
    expect(channelNameScore(normalize('AR | ESPN PPV - Boca Juniors x River Plate'), f)).toBe(1);
  });
  it('needs both teams', () => {
    expect(channelNameScore(normalize('Boca TV'), f)).toBe(0);
    expect(channelNameScore(normalize('LAT| ARG FANATIZ PPV 3'), f)).toBe(0);
  });
});

describe('competition pre-filter', () => {
  const re = competitionHint(['arg.1', 'eng.1', 'esp.1']);
  it('tolerates accents, case and separators', () => {
    expect(re.test('Fútbol Argentino: Boca vs River')).toBe(true);
    expect(re.test('LIGA ESPAÑOLA: Betis - Málaga')).toBe(true);
    expect(re.test('Premier-League: Chelsea v Spurs')).toBe(true);
    expect(re.test('Torneo Clausura - Racing vs Independiente')).toBe(true);
  });
  it('skips unrelated titles', () => {
    expect(re.test('Noticias 24 horas')).toBe(false);
  });
});

describe('guide-only detection', () => {
  const leagues = ['eng.1', 'esp.1', 'arg.1', 'usa.1', 'uefa.champions'];
  it.each([
    ['Premier League: Chelsea v Man Utd', 'eng.1', 'Chelsea', 'Man Utd'],
    ['LALIGA EA SPORTS - FC Barcelona vs Alavés', 'esp.1', 'FC Barcelona', 'Alaves'],
    ['Liga Profesional: Vélez vs San Lorenzo', 'arg.1', 'Vélez', 'San Lorenzo'],
    ['UEFA Champions League: Bayern München - PSG', 'uefa.champions', 'Bayern München', 'PSG'],
    ['MLS: Inter Miami vs LA Galaxy', 'usa.1', 'Inter Miami', 'LA Galaxy'],
  ])('%s', (title, league, home, away) => {
    const f = detectGuideFixture(prog(title), leagues)!;
    expect(f).not.toBeNull();
    expect(f.leagueId).toBe(league);
    expect(f.home.name).toBe(home);
    expect(f.away.name).toBe(away);
  });
  it('ignores shows that are not matches or not tracked', () => {
    expect(detectGuideFixture(prog('Premier League Highlights'), leagues)).toBeNull();
    expect(detectGuideFixture(prog('Serie A: Inter v Milan'), leagues)).toBeNull();
  });
  it('the same match on two channels collapses to one key', () => {
    const a = detectGuideFixture(prog('Premier League: Chelsea v Man Utd'), leagues)!;
    const b = detectGuideFixture(prog('Premier League: Man Utd v Chelsea'), leagues)!;
    expect(fixtureKey(a)).toBe(fixtureKey(b));
  });
});

describe('ESPN scoreboard parsing', () => {
  it('normalises events, scores, state and broadcasters', () => {
    const json = {
      events: [
        {
          id: '1',
          date: '2026-10-31T12:30Z',
          status: { displayClock: "67'", type: { state: 'in', shortDetail: "67'" } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', score: '2', team: { displayName: 'Chelsea', abbreviation: 'CHE', logo: 'c.png' } },
                { homeAway: 'away', score: '1', team: { displayName: 'Manchester United', shortDisplayName: 'Man United' } },
              ],
              broadcasts: [{ names: ['TNT Sports', 'Peacock'] }],
              venue: { fullName: 'Stamford Bridge' },
            },
          ],
        },
        { id: '2', date: 'nonsense', competitions: [] },
      ],
    };
    const [f, ...rest] = parseEspnScoreboard(json, 'eng.1');
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({ id: 'espn:1', leagueName: 'Premier League', state: 'in', detail: "67'", venue: 'Stamford Bridge', broadcasts: ['TNT Sports', 'Peacock'], start: Date.UTC(2026, 9, 31, 12, 30) });
    expect(f.home).toMatchObject({ name: 'Chelsea', score: '2', logo: 'c.png' });
    expect(f.away).toMatchObject({ name: 'Manchester United', short: 'Man United', score: '1' });
  });
});

describe('expanded competitions', () => {
  const all = ['ita.1', 'ita.coppa_italia', 'uefa.europa', 'uefa.europa.conf', 'uefa.euro', 'uefa.nations', 'fifa.world', 'fifa.cwc', 'fifa.worldq.conmebol', 'fifa.worldq.uefa', 'conmebol.libertadores', 'conmebol.sudamericana', 'conmebol.america', 'arg.1', 'arg.2', 'arg.copa_lpf', 'eng.1'];
  it.each([
    ['Serie A: Inter vs Milan', 'ita.1'],
    ['Coppa Italia - Juventus vs Roma', 'ita.coppa_italia'],
    ['UEFA Europa League: Roma vs Porto', 'uefa.europa'],
    ['Conference League: Chelsea vs Betis', 'uefa.europa.conf'],
    ['Eurocopa: España vs Italia', 'uefa.euro'],
    ['Liga de Naciones: Francia vs España', 'uefa.nations'],
    ['Copa Mundial: Argentina vs Francia', 'fifa.world'],
    ['Mundial de Clubes: Real Madrid vs Boca Juniors', 'fifa.cwc'],
    ['Eliminatorias Sudamericanas: Argentina vs Brasil', 'fifa.worldq.conmebol'],
    ['World Cup Qualifiers: England vs Serbia', 'fifa.worldq.uefa'],
    ['Copa Libertadores: River vs Palmeiras', 'conmebol.libertadores'],
    ['Copa Sudamericana: Racing vs Cruzeiro', 'conmebol.sudamericana'],
    ['Copa América: Argentina vs Colombia', 'conmebol.america'],
    ['Primera Nacional: Chacarita vs Quilmes', 'arg.2'],
    ['Copa de la Liga: Boca vs River', 'arg.copa_lpf'],
  ])('%s → %s', (title, league) => {
    expect(detectGuideFixture(prog(title), all)?.leagueId).toBe(league);
  });
  it('the more specific competition wins, and is dropped if not followed', () => {
    // "club world cup" also contains "world cup"; Brazil's "Série A" also contains "serie a".
    expect(detectGuideFixture(prog('FIFA Club World Cup: Chelsea vs Flamengo'), ['fifa.world'])).toBeNull();
    expect(detectGuideFixture(prog('Brasileirão Série A: Flamengo vs Palmeiras'), ['ita.1'])).toBeNull();
    expect(detectGuideFixture(prog('Brasileirão Série A: Flamengo vs Palmeiras'), ['ita.1', 'bra.1'])?.leagueId).toBe('bra.1');
  });
  it('every competition has a group, keywords and a unique id', async () => {
    const { LEAGUES, GROUPS } = await import('../../shared/sports');
    const groups = new Set(GROUPS.map((g) => g.id));
    expect(new Set(LEAGUES.map((l) => l.id)).size).toBe(LEAGUES.length);
    for (const l of LEAGUES) {
      expect(groups.has(l.group)).toBe(true);
      expect(l.keywords.length).toBeGreaterThan(0);
      for (const k of l.keywords) expect(normalize(k)).toBe(k);
    }
  });
});

describe('broadcaster channels (strict)', () => {
  const f = (b: string[]) => fx('Barcelona', 'Alavés', 'esp.1', { broadcasts: b });
  it('streaming apps are not channels', () => {
    expect(broadcasterScore('LAT| ESPN 2 FHD', f(['ESPN+']))).toBe(0);
    expect(broadcasterScore('Paramount Network HD', f(['Paramount+']))).toBe(0);
  });
  it('the channel must start with the broadcaster name', () => {
    expect(broadcasterScore('UK: Sky Sports Main Event 4K', f(['Sky Sports']))).toBe(0.35);
    expect(broadcasterScore('AR: TNT Sports HD', f(['TNT Sports']))).toBe(0.35);
    expect(broadcasterScore('LAT| ESPN 2 FHD', f(['ESPN']))).toBe(0.35);
    expect(broadcasterScore('Fox News HD', f(['FOX Sports']))).toBe(0);
  });
});

describe('real provider names (diagnostic report)', () => {
  const at = (h: string, a: string, leagueId = 'ita.1') => prepareFixture(fx(h, a, leagueId));
  it('"Inter Milan" alone is not the Milan derby', () => {
    const f = at('AC Milan', 'Internazionale');
    expect(programmeScore(prog('Inter Milan vs Juventus'), f.fixture)).toBe(0);
    expect(channelNameScore(normalize('PPV 3: Inter Milan vs Lazio'), f)).toBe(0);
    expect(programmeScore(prog('Serie A: Milan vs Inter'), f.fixture)).toBe(1);
    expect(programmeScore(prog('Nogomet (M): Milan - Inter, Serie A 2026/2027'), f.fixture)).toBe(1);
    expect(programmeScore(prog('AC Milan v Inter Milan'), f.fixture)).toBe(1);
  });
  it('a bracketed city never identifies a club on its own', () => {
    expect(teamNames({ name: 'Talleres (Córdoba)' })).toContain('talleres');
    expect(teamNames({ name: 'Instituto (Córdoba)' })).not.toContain('cordoba');
    expect(teamNames({ name: 'Racing (Córdoba)' })).not.toContain('racing');
    expect(teamNames({ name: 'San Martín (San Juan)' })).not.toContain('san martin');
    expect(teamNames({ name: 'Gimnasia y Esgrima (Jujuy)' })).not.toContain('gimnasia y esgrima');
    const derby = at('Racing (Córdoba)', 'Instituto (Córdoba)', 'arg.2');
    expect(channelNameScore(normalize('Talleres de Córdoba vs Belgrano de Córdoba'), derby)).toBe(0);
  });
  it('event channels name both teams', () => {
    const f = at('Levante', 'Atlético Madrid', 'esp.1');
    expect(channelNameScore(normalize('ENDED | EN ESPAÑOL-LEVANTE UD VS. ATLÉTICO DE MADRID (FECHA #11) | Sat 31 Oct 08:55 EDT (US) | 8K EXCLUSIVE | US: ESPN+ PPV 6'), f)).toBe(1);
    expect(channelNameScore(normalize('US (ESPN+ 011) | Soccer: Levante vs. Atlético Madrid (Levante vs. Atlético de Madrid (ESP)) (2026-10-31 08:50:30)'), f)).toBe(1);
  });
});
