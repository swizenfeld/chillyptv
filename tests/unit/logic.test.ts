import { describe, expect, it } from 'vitest';
import { buildM3uCatchupUrl } from '../../src/lib/catchup';
import { matchScore, searchList, normalize } from '../../src/lib/search';
import { formatInTimezone, normalizeServer, parseXtreamLink, parseXtreamListings } from '../../src/lib/xtream';
import { rewriteHlsPlaylist, looksLikeHls } from '../../server/proxy';
import { buildRemuxArgs } from '../../server/remux';
import { isPrivateAddress } from '../../server/guard';
import { planCandidates } from '../../src/player/engine';
import type { Channel, PlayRequest } from '../../src/lib/types';

const ch = (patch: Partial<Channel>): Channel => ({ id: '1', num: 1, name: 'X', categoryId: 'c', archive: true, archiveDays: 7, url: 'http://s/live/u/p/42.ts', ...patch });
const START = Date.UTC(2024, 4, 6, 20, 0);
const END = START + 3600_000;
const NOW = START + 7200_000;

describe('catch-up URLs', () => {
  it('xc → timeshift path', () => {
    expect(buildM3uCatchupUrl(ch({ catchup: 'xc' }), START, END, NOW)).toBe('http://s/timeshift/u/p/60/2024-05-06:20-00/42.ts');
  });
  it('default with source template', () => {
    expect(buildM3uCatchupUrl(ch({ catchup: 'default', catchupSource: 'http://arch/{Y}/{m}/{d}/{H}{M}.ts?dur={duration}' }), START, END, NOW)).toBe('http://arch/2024/05/06/2000.ts?dur=3600');
  });
  it('append adds the template to the live url', () => {
    expect(buildM3uCatchupUrl(ch({ catchup: 'append', catchupSource: '?utc={utc}&lutc={lutc}' }), START, END, NOW)).toBe(`http://s/live/u/p/42.ts?utc=${START / 1000}&lutc=${NOW / 1000}`);
  });
  it('shift adds utc params', () => {
    expect(buildM3uCatchupUrl(ch({ catchup: 'shift', url: 'http://s/a.m3u8?x=1' }), START, END, NOW)).toBe(`http://s/a.m3u8?x=1&utc=${START / 1000}&lutc=${NOW / 1000}`);
  });
  it('flussonic rewrites the playlist name', () => {
    expect(buildM3uCatchupUrl(ch({ catchup: 'flussonic', url: 'http://f/ch1/index.m3u8?token=a' }), START, END, NOW)).toBe(`http://f/ch1/index-${START / 1000}-3600.m3u8`);
  });
});

describe('search', () => {
  it('normalises accents and punctuation', () => {
    expect(normalize('Ça  va-Bien!')).toBe('ca va bien');
  });
  it('ranks exact > prefix > contains and requires all tokens', () => {
    const items = ['Sky Sports News', 'Sports', 'BT Sport 1', 'Eurosport'];
    expect(searchList(items, 'sports', (x) => x)[0]).toBe('Sports');
    expect(matchScore('sky news', 'Sky Sports News')).toBeGreaterThan(0);
    expect(matchScore('sky cinema', 'Sky Sports News')).toBe(0);
  });
  it('tolerates a typo in longer words', () => {
    expect(matchScore('champions', 'Champoins League')).toBeGreaterThan(0);
  });
});

describe('xtream helpers', () => {
  it('normalises server urls', () => {
    expect(normalizeServer('example.com:8080/')).toBe('http://example.com:8080');
    expect(normalizeServer('http://x.tv/player_api.php?username=a')).toBe('http://x.tv');
  });
  it('parses get.php links', () => {
    expect(parseXtreamLink('http://x.tv:8080/get.php?username=u&password=p&type=m3u_plus')).toEqual({ server: 'http://x.tv:8080', username: 'u', password: 'p' });
    expect(parseXtreamLink('http://x.tv/list.m3u')).toBeNull();
  });
  it('formats timeshift start in the provider timezone', () => {
    expect(formatInTimezone(Date.UTC(2024, 0, 1, 12, 5), 'UTC')).toBe('2024-01-01:12-05');
    expect(formatInTimezone(Date.UTC(2024, 6, 1, 12, 5), 'Europe/Berlin')).toBe('2024-07-01:14-05');
  });
  it('decodes base64 EPG listings', () => {
    const list = parseXtreamListings([{ title: btoa('Hello'), description: btoa('World'), start_timestamp: '100', stop_timestamp: '200', has_archive: 1 }]);
    expect(list[0]).toMatchObject({ title: 'Hello', desc: 'World', start: 100000, end: 200000, archive: true });
  });
});

