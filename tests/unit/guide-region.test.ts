import { describe, expect, it } from 'vitest';
import { autoGuideKey, buildGuideResolver, canonicalRegion, guideChannelRegion, regionFromUrl, trimGuide } from '../../shared/guide';
import type { EpgData, EpgProgrammeTuple } from '../../shared/xmltv';

const listings = (n: number): EpgProgrammeTuple[] => Array.from({ length: n }, (_, i) => [i * 3_600_000, (i + 1) * 3_600_000, `Show ${i}`]);

function guide(chs: { id: string; name: string; n: number; region?: string }[]): EpgData {
  const channels: EpgData['channels'] = {};
  const programmes: EpgData['programmes'] = {};
  for (const c of chs) {
    channels[c.id] = { id: c.id, name: c.name, ...(c.region ? { region: c.region } : {}) };
    programmes[c.id] = listings(c.n);
  }
  return { channels, programmes, fetchedAt: 0 };
}

describe('guide links keep to the channel’s country', () => {
  // The provider's guide has the US ESPN 2 (more listings); an Argentina guide has Argentina's.
  const data = guide([
    { id: 'ESPN2.us', name: 'ESPN 2', n: 100 },
    { id: 'ESPN2.ar', name: 'ESPN 2', n: 40 },
    { id: 'TyCSports.ar', name: 'TyC Sports', n: 30 },
    { id: 'FoxSports', name: 'Fox Sports', n: 20 },
  ]);
  const r = buildGuideResolver(data);

  it('an Argentine channel gets the Argentina guide, a US one the US guide', () => {
    expect(autoGuideKey(r, undefined, 'AR| ESPN 2 FHD')).toBe('ESPN2.ar');
    expect(autoGuideKey(r, undefined, 'ARG: ESPN 2 HD')).toBe('ESPN2.ar');
    expect(autoGuideKey(r, undefined, 'US| ESPN 2')).toBe('ESPN2.us');
    expect(autoGuideKey(r, undefined, 'AR| TyC Sports')).toBe('TyCSports.ar');
  });

  it('Latin American feeds use the Argentina guide too', () => {
    expect(autoGuideKey(r, undefined, 'LAT| ESPN 2 FHD')).toBe('ESPN2.ar');
  });

  it('a channel without a country keeps the fullest guide, as before', () => {
    expect(autoGuideKey(r, undefined, 'ESPN 2 HD')).toBe('ESPN2.us');
  });

  it('a guide of unknown country still fits', () => {
    expect(autoGuideKey(r, undefined, 'AR| Fox Sports')).toBe('FoxSports');
  });

  it('another country’s guide never does', () => {
    const usOnly = buildGuideResolver(guide([{ id: 'ESPN2.us', name: 'ESPN 2', n: 100 }]));
    expect(autoGuideKey(usOnly, undefined, 'AR| ESPN 2')).toBeUndefined();
    expect(autoGuideKey(usOnly, undefined, 'MX| ESPN 2')).toBeUndefined();
  });

  it('the provider’s own guide id wins regardless', () => {
    expect(autoGuideKey(r, 'ESPN2.us', 'AR| ESPN 2')).toBe('ESPN2.us');
  });

  it('the country can come from the category when the name has none', () => {
    expect(autoGuideKey(r, undefined, 'ESPN 2', undefined, 'AR')).toBe('ESPN2.ar');
  });
});

