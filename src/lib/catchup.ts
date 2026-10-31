import type { Channel } from './types';

/**
 * Builds a catch-up URL for M3U channels following the common conventions
 * (catchup="default|append|shift|flussonic|xc" + catchup-source templates).
 */
export function buildM3uCatchupUrl(ch: Channel, start: number, end: number, now = Date.now()): string | null {
  if (!ch.url) return null;
  const type = (ch.catchup ?? 'default').toLowerCase();
  const startS = Math.floor(start / 1000);
  const endS = Math.floor(end / 1000);
  const duration = Math.max(60, endS - startS);
  const nowS = Math.floor(now / 1000);

  const fill = (tpl: string): string => {
    const d = new Date(start);
    const e = new Date(end);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return tpl
      .replace(/\{utc\}|\$\{start\}|\{start\}/g, String(startS))
      .replace(/\{utcend\}|\$\{end\}|\{end\}/g, String(endS))
      .replace(/\{lutc\}|\$\{now\}|\{now\}|\$\{timestamp\}|\{timestamp\}/g, String(nowS))
      .replace(/\{duration\}|\$\{duration\}/g, String(duration))
      .replace(/\{duration:(\d+)\}/g, (_m, div: string) => String(Math.floor(duration / Number(div))))
      .replace(/\{offset:(\d+)\}/g, (_m, div: string) => String(Math.floor((nowS - startS) / Number(div))))
      .replace(/\{Y\}/g, String(d.getUTCFullYear()))
      .replace(/\{m\}/g, p2(d.getUTCMonth() + 1))
      .replace(/\{d\}/g, p2(d.getUTCDate()))
      .replace(/\{H\}/g, p2(d.getUTCHours()))
      .replace(/\{M\}/g, p2(d.getUTCMinutes()))
      .replace(/\{S\}/g, p2(d.getUTCSeconds()))
      .replace(/\{\(b\)YmdHMS\}|\{utc:YmdHMS\}/g, `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`)
      .replace(/\{\(e\)YmdHMS\}|\{utcend:YmdHMS\}/g, `${e.getUTCFullYear()}${p2(e.getUTCMonth() + 1)}${p2(e.getUTCDate())}${p2(e.getUTCHours())}${p2(e.getUTCMinutes())}${p2(e.getUTCSeconds())}`);
  };

  if (type === 'xc') {
    const m = ch.url.match(/^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.\w+)?$/);
    if (!m) return null;
    const d = new Date(start);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}:${p2(d.getUTCHours())}-${p2(d.getUTCMinutes())}`;
    return `${m[1]}/timeshift/${m[2]}/${m[3]}/${Math.ceil(duration / 60)}/${stamp}/${m[4]}.ts`;
  }
  if (type === 'flussonic' || type === 'flussonic-hls' || type === 'fs') {
    return ch.url.replace(/\/(index|playlist|mono|video)\.m3u8.*$/, `/$1-${startS}-${duration}.m3u8`).replace(/\/mpegts(\?.*)?$/, `/timeshift_abs-${startS}.ts$1`);
  }
  if (type === 'shift') {
    return `${ch.url}${ch.url.includes('?') ? '&' : '?'}utc=${startS}&lutc=${nowS}`;
  }
  if (type === 'append') {
    return ch.catchupSource ? ch.url + fill(ch.catchupSource) : `${ch.url}${ch.url.includes('?') ? '&' : '?'}utc=${startS}&lutc=${nowS}`;
  }
  // default
  if (ch.catchupSource) {
    const filled = fill(ch.catchupSource);
    return /^https?:\/\//.test(filled) ? filled : ch.url + filled;
  }
  return `${ch.url}${ch.url.includes('?') ? '&' : '?'}utc=${startS}&lutc=${nowS}`;
}
