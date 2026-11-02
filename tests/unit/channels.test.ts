import { describe, expect, it } from 'vitest';
import { compareRank, eventLabel, feedRank, parseChannelTags, type FeedPrefs } from '../../shared/channels';

describe('channel name tags', () => {
  it.each([
    ['LAT| ESPN 2 FHD', { region: 'LAT', lang: 'es', quality: 'fhd', base: 'espn 2' }],
    ['UK: Sky Sports Main Event 4K', { region: 'UK', lang: 'en', quality: 'uhd', base: 'sky sports main event' }],
    ['AR - TNT Sports HD', { region: 'AR', lang: 'es', quality: 'hd', base: 'tnt sports' }],
    ['ESPN Premium ᴿᴬᵂ', { variant: 'RAW', quality: 'unknown', base: 'espn premium' }],
    ['beIN Sports [EN] 1080p', { lang: 'en', quality: 'fhd', base: 'bein sports' }],
    ['DAZN LaLiga ESPAÑOL HEVC', { lang: 'es', quality: 'fhd', base: 'dazn laliga' }],
    ['US| FOX Sports 1 SD', { region: 'US', lang: 'en', quality: 'sd', base: 'fox sports 1' }],
  ])('%s', (name, expected) => {
    expect(parseChannelTags(name)).toMatchObject(expected);
  });
  it('takes region and language from the category when the name has no prefix', () => {
    expect(parseChannelTags('ESPN 3', 'LAT| ARGENTINA')).toMatchObject({ region: 'LAT', lang: 'es', base: 'espn 3' });
  });
  it('does not treat words or channel numbers as a region', () => {
    expect(parseChannelTags('Sky Sports: Premier League').region).toBeUndefined();
    expect(parseChannelTags('Canal 13').region).toBeUndefined();
  });
});

describe('feed ranking', () => {
  const prefs: FeedPrefs = { languages: ['es', 'en'], maxQuality: 'uhd' };
  const rank = (name: string, p = prefs) => feedRank(parseChannelTags(name), p);
  const sort = (names: string[], p = prefs) => [...names].sort((a, b) => compareRank(rank(a, p), rank(b, p)));
  it('preferred language first, then the best quality, then the main feed over raw/backup', () => {
    expect(sort(['UK: TNT Sports 4K', 'LAT| ESPN SD', 'LAT| ESPN FHD', 'LAT| ESPN FHD RAW', 'LAT| ESPN HD'])).toEqual([
      'LAT| ESPN FHD', 'LAT| ESPN FHD RAW', 'LAT| ESPN HD', 'LAT| ESPN SD', 'UK: TNT Sports 4K',
    ]);
  });
  it('a quality cap prefers FHD over 4K', () => {
    expect(sort(['LAT| ESPN 4K', 'LAT| ESPN FHD', 'LAT| ESPN SD'], { ...prefs, maxQuality: 'fhd' })).toEqual(['LAT| ESPN FHD', 'LAT| ESPN 4K', 'LAT| ESPN SD']);
  });
  it('an unknown language ranks below the preferred ones but above other known languages', () => {
    expect(sort(['IT: Sky Calcio HD', 'Sports 1 HD', 'UK: Sky Sports HD'])).toEqual(['UK: Sky Sports HD', 'Sports 1 HD', 'IT: Sky Calcio HD']);
  });
});

