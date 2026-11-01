import { describe, expect, it } from 'vitest';
import { autoGuideKey, buildGuideResolver, trimGuide } from '../../shared/guide';
import { eventListing, eventTitle, zonedTime } from '../../shared/events';
import type { EpgData } from '../../shared/xmltv';

const T = Date.UTC(2026, 9, 31, 12);
const guide: EpgData = {
  fetchedAt: T,
  channels: {
    'espn2.us': { id: 'espn2.us', name: 'ESPN 2' },
    'espn2.alt': { id: 'espn2.alt', name: 'ESPN 2 HD' },
    'cnn.us': { id: 'cnn.us', name: 'CNN' },
    'regional.9': { id: 'regional.9', name: 'Regional 9' },
  },
  programmes: {
    'espn2.us': [[T, T + 3600_000, 'SportsCenter'], [T + 3600_000, T + 7200_000, 'NFL Live']],
    'espn2.alt': [[T, T + 3600_000, 'SportsCenter']],
    'cnn.us': [[T, T + 3600_000, 'News']],
    'regional.9': [[T, T + 3600_000, 'Local']],
  },
};

describe('guide trimming', () => {
  it('keeps listings only for linked guide channels, plus manual links', () => {
    const t = trimGuide(guide, [['', 'LAT| ESPN 2 FHD'], ['cnn.us', 'US| CNN']], ['regional.9']);
    expect(Object.keys(t.programmes).sort()).toEqual(['cnn.us', 'espn2.us', 'regional.9']);
    expect(Object.keys(t.channels)).toHaveLength(4);
    expect(t.counts).toMatchObject({ 'espn2.us': 2, 'espn2.alt': 1 });
  });
  it('resolves the same way before and after trimming', () => {
    const t = trimGuide(guide, [['', 'LAT| ESPN 2 FHD']]);
    const before = autoGuideKey(buildGuideResolver(guide), undefined, 'LAT| ESPN 2 FHD');
    const after = autoGuideKey(buildGuideResolver(t), undefined, 'LAT| ESPN 2 FHD');
    expect(before).toBe('espn2.us'); // the one with more listings
    expect(after).toBe(before);
    expect(trimGuide(t, [['', 'LAT| ESPN 2 FHD']]).counts).toEqual(t.counts);
  });
});