describe('proxy', () => {
  it('detects HLS', () => {
    expect(looksLikeHls('application/vnd.apple.mpegurl', 'http://x/a')).toBe(true);
    expect(looksLikeHls('application/octet-stream', 'http://x/a/index.m3u8?t=1')).toBe(true);
    expect(looksLikeHls('video/mp2t', 'http://x/a.ts')).toBe(false);
  });
  it('rewrites segment, key and media URIs relative to the final URL', () => {
    const body = ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/en.m3u8"', '#EXTINF:2,', 'seg1.ts', '#EXTINF:2,', 'https://cdn/abs.ts', ''].join('\n');
    const out = rewriteHlsPlaylist(body, 'http://host/path/index.m3u8', (u) => `P(${u})`);
    expect(out).toContain('URI="P(http://host/path/key.bin)"');
    expect(out).toContain('URI="P(http://host/path/audio/en.m3u8)"');
    expect(out).toContain('P(http://host/path/seg1.ts)');
    expect(out).toContain('P(https://cdn/abs.ts)');
  });
  it('identifies private addresses', () => {
    expect(isPrivateAddress('192.168.1.5')).toBe(true);
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('::1')).toBe(true);
  });
  it('builds remux args with seek, audio transcode and optional video transcode', () => {
    const a = buildRemuxArgs({ url: 'http://x/a.mkv', ua: 'UA', start: 61.7, hasX264: true, transcodeVideo: true });
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 2)).toEqual(['-ss', '61']);
    expect(a).toContain('libx264');
    expect(a.slice(a.indexOf('-c:a'), a.indexOf('-c:a') + 2)).toEqual(['-c:a', 'aac']);
    expect(buildRemuxArgs({ url: 'u', ua: 'UA', hasX264: false, transcodeVideo: true })).not.toContain('libx264');
  });
});

describe('playback planning', () => {
  const opts = { preferRemux: false, ffmpeg: true, hlsSupported: true, mseSupported: true, nativeHls: false };
  const req = (p: Partial<PlayRequest>): PlayRequest => ({ kind: 'live', url: 'http://x/1.m3u8', title: 't', ...p });
  it('live HLS → hls.js, then TS fallback, then remux', () => {
    const c = planCandidates(req({ ext: 'm3u8', fallbackUrl: 'http://x/1.ts', fallbackExt: 'ts' }), opts);
    expect(c.map((x) => x.kind)).toEqual(['hls', 'mpegts', 'remux']);
  });
  it('MKV movie → native first, remux (and transcode) fallbacks', () => {
    const c = planCandidates(req({ kind: 'movie', url: 'http://x/m.mkv', ext: 'mkv' }), opts);
    expect(c.map((x) => `${x.kind}${x.transcode ? '+t' : ''}`)).toEqual(['native', 'remux', 'remux+t']);
  });
  it('prefers remux for MKV when configured', () => {
    expect(planCandidates(req({ kind: 'movie', url: 'http://x/m.mkv', ext: 'mkv' }), { ...opts, preferRemux: true })[0].kind).toBe('remux');
  });
  it('AVI goes to remux first; no ffmpeg means native only', () => {
    expect(planCandidates(req({ kind: 'movie', url: 'http://x/m.avi', ext: 'avi' }), opts)[0].kind).toBe('remux');
    expect(planCandidates(req({ kind: 'movie', url: 'http://x/m.avi', ext: 'avi' }), { ...opts, ffmpeg: false }).map((x) => x.kind)).toEqual(['native']);
  });
  it('Safari without MSE uses native HLS', () => {
    expect(planCandidates(req({ ext: 'm3u8' }), { ...opts, hlsSupported: false, mseSupported: false, nativeHls: true, ffmpeg: false }).map((x) => x.kind)).toEqual(['native']);
  });
});
