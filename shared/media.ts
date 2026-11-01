/**
 * Audio and subtitle tracks inside a movie or episode file, as ffprobe reports them.
 * Shared by the server (/api/probe), the player and the diagnostic.
 */

export interface AudioTrack {
  /** Position among the file's audio streams (ffmpeg "0:a:N"). */
  index: number;
  codec: string;
  channels?: number;
  /** ISO 639 code as tagged in the file ("eng", "spa"), if any. */
  lang?: string;
  title?: string;
  default?: boolean;
}

export interface SubtitleTrack {
  /** Position among the file's subtitle streams (ffmpeg "0:s:N"). */
  index: number;
  codec: string;
  lang?: string;
  title?: string;
  forced?: boolean;
  default?: boolean;
  /** Text subtitles (SRT, ASS, MP4 text, WebVTT) can be shown in the browser; picture ones (PGS, VobSub) cannot. */
  text: boolean;
}

export interface MediaProbe {
  duration: number | null;
  container?: string;
  video?: { codec: string; width?: number; height?: number };
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
}

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'microdvd', 'subviewer', 'subviewer1', 'sami', 'realtext', 'jacosub', 'mpl2', 'pjs', 'vplayer', 'stl']);

/** ffprobe arguments (after the binary) for one input URL. */
export function ffprobeArgs(url: string, ua: string, protocols: string): string[] {
  return [
    '-v', 'error', '-protocol_whitelist', protocols, '-user_agent', ua,
    '-show_entries', 'format=duration,format_name:stream=index,codec_type,codec_name,width,height,channels:stream_tags=language,title:stream_disposition=default,forced',
    '-of', 'json', url,
  ];
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  tags?: { language?: string; title?: string; LANGUAGE?: string; TITLE?: string };
  disposition?: { default?: number; forced?: number };
}

const lang = (t: RawStream['tags']) => {
  const l = (t?.language ?? t?.LANGUAGE)?.toLowerCase();
  return l && l !== 'und' ? l : undefined;
};

/** Normalises ffprobe JSON into tracks. */
export function parseProbe(json: { format?: { duration?: string; format_name?: string }; streams?: RawStream[] }): MediaProbe {
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png');
  const audio: AudioTrack[] = streams
    .filter((s) => s.codec_type === 'audio')
    .map((s, index) => ({ index, codec: s.codec_name ?? '?', channels: s.channels, lang: lang(s.tags), title: s.tags?.title ?? s.tags?.TITLE, default: s.disposition?.default === 1 }));
  const subtitles: SubtitleTrack[] = streams
    .filter((s) => s.codec_type === 'subtitle')
    .map((s, index) => ({
      index,
      codec: s.codec_name ?? '?',
      lang: lang(s.tags),
      title: s.tags?.title ?? s.tags?.TITLE,
      forced: s.disposition?.forced === 1,
      default: s.disposition?.default === 1,
      text: TEXT_SUBS.has(s.codec_name ?? ''),
    }));
  return {
    duration: Number(json.format?.duration) || null,
    container: json.format?.format_name,
    ...(v ? { video: { codec: v.codec_name ?? '?', width: v.width, height: v.height } } : {}),
    audio,
    subtitles,
  };
}

const NAMES: Record<string, string> = {
  en: 'English', eng: 'English', es: 'Spanish', spa: 'Spanish', esp: 'Spanish', lat: 'Spanish (Latin America)', pt: 'Portuguese', por: 'Portuguese', pob: 'Portuguese (Brazil)',
  fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian', nl: 'Dutch', dut: 'Dutch', nld: 'Dutch',
  ru: 'Russian', rus: 'Russian', ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', ar: 'Arabic', ara: 'Arabic',
  hi: 'Hindi', hin: 'Hindi', tr: 'Turkish', tur: 'Turkish', pl: 'Polish', pol: 'Polish', sv: 'Swedish', swe: 'Swedish', da: 'Danish', dan: 'Danish', no: 'Norwegian', nor: 'Norwegian',
  fi: 'Finnish', fin: 'Finnish', el: 'Greek', gre: 'Greek', ell: 'Greek', he: 'Hebrew', heb: 'Hebrew', cs: 'Czech', cze: 'Czech', ces: 'Czech', hu: 'Hungarian', hun: 'Hungarian',
  ro: 'Romanian', rum: 'Romanian', ron: 'Romanian', uk: 'Ukrainian', ukr: 'Ukrainian', th: 'Thai', tha: 'Thai', vi: 'Vietnamese', vie: 'Vietnamese', id: 'Indonesian', ind: 'Indonesian',
};