describe('listings from event channel names (real provider names)', () => {
  const now = Date.UTC(2026, 9, 31, 20, 52);
  const at = (name: string) => {
    const e = eventListing(name, now);
    return e && { title: e.title, start: new Date(e.start).toISOString().slice(0, 16) };
  };
  it.each([
    ['US (ESPN+ 166) | Green Bay vs. Milwaukee Oct 31 2:00PM ET (2026-10-31 14:03:05)', 'Green Bay vs. Milwaukee', '2026-10-31T18:03'],
    ['LIVE | CHARLOTTE VS. ORLANDO | Sat 31 Oct 13:00 EDT (US) | 8K EXCLUSIVE | US: MLS PPV 1', 'Charlotte vs. Orlando', '2026-10-31T17:00'],
    ['English Football League: Lincoln City vs Birmingham City @ Oct 31 8:20 AM :Paramount+  01', 'English Football League: Lincoln City vs Birmingham City', '2026-10-31T12:20'],
    ['ENDED | EN ESPAÑOL-LEVANTE UD VS. ATLÉTICO DE MADRID (FECHA #11) | Sat 31 Oct 08:55 EDT (US) | 8K EXCLUSIVE | US: ESPN+ PPV 6', 'Levante UD vs. Atlético de Madrid (Fecha #11)', '2026-10-31T12:55'],
    ['US (ESPN+ 011) | Soccer: Levante vs. Atlético Madrid (Levante vs. Atlético de Madrid (ESP)) (2026-10-31 08:50:30)', 'Soccer: Levante vs. Atlético Madrid', '2026-10-31T12:50'],
    // Australian slots stamp Sydney time: 01:50 AEDT is 14:50 UTC the day before.
    ['AU (STAN 10) | Bournemouth v Leeds United  Premier League Matchweek 9 2026/2027 (2026-11-01 01:50:50)', 'Bournemouth v Leeds United · Premier League', '2026-10-31T14:50'],
    ['(Apple) (MLS) 002 |  Charlotte vs. Orlando (Spanish) (2026-10-31 12:55:05)', 'Charlotte vs. Orlando (Spanish)', '2026-10-31T16:55'],
    ['LAT| ARG FANATIZ PPV 3: Boca vs River 20:00', 'Boca vs River', '2026-10-31T23:00'],
    // From the second report: "A - B" events, CET stamps, STAN competition suffixes, FloSports prefixes.
    ['ENDED | GLADSAXE - RUNGSTED (U16.2) | Sat 31 Oct 17:55 CET (DK) | 8K EXCLUSIVE | DK: DIREKTE SPORT PPV 52', 'Gladsaxe - Rungsted (U16.2)', '2026-10-31T16:55'],
    ['AU (STAN 51) | AEK Athens v Real Madrid  UEFA Champions League Matchday 4 2026/2027 (2026-11-05 04:40:50)', 'AEK Athens v Real Madrid · UEFA Champions League', '2026-11-04T17:40'],
    ['(FLSP 220) | fc:  Marietta vs Baldwin Wallace _ Women`s (Marietta vs Baldwin Wallace) (2026-10-31 13:03:30)', 'Soccer: Marietta vs Baldwin Wallace · Women’s', '2026-10-31T17:03'],
    ['ENDED | UNC ASHEVILLE VS. HIGH POINT | Sat 31 Oct 19:30 EDT (US) | 8K EXCLUSIVE | US: ESPN+ PPV 247', 'UNC Asheville vs. High Point', '2026-10-31T23:30'],
    // From the third report: DAZN slots with separate date and time, FloSports "live:" placeholder prefix.
    ['Next | AS Maaya vs. Rahimo FC | Ligue 1 - Burkina Faso | 2026-10-31 | 15:30 (GMT) | 8K EXCLUSIVE | US: DAZN PPV 12', 'AS Maaya vs. Rahimo FC · Ligue 1 - Burkina Faso', '2026-10-31T15:30'],
    ['NEXT | MAINE VS. UMBC | Sat 31 Oct 12:00 EDT (US) | 8K EXCLUSIVE | US: ESPN+ PPV 32', 'Maine vs. UMBC', '2026-10-31T16:00'],
    ['(FLSP 364) | live:  NEWMAC Field Hockey Championship _ Game 1 (2026-10-31 04:57:05)', 'NEWMAC Field Hockey Championship · Game 1', '2026-10-31T08:57'],
    // A live slot without a time is on now.
    ['Live | Sporting Kansas City vs. FC Dallas | all | 8K EXCLUSIVE | US: SOCCER PPV 118', 'Sporting Kansas City vs. FC Dallas', '2026-10-31T20:30'],
  ])('%s', (name, title, start) => {
    expect(at(name)).toEqual({ title, start });
  });
  it.each([
    '- NO EVENT STREAMING - | 8K EXCLUSIVE | US: ESPN+ PPV 410',
    '(Victory+ 072) |  (2098-12-31 08:01:11)',
    'End | Lincoln City vs. Birmingham City | all | 31-10-2026 | 00:00 (GMT) | 8K EXCLUSIVE | US: SOCCER PPV 45',
    'LAT| TELEMUNDO ATLANTA HD',
    'MXC| CANAL 5 (CAMARGO)',
    'US| ESPN PLAY EVENTS 44 HD',
    'LAT| PPV 06',
    // A date seven months off is a placeholder, not a schedule.
    'NHL NY ISLANDERS - COLUMBUS | Mon 23 Mar 00:05 | 8K EXCLUSIVE | US: VIAPLAY PPV 12',
    'US| CW 11 TACOMA WA (KSTW)',
  ])('no listing for %s', (name) => {
    expect(eventListing(name, now)).toBeUndefined();
  });
  it('the event title without a time is still readable', () => {
    expect(eventTitle('End | Lincoln City vs. Birmingham City | all | 31-10-2026 | 00:00 (GMT) | US: SOCCER PPV 45')).toBe('Lincoln City vs. Birmingham City');
  });
  it('converts wall-clock times across DST', () => {
    expect(new Date(zonedTime(2026, 6, 1, 12, 0, 'America/New_York')).toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(new Date(zonedTime(2026, 11, 1, 12, 0, 'America/New_York')).toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });
});
