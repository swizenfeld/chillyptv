/**
 * Extended M3U playlist parser (the "channel list" kind, not HLS manifests).
 * Supports #EXTM3U header attributes (url-tvg / x-tvg-url), #EXTINF attributes,
 * #EXTGRP, #EXTVLCOPT (user-agent / referrer) and #KODIPROP lines.
 */

export type M3uKind = 'live' | 'movie' | 'series';

export interface M3uEntry {
  name: string;
  url: string;
  duration: number;
  group: string;
  tvgId?: string;
  tvgName?: string;
  logo?: string;
  chno?: number;
  catchup?: string;
  catchupDays?: number;
  catchupSource?: string;
  userAgent?: string;
  referrer?: string;
  kind: M3uKind;
  attrs: Record<string, string>;
}

export interface M3uPlaylist {
  epgUrls: string[];
  entries: M3uEntry[];
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|wmv|flv|m4v|webm|mpg|mpeg)(\?|$)/i;
export const SERIES_RE = /^(.*?)[\s._-]*[\[(]?\bS(\d{1,2})\s*[._-]?\s*E(\d{1,3})\b/i;

export function parseExtinfAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)=("([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').trim();
  return attrs;
}

/** Splits `#EXTINF:-1 a="b" c="d",Display Name` into duration, attrs and name, respecting quotes. */
export function splitExtinf(line: string): { duration: number; attrs: Record<string, string>; name: string } {
  const body = line.slice(line.indexOf(':') + 1);
  let inQuote: string | null = null;
  let comma = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === ',') {
      comma = i;
      break;
    }
  }
  const head = comma >= 0 ? body.slice(0, comma) : body;
  const name = comma >= 0 ? body.slice(comma + 1).trim() : '';
  const duration = parseFloat(head) || -1;
  return { duration, attrs: parseExtinfAttrs(head), name };
}

export function classifyEntry(url: string, group: string, name: string, duration: number): M3uKind {
  const lower = url.toLowerCase();
  if (/\/series\//.test(lower)) return 'series';
  if (/\/movies?\//.test(lower)) return 'movie';
  if (/\/live\//.test(lower) || /\.m3u8(\?|$)/.test(lower) || /\.ts(\?|$)/.test(lower)) {
    return 'live';
  }
  if (VOD_EXT.test(lower) || duration > 0) {
    if (SERIES_RE.test(name) || /series|shows?\b/i.test(group)) return 'series';
    return 'movie';
  }
  return 'live';
}

export function parseM3u(text: string): M3uPlaylist {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const playlist: M3uPlaylist = { epgUrls: [], entries: [] };
  let pending: { duration: number; attrs: Record<string, string>; name: string } | null = null;
  let extGroup = '';
  let ua: string | undefined;
  let ref: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const attrs = parseExtinfAttrs(line);
      for (const key of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
        if (attrs[key]) playlist.epgUrls.push(...attrs[key].split(',').map((s) => s.trim()).filter(Boolean));
      }
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      pending = splitExtinf(line);
      continue;
    }
    if (line.startsWith('#EXTGRP:')) {
      extGroup = line.slice(8).trim();
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice(11);
      const [k, ...rest] = opt.split('=');
      const v = rest.join('=').trim();
      if (/http-user-agent/i.test(k)) ua = v;
      if (/http-referr?er/i.test(k)) ref = v;
      continue;
    }
    if (line.startsWith('#KODIPROP:')) {
      const m = line.match(/stream_headers=(.*)$/i);
      if (m) {
        for (const part of m[1].split('&')) {
          const [k, v] = part.split('=');
          if (/user-agent/i.test(k)) ua = decodeURIComponent(v ?? '');
          if (/referr?er/i.test(k)) ref = decodeURIComponent(v ?? '');
        }
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    // URL line. Some playlists append "|User-Agent=..." Kodi-style headers.
    let url = line;
    const pipe = url.indexOf('|');
    if (pipe > 0) {
      const headers = new URLSearchParams(url.slice(pipe + 1));
      url = url.slice(0, pipe);
      ua = headers.get('User-Agent') ?? headers.get('user-agent') ?? ua;
      ref = headers.get('Referer') ?? headers.get('referer') ?? ref;
    }
    const info = pending ?? { duration: -1, attrs: {}, name: url.split('/').pop() ?? url };
    const a = info.attrs;
    const group = a['group-title'] || extGroup || 'Uncategorized';
    const name = info.name || a['tvg-name'] || 'Unnamed';
    const chno = a['tvg-chno'] ?? a['channel-number'];
    playlist.entries.push({
      name,
      url,
      duration: info.duration,
      group,
      tvgId: a['tvg-id'] || undefined,
      tvgName: a['tvg-name'] || undefined,
      logo: a['tvg-logo'] || a['logo'] || undefined,
      chno: chno && Number.isFinite(+chno) ? +chno : undefined,
      catchup: a['catchup'] || a['catchup-type'] || (a['tvg-rec'] ? 'default' : undefined),
      catchupDays: a['catchup-days'] ? +a['catchup-days'] : a['tvg-rec'] ? +a['tvg-rec'] : undefined,
      catchupSource: a['catchup-source'] || undefined,
      userAgent: a['user-agent'] || ua,
      referrer: a['referrer'] || ref,
      kind: classifyEntry(url, group, name, info.duration),
      attrs: a,
    });
    pending = null;
    extGroup = '';
    ua = undefined;
    ref = undefined;
  }
  return playlist;
}