describe('event / PPV channels (real provider names)', () => {
  it('"8K EXCLUSIVE" is marketing, not a quality', () => {
    expect(parseChannelTags('End | Lincoln City vs. Birmingham City | all | 31-10-2026 | 00:00 (GMT) | 8K EXCLUSIVE | US: SOCCER PPV 45').quality).toBe('unknown');
    expect(parseChannelTags('4K| ZIGGO SPORT UHD').quality).toBe('uhd');
  });
  it('reads the event state from the name', () => {
    expect(parseChannelTags('ENDED | EN ESPAÑOL-LEVANTE UD VS. ATLÉTICO DE MADRID | US: ESPN+ PPV 6').event).toBe('ended');
    expect(parseChannelTags('End | Stoke City vs. Preston North End | all | US: SOCCER PPV 44').event).toBe('ended');
    expect(parseChannelTags('LIVE | CHARLOTTE VS. ORLANDO | Sat 31 Oct 13:00 EDT (US) | US: MLS PPV 1').event).toBe('live');
    expect(parseChannelTags('- NO EVENT STREAMING - | 8K EXCLUSIVE | US: ESPN+ PPV 410').event).toBe('idle');
    expect(parseChannelTags('LAT| TELEMUNDO ATLANTA HD').event).toBeUndefined();
  });
  it('language markers inside event names', () => {
    expect(parseChannelTags('ENDED | EN ESPAÑOL-RAYO VALLECANO VS. CELTA DE VIGO | US: ESPN+ PPV 12', 'US| ESPN+ PPV VIP').lang).toBe('es');
    expect(parseChannelTags('(Apple) (MLS) 002 |  Charlotte vs. Orlando (Spanish) (2026-10-31 12:55:05)', 'US| SOCCER PPV').lang).toBe('es');
    // "(ESP)" is the league's country here; the feed is English.
    expect(parseChannelTags('US (ESPN+ 011) | Soccer: Levante vs. Atlético Madrid (Levante vs. Atlético de Madrid (ESP))', 'US| ESPN PLUS').lang).toBe('en');
    expect(parseChannelTags('MXC| LAS ESTRELLAS (AGUASCALIENTES)').lang).toBe('es');
    expect(parseChannelTags('US| ESPN DEPORTES ᴴᴰ ⁶⁰ᶠᵖˢ').lang).toBe('es');
    expect(parseChannelTags('US| TELEMUNDO (KNSO) FRESNO').lang).toBe('es');
    expect(parseChannelTags('US| ESPN ᴴᴰ ²⁵ᶠᵖˢ').lang).toBe('en');
  });
  it.each([
    ['ENDED | EN ESPAÑOL-LEVANTE UD VS. ATLÉTICO DE MADRID (FECHA #11) | Sat 31 Oct 08:55 EDT (US) | 8K EXCLUSIVE | US: ESPN+ PPV 6', 'ESPN+ PPV 6'],
    ['US (Peacock 003) | Bournemouth v. Leeds United (2026-10-31 10:50:05)', 'Peacock 003'],
    ['(Apple) (MLS) 002 |  Charlotte vs. Orlando (Spanish) (2026-10-31 12:55:05)', 'Apple MLS 002'],
    ['Serie A: Bologna vs Monza @ Oct 31 9:50 AM :Paramount+  05', 'Paramount+ 05'],
    ['AU (STAN 10) | Bournemouth v Leeds United  Premier League Matchweek 9 2026/2027 (2026-11-01 01:50:50)', 'STAN 10'],
    ['LIVE | CHARLOTTE VS. ORLANDO | Sat 31 Oct 13:00 EDT (US) | 8K EXCLUSIVE | US: MLS PPV 1', 'MLS PPV 1'],
  ])('short label for %s', (name, label) => {
    expect(eventLabel(name)).toBe(label);
  });
  it('ordinary channels have no event label', () => {
    for (const n of ['LAT| TELEMUNDO ATLANTA HD', 'ARG| TNT SPORTS', 'US| ESPN PLAY EVENTS 44 HD', 'MXC| CANAL 5 (CAMARGO)', 'UK: Sky Sports Main Event']) expect(eventLabel(n)).toBeUndefined();
  });
});

describe('bar-wrapped prefixes', () => {
  it('reads "|EN| …" like "EN| …", but never takes a leading word as a prefix', () => {
    expect(parseChannelTags('Dune Part Two', '|EN| NEW RELEASED').lang).toBe('en');
    expect(parseChannelTags('|LAT| Babel Nights').region).toBe('LAT');
    expect(parseChannelTags('US Open Tennis').region).toBeUndefined();
    expect(parseChannelTags('US Open Tennis').base).toBe('us open tennis');
  });
});