export function languageName(code?: string): string | undefined {
  return code ? (NAMES[code.toLowerCase()] ?? code.toUpperCase()) : undefined;
}

/** Two-letter code for preference matching ("spa" → "es"). */
export function lang2(code?: string): string | undefined {
  if (!code) return undefined;
  const c = code.toLowerCase();
  const byName = Object.entries(NAMES).find(([k, v]) => k.length === 2 && v.toLowerCase() === c);
  if (byName) return byName[0];
  const map: Record<string, string> = { eng: 'en', spa: 'es', esp: 'es', lat: 'es', por: 'pt', pob: 'pt', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', dut: 'nl', nld: 'nl', rus: 'ru', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', ara: 'ar' };
  return map[c] ?? (c.length === 2 ? c : undefined);
}

const CH: Record<number, string> = { 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' };

/** "Spanish · 5.1 AC3" / "English (Commentary) · stereo AAC". */
export function audioLabel(t: AudioTrack): string {
  const name = languageName(t.lang) ?? `Track ${t.index + 1}`;
  const title = t.title && !new RegExp(`^${name}$`, 'i').test(t.title) ? ` (${t.title})` : '';
  const ch = t.channels ? CH[t.channels] ?? `${t.channels}ch` : '';
  return `${name}${title} · ${[ch, t.codec.toUpperCase()].filter(Boolean).join(' ')}`;
}

export function subtitleLabel(t: SubtitleTrack): string {
  const name = languageName(t.lang) ?? `Subtitles ${t.index + 1}`;
  const extra = [t.title && !new RegExp(`^${name}$`, 'i').test(t.title) ? t.title : '', t.forced ? 'forced' : ''].filter(Boolean).join(', ');
  return `${name}${extra ? ` (${extra})` : ''}`;
}

/** Arguments for `ffmpeg` to print a file's streams (it exits with an error after printing; that's expected). */
export function ffmpegInfoArgs(url: string, ua: string, protocols: string): string[] {
  return ['-hide_banner', '-nostdin', '-protocol_whitelist', protocols, '-user_agent', ua, '-i', url];
}

/**
 * Reads the stream list ffmpeg prints for `-i` (used when ffprobe isn't installed, as with some
 * ffmpeg-only builds), e.g. "Stream #0:2(spa): Audio: aac (LC), 48000 Hz, 5.1, fltp (default)".
 */
export function parseFfmpegInfo(stderr: string): MediaProbe | null {
  const input = stderr.match(/^Input #0, (.+?), from /m);
  if (!input) return null;
  const dur = stderr.match(/Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const streams: RawStream[] = [];
  let current: RawStream | null = null;
  for (const line of stderr.split('\n')) {
    const m = line.match(/^\s*Stream #0:\d+(?:\[0x[0-9a-f]+\])?(?:\(([a-z]{2,3})\))?: (Video|Audio|Subtitle|Data|Attachment): ([\w-]+)(.*)$/i);
    if (m) {
      const rest = m[4];
      const size = rest.match(/\b(\d{2,5})x(\d{2,5})\b/);
      const layout = rest.match(/\b(mono|stereo|2\.1|4\.0|5\.0|5\.1|6\.1|7\.1)\b/);
      const nch = rest.match(/\b(\d+) channels\b/);
      const CH: Record<string, number> = { mono: 1, stereo: 2, '2.1': 3, '4.0': 4, '5.0': 5, '5.1': 6, '6.1': 7, '7.1': 8 };
      current = {
        codec_type: m[2].toLowerCase(),
        codec_name: m[3],
        ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
        ...(layout ? { channels: CH[layout[1]] } : nch ? { channels: Number(nch[1]) } : {}),
        tags: m[1] ? { language: m[1] } : {},
        disposition: { default: /\(default\)/.test(rest) ? 1 : 0, forced: /\(forced\)/.test(rest) ? 1 : 0 },
      };
      streams.push(current);
      continue;
    }
    const title = line.match(/^\s{6,}title\s*:\s*(.+?)\s*$/i);
    if (title && current) current.tags = { ...current.tags, title: title[1] };
    else if (/^\S/.test(line) || /^\s{0,2}\S/.test(line)) current = null; // left the stream's metadata block
  }
  return parseProbe({
    format: { duration: dur ? String(Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])) : undefined, format_name: input[1] },
    streams,
  });
}
