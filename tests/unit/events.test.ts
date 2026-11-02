import { describe, expect, it } from 'vitest';
import { buildEvents, classifySport } from '../../src/lib/events';
import { eventListing } from '../../shared/events';
import type { Channel, Programme } from '../../src/lib/types';

const now = Date.UTC(2026, 10, 2, 17, 0);

describe('sport of an event', () => {
  it.each([
    ['Basketball: Hampton vs. Houston', 'Basketball', ''],
    ['Hockey: Halifax Mooseheads vs Sherbrooke Phoenix (Home)', 'Hockey', ''],
    ['Soccer: Fullerton College vs Santiago Canyon College · Men’s', 'Soccer', ''],
    ['Football: Northern Michigan vs Grand Valley State', 'American football', ''],
    ['NCAA Men’s Basketball: Dartmouth vs. Marist', 'Other', ''],
    ['Phi - 76ers vs Chi - Bulls', 'Other', 'US| NBA PASS PPV'],
    ['English Football League: Lincoln City vs Birmingham City', 'Other', ''],
    ['Wales v Japan · Nations Championship Round 4 2026', 'Other', ''],
    ['UFC Fight Night 292: Moicano vs. Nolan', 'Other', ''],
    ['Lakers vs. Warriors', 'Other', 'US| SOCCER PPV'],
    ['Belmont Abbey vs Barton College · Field Hockey', 'Other', ''],
  ])('%s', (title, prefixSport, category) => {
    const prefix = title.match(/^([\p{L} ]{3,30}):\s/u)?.[1];
    const expected: Record<string, string> = {
      'NCAA Men’s Basketball: Dartmouth vs. Marist': 'Basketball',
      'Phi - 76ers vs Chi - Bulls': 'Basketball',
      'English Football League: Lincoln City vs Birmingham City': 'Soccer',
      'Wales v Japan · Nations Championship Round 4 2026': 'Rugby',
      'UFC Fight Night 292: Moicano vs. Nolan': 'Fighting',
      'Lakers vs. Warriors': 'Other', // generic "SOCCER PPV" slots carry any sport
      'Belmont Abbey vs Barton College · Field Hockey': 'Field hockey',
    };
    expect(classifySport(title, prefix, category)).toBe(expected[title] ?? prefixSport);
  });
});

describe('events from event channels', () => {
  let n = 0;
  const ch = (name: string, categoryId = 'c'): Channel => ({ id: String(++n), num: n, name, categoryId, archive: false, archiveDays: 0 });
  const progs = new Map<string, Programme[]>();
  const add = (c: Channel) => {
    const e = eventListing(c.name, now);
    progs.set(c.id, e ? [{ start: e.start, end: e.end, title: e.title, category: e.category, fromName: true }] : []);
    return c;
  };
  const channels = [
    add(ch('(Apple) (MLS) 002 |  Charlotte vs. Orlando (Spanish) (2026-11-02 12:55:05)')),
    add(ch('(Apple) (MLS) 001 |  Charlotte vs. Orlando  (2026-11-02 12:55:00)')),
    add(ch('LIVE | CHARLOTTE VS. ORLANDO | Mon 02 Nov 13:00 EST (US) | 8K EXCLUSIVE | US: MLS PPV 1')),
    add(ch('US (ESPN+ 243) | Basketball: Hampton vs. Houston (2026-11-02 13:00:25)')),
    add(ch('US (Peacock 068) | Vikings vs. 49ers (2026-11-22 19:00:00)')),
    add(ch('US| CW 11 TACOMA WA (KSTW)')),
  ];
  const events = buildEvents(channels, (c) => progs.get(c.id) ?? [], () => 'US| SOCCER PPV', now);
  it('merges the feeds of one event and keeps the tidiest title', () => {
    const mls = events.find((e) => /Charlotte/.test(e.title))!;
    expect(mls.feeds).toHaveLength(3);
    expect(mls.title).toBe('Charlotte vs. Orlando');
    expect(mls.sport).toBe('Soccer'); // "(Apple) (MLS)" / "MLS PPV" in the slot names
  });
  it('sorts by start and skips events beyond a week and ordinary channels', () => {
    expect(events.map((e) => e.title)).toEqual(['Charlotte vs. Orlando', 'Basketball: Hampton vs. Houston']);
    expect(events[1].sport).toBe('Basketball');
  });
});
