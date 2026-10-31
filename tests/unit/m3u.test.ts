import { describe, expect, it } from 'vitest';
import { classifyEntry, parseM3u, splitExtinf } from '../../shared/m3u';
import { catalogFromM3u } from '../../src/lib/m3uSource';

const SAMPLE = `#EXTM3U url-tvg="http://epg.example/guide.xml.gz,http://epg2.example/x.xml"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://logo/bbc1.png" group-title="UK, News" tvg-chno="101" catchup="default" catchup-days="7" catchup-source="?utc={utc}&lutc={lutc}",BBC One HD
#EXTVLCOPT:http-user-agent=VLC/3.0
http://srv.example/live/u/p/1.m3u8
#EXTINF:-1 group-title="Movies",The Matrix (1999)
http://srv.example/movie/u/p/77.mkv
#EXTINF:-1 group-title="Shows",Lost S01 E02
http://srv.example/series/u/p/900.mp4
#EXTINF:-1 group-title="Shows",Lost S01 E01
http://srv.example/series/u/p/899.mp4
#EXTGRP:Radio
#EXTINF:-1,Jazz FM
http://radio.example/jazz|User-Agent=Foo&Referer=http://ref.example/
`;

describe('parseM3u', () => {
  const pl = parseM3u(SAMPLE);
  it('reads EPG urls from the header', () => {
    expect(pl.epgUrls).toEqual(['http://epg.example/guide.xml.gz', 'http://epg2.example/x.xml']);
  });
  it('parses attributes, quoted commas and names', () => {
    const e = pl.entries[0];
    expect(e.name).toBe('BBC One HD');
    expect(e.group).toBe('UK, News');
    expect(e.tvgId).toBe('bbc1.uk');
    expect(e.logo).toBe('http://logo/bbc1.png');
    expect(e.chno).toBe(101);
    expect(e.catchup).toBe('default');
    expect(e.catchupDays).toBe(7);
    expect(e.userAgent).toBe('VLC/3.0');
    expect(e.kind).toBe('live');
  });
  it('classifies movies and series by path', () => {
    expect(pl.entries[1].kind).toBe('movie');
    expect(pl.entries[2].kind).toBe('series');
  });
  it('supports #EXTGRP and Kodi-style pipe headers', () => {
    const e = pl.entries[4];
    expect(e.group).toBe('Radio');
    expect(e.url).toBe('http://radio.example/jazz');
    expect(e.userAgent).toBe('Foo');
    expect(e.referrer).toBe('http://ref.example/');
  });
  it('splits EXTINF with commas inside quotes', () => {
    expect(splitExtinf('#EXTINF:-1 group-title="A, B",Name, with comma').name).toBe('Name, with comma');
  });
  it('classifies by extension when there is no path hint', () => {
    expect(classifyEntry('http://x/file.mp4', 'Films', 'Film', -1)).toBe('movie');
    expect(classifyEntry('http://x/file.mkv', 'Shows', 'Show S02E05', -1)).toBe('series');
    expect(classifyEntry('http://x/stream', 'News', 'News', -1)).toBe('live');
  });
});

describe('catalogFromM3u', () => {
  const c = catalogFromM3u('p1', SAMPLE);
  it('groups episodes into a series sorted by season/episode', () => {
    expect(c.series).toHaveLength(1);
    expect(c.series[0].name).toBe('Lost');
    expect(c.series[0].episodes!.map((e) => e.episode)).toEqual([1, 2]);
  });
  it('builds categories per kind with stable ids', () => {
    expect(c.categories.live.map((x) => x.name)).toEqual(['UK, News', 'Radio']);
    expect(catalogFromM3u('p1', SAMPLE).categories.live[0].id).toBe(c.categories.live[0].id);
  });
  it('marks catch-up channels', () => {
    expect(c.channels[0].archive).toBe(true);
    expect(c.channels[0].archiveDays).toBe(7);
  });
  it('extracts years for movies', () => {
    expect(c.movies[0].year).toBe(1999);
    expect(c.movies[0].ext).toBe('mkv');
  });
});