describe('guide channel country', () => {
  it('reads ids, names and the guide it came from', () => {
    expect(guideChannelRegion('ESPN2.us@East', 'ESPN 2')).toBe('US');
    expect(guideChannelRegion('espn2', 'AR: ESPN 2')).toBe('AR');
    expect(guideChannelRegion('espn2', 'ESPN 2 Argentina')).toBe('AR');
    expect(guideChannelRegion('espn2', 'ESPN 2 (AR)')).toBe('AR');
    expect(guideChannelRegion('espn2', 'ESPN 2 (HD)')).toBeUndefined();
    expect(guideChannelRegion('espn2', 'ESPN 2', 'AR')).toBe('AR');
  });

  it('"ESPN 2 Argentina" matches "AR| ESPN 2"', () => {
    const r = buildGuideResolver(guide([{ id: 'x1', name: 'ESPN 2 Argentina', n: 5 }, { id: 'x2', name: 'ESPN 2', n: 50, region: 'US' }]));
    expect(autoGuideKey(r, undefined, 'AR| ESPN 2 FHD')).toBe('x1');
  });

  it('reads the country of a guide address', () => {
    expect(regionFromUrl('https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz')).toBe('AR');
    expect(regionFromUrl('https://iptv-epg.org/files/epg-ar.xml')).toBe('AR');
    expect(regionFromUrl('https://example.com/guides/argentina.xml')).toBe('AR');
    expect(regionFromUrl('https://example.com/tv-uk.xml.gz')).toBe('UK');
    expect(regionFromUrl('http://provider:8080/xmltv.php?username=a&password=b')).toBeUndefined();
    expect(regionFromUrl('https://example.com/guide.xml.gz')).toBeUndefined();
    expect(regionFromUrl('https://epgshare01.online/epgshare01/epg_ripper_ALL_SOURCES1.xml.gz')).toBeUndefined();
  });

  it('a country guide is trimmed with its country in mind', () => {
    // An Argentina guide whose ids carry no country: the address says it.
    const ar = guide([{ id: 'ESPN 2', name: 'ESPN 2', n: 10 }, { id: 'TyC Sports', name: 'TyC Sports', n: 10 }]);
    const t = trimGuide(ar, [['', 'AR| ESPN 2 FHD', 'AR'], ['', 'US| CNN', 'US']], [], 'AR');
    expect(Object.keys(t.programmes)).toEqual(['ESPN 2']);
  });
});

describe('Spanish guide titles', () => {
  it('find the match', async () => {
    const { programmeScore } = await import('../../shared/sports');
    const f = { id: '1', leagueId: 'ita.1', leagueName: 'Serie A', start: 0, state: 'pre' as const, home: { name: 'Napoli' }, away: { name: 'Internazionale' }, broadcasts: [], source: 'feed' as const };
    expect(programmeScore({ start: 0, end: 7_200_000, title: 'Fútbol Italiano: Nápoles vs. Inter de Milán' }, f)).toBe(1);
  });
});

describe('suggested country guides', () => {
  it('offers the Argentina guide for Argentine and Latin channels without one, once', async () => {
    const { guideSuggestions } = await import('../../src/lib/guideSuggestions');
    const missing = new Map([['LAT', 300], ['AR', 40], ['US', 500]]);
    const s = guideSuggestions(missing, []);
    expect(s.map((x) => [x.suggestion.key, x.missing])).toEqual([['AR', 340]]);
    expect(guideSuggestions(missing, [s[0].suggestion.url])).toEqual([]);
    expect(guideSuggestions(new Map([['AR', 3]]), [])).toEqual([]);
  });
});

describe('channel country from the category', () => {
  it('reads codes and country names, not Spanish words', async () => {
    const { parseChannelTags } = await import('../../shared/channels');
    const region = (cat: string) => parseChannelTags('TyC Sports HD', cat).region;
    expect(region('ARGENTINA')).toBe('AR');
    expect(region('Deportes Argentina')).toBe('AR');
    expect(region('AR SPORTS')).toBe('AR');
    expect(region('AR| DEPORTES')).toBe('AR');
    expect(canonicalRegion(region('LATINO | DEPORTES'))).toBe('LAT');
    expect(region('EN VIVO')).toBeUndefined();
    expect(region('DE PELICULAS')).toBeUndefined();
    expect(region('SPORTS')).toBeUndefined();
    // The name's own prefix wins over the category.
    expect(parseChannelTags('US| ESPN', 'ARGENTINA').region).toBe('US');
  });
});
