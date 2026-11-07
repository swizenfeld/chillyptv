import { describe, expect, it } from 'vitest';
import { indexChannels, matchFixtures, rankFeeds, type IndexedChannel, type IndexedProgramme } from '../../src/store/sports';
import { broadcasterScore, channelNameScore, prepareFixture, type Fixture } from '../../shared/sports';
import { parseChannelTags } from '../../shared/channels';
import { normalize } from '../../src/lib/search';
import type { Channel } from '../../src/lib/types';

// A playlist the size of a real provider's: 15,000 channels named the way providers name them.
const PREFIX = ['US|', 'UK:', 'LAT|', 'AR|', 'MX|', 'CA|', 'ES:', 'IT|', 'DE|', 'FR|'];
const NETS = ['ESPN', 'ESPN 2', 'Fox Sports', 'TNT Sports', 'Sky Sports', 'DAZN', 'beIN Sports', 'NBC', 'CBS', 'ABC', 'Discovery', 'HBO', 'Cinemax', 'TyC Sports', 'Movistar', 'Canal 5', 'CNN', 'Nick', 'Paramount', 'Telemundo'];
const channels: Channel[] = Array.from({ length: 15_000 }, (_, i) => {
  const ppv = i % 25 === 0;
  const name = ppv ? `US: SOCCER PPV ${i} | Team ${i % 97} vs. Club ${i % 89}` : `${PREFIX[i % PREFIX.length]} ${NETS[i % NETS.length]} ${i % 7 ? 'HD' : 'FHD'} ${Math.floor(i / 200)}`;
  return { id: String(i), num: i + 1, name, categoryId: String(i % 300), url: '' } as unknown as Channel;
});
const fixtures: Fixture[] = Array.from({ length: 60 }, (_, i) => ({
  id: `f${i}`, leagueId: 'eng.1', leagueName: 'Premier League', start: Date.now() + (i - 20) * 1_800_000, state: 'pre',
  home: { name: `Home Club ${i}` }, away: { name: `Away United ${i}` }, broadcasts: ['TNT Sports', 'Peacock', 'Fox Sports'], source: 'feed',
}));
const guideList: IndexedProgramme[] = [];
for (let c = 0; c < 2200; c++) for (let h = 0; h < 24; h++) guideList.push({ channel: channels[c], p: { start: Date.now() + (h - 12) * 3_600_000, end: Date.now() + (h - 11) * 3_600_000, title: `Programme ${h} on ${c}` } as never });
const list: IndexedChannel[] = channels.map((ch) => ({ ch, name: normalize(ch.name), base: parseChannelTags(ch.name).base }));

describe('sports matching at playlist scale', () => {
  it('matches 60 fixtures against 15,000 channels quickly, as before', { timeout: 30_000 }, () => {
    // The old way: every channel against every fixture, re-reading each name every time.
    let t = performance.now();
    let oldHits = 0;
    // (A fifth of the fixtures, scaled up: the old way is slow enough to time out the test.)
    for (const f of fixtures.slice(0, 12)) {
      const pf = prepareFixture(f);
      for (const c of list) if (channelNameScore(c.name, pf)) oldHits++;
      for (const c of list) if (broadcasterScore(c.ch.name, f)) oldHits++;
    }
    const oldMs = (performance.now() - t) * 5;

    t = performance.now();
    const idx = indexChannels(list);
    const res = matchFixtures(fixtures, idx, guideList).map((m) => ({ ...m, channels: rankFeeds(m.found, { languages: ['es', 'en'], maxQuality: 'fhd' }) }));
    const newMs = performance.now() - t;
    console.log(`old: ${oldMs.toFixed(0)} ms, new: ${newMs.toFixed(0)} ms (index included), ${res.reduce((n, m) => n + m.channels.length, 0)} feeds`);
    expect(newMs).toBeLessThan(oldMs / 10);
    expect(res).toHaveLength(60);
    // Broadcaster channels found ("TNT Sports", "Fox Sports"), at most 6 per match.
    expect(res[0].channels.length).toBeGreaterThan(0);
    expect(res[0].channels.length).toBeLessThanOrEqual(6);
  });
});
