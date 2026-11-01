import { describe, expect, it } from 'vitest';
import { audioLabel, lang2, parseProbe, subtitleLabel } from '../../shared/media';
import { firstFrameTime } from '../../server/remux';
import { buildRemuxArgs } from '../../server/remux';

describe('file tracks (ffprobe)', () => {
  const probe = parseProbe({
    format: { duration: '5400.5', format_name: 'matroska,webm' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
      { codec_type: 'audio', codec_name: 'eac3', channels: 6, tags: { language: 'eng' }, disposition: { default: 1 } },
      { codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'spa', title: 'Español Latino' } },
      { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'spa' }, disposition: { forced: 1 } },
      { codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } },
      { codec_type: 'subtitle', codec_name: 'ass', tags: { LANGUAGE: 'und' } },
    ],
  });
  it('lists audio and subtitle tracks by their own index', () => {
    expect(probe.duration).toBe(5400.5);
    expect(probe.audio.map((a) => [a.index, a.lang, a.default])).toEqual([[0, 'eng', true], [1, 'spa', false]]);
    expect(probe.subtitles.map((x) => [x.index, x.lang, x.text, x.forced])).toEqual([[0, 'spa', true, true], [1, 'eng', false, false], [2, undefined, true, false]]);
  });
  it('labels tracks for the menu', () => {
    expect(audioLabel(probe.audio[0])).toBe('English · 5.1 EAC3');
    expect(audioLabel(probe.audio[1])).toBe('Spanish (Español Latino) · stereo AAC');
    expect(subtitleLabel(probe.subtitles[0])).toBe('Spanish (forced)');
    expect(subtitleLabel(probe.subtitles[2])).toBe('Subtitles 3');
  });
  it('matches preference codes and names', () => {
    expect(lang2('spa')).toBe('es');
    expect(lang2('Spanish')).toBe('es');
    expect(lang2('en')).toBe('en');
  });
});

describe('remux with chosen tracks', () => {
  it('maps the audio track and writes subtitles next to the stream, on the file timeline', () => {
    const a = buildRemuxArgs({ url: 'http://x/m.mkv', ua: 'ua', start: 600, audioIndex: 1, subtitleIndex: 0, hasX264: false });
    expect(a).toContain('-copyts');
    expect(a.join(' ')).toContain('-map 0:a:1?');
    expect(a.join(' ')).toContain('-map 0:s:0 -c:s webvtt -flush_packets 1 -f webvtt pipe:3');
    expect(a.join(' ')).toContain('-f framemd5 pipe:4');
    const plain = buildRemuxArgs({ url: 'http://x/m.mkv', ua: 'ua', hasX264: false });
    expect(plain).not.toContain('-copyts');
    expect(plain).not.toContain('pipe:3');
  });
  it('reads the first frame time from framemd5', () => {
    expect(firstFrameTime('#format: frame checksums\n#tb 0: 1/1000\n#media_type 0: video\n0,       5920,       6000,       40,    11699, 1de5\n')).toBe(6);
    expect(firstFrameTime('#tb 0: 1/90000\n')).toBeNull();
  });
});

describe('streamed WebVTT', () => {
  it('parses complete cues and keeps the unfinished tail for the next chunk', async () => {
    const { parseVttChunk } = await import('../../src/player/engine');
    const a = parseVttChunk('WEBVTT\n\n00:10.000 --> 00:14.000\nLine 3\n\n00:15.000 --> 00:1', false);
    expect(a.cues).toEqual([{ start: 10, end: 14, text: 'Line 3' }]);
    const b = parseVttChunk(`${a.rest}9.500\nLine 4\nsecond row\n\n`, false);
    expect(b.cues).toEqual([{ start: 15, end: 19.5, text: 'Line 4\nsecond row' }]);
    expect(parseVttChunk('01:02:03.250 --> 01:02:05.000\nLate', true).cues[0].start).toBe(3723.25);
  });
});
