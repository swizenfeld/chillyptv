/**
 * Streaming XMLTV parser. Works in Node and in the browser (no DOM needed).
 * Feed it text chunks with `push()`, then call `finish()`.
 */

export interface EpgChannel {
  id: string;
  name: string;
  icon?: string;
}

/** [start(ms), stop(ms), title, description?, subtitle?, category?, episode?] */
export type EpgProgrammeTuple = [number, number, string, string?, string?, string?, string?];

export interface EpgData {
  channels: Record<string, EpgChannel>;
  programmes: Record<string, EpgProgrammeTuple[]>;
  fetchedAt: number;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITY[code.toLowerCase()] ?? m;
  });
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  return out;
}

/** Parses XMLTV dates like "20240131203000 +0100" (offset optional) into epoch ms. */
export function parseXmltvDate(value: string | undefined): number {
  if (!value) return NaN;
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{2}:?\d{2}|Z)?/);
  if (!m) return NaN;
  const [, y, mo, d, h = '00', mi = '00', s = '00', tz] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    const offMin = parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2, 4), 10);
    ms -= sign * offMin * 60_000;
  }
  return ms;
}

function childText(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(stripCdata(m[1])).trim() : undefined;
}

export interface XmltvParserOptions {
  /** Only keep programmes overlapping [from, to]. */
  from?: number;
  to?: number;
  /** Only keep these channel ids (case-insensitive). */
  channelFilter?: Set<string>;
  /** Hours to add to every programme time (fixes providers with wrong offsets). */
  shiftHours?: number;
}

export class XmltvParser {
  private buf = '';
  readonly data: EpgData = { channels: {}, programmes: {}, fetchedAt: Date.now() };
  private readonly opts: XmltvParserOptions;
  private count = 0;

  constructor(opts: XmltvParserOptions = {}) {
    this.opts = opts;
  }

  get programmeCount(): number {
    return this.count;
  }

  push(chunk: string): void {
    this.buf += chunk;
    let cursor = 0;
    for (;;) {
      const ch = this.buf.indexOf('<channel', cursor);
      const pr = this.buf.indexOf('<programme', cursor);
      let start: number;
      let tag: 'channel' | 'programme';
      if (ch === -1 && pr === -1) break;
      if (pr === -1 || (ch !== -1 && ch < pr)) {
        start = ch;
        tag = 'channel';
      } else {
        start = pr;
        tag = 'programme';
      }
      const close = `</${tag}>`;
      const openEnd = this.buf.indexOf('>', start);
      if (openEnd === -1) {
        cursor = start;
        break;
      }
      // Self-closing element (rare, but valid).
      if (this.buf[openEnd - 1] === '/') {
        this.handle(tag, this.buf.slice(start, openEnd + 1), '');
        cursor = openEnd + 1;
        continue;
      }
      const end = this.buf.indexOf(close, openEnd);
      if (end === -1) {
        cursor = start;
        break;
      }
      this.handle(tag, this.buf.slice(start, openEnd + 1), this.buf.slice(openEnd + 1, end));
      cursor = end + close.length;
    }
    this.buf = this.buf.slice(cursor);
    // Guard against pathological input that never closes an element.
    if (this.buf.length > 4 * 1024 * 1024) this.buf = this.buf.slice(-1024 * 1024);
  }

  finish(): EpgData {
    for (const list of Object.values(this.data.programmes)) list.sort((a, b) => a[0] - b[0]);
    this.buf = '';
    return this.data;
  }

  private handle(tag: 'channel' | 'programme', open: string, inner: string): void {
    const attrs = parseAttrs(open);
    if (tag === 'channel') {
      const id = attrs.id;
      if (!id) return;
      if (this.opts.channelFilter && !this.opts.channelFilter.has(id.toLowerCase())) return;
      const icon = inner.match(/<icon[^>]*src\s*=\s*"([^"]*)"/)?.[1];
      this.data.channels[id] = { id, name: childText(inner, 'display-name') ?? id, icon: icon ? decodeXml(icon) : undefined };
      return;
    }
    const channel = attrs.channel;
    if (!channel) return;
    if (this.opts.channelFilter && !this.opts.channelFilter.has(channel.toLowerCase())) return;
    const shift = (this.opts.shiftHours ?? 0) * 3_600_000;
    const start = parseXmltvDate(attrs.start) + shift;
    let stop = parseXmltvDate(attrs.stop) + shift;
    if (!Number.isFinite(start)) return;
    if (!Number.isFinite(stop)) stop = start + 30 * 60_000;
    if (this.opts.from !== undefined && stop < this.opts.from) return;
    if (this.opts.to !== undefined && start > this.opts.to) return;
    const title = childText(inner, 'title') ?? 'Untitled';
    const desc = childText(inner, 'desc');
    const sub = childText(inner, 'sub-title');
    const cat = childText(inner, 'category');
    const ep = inner.match(/<episode-num[^>]*system="onscreen"[^>]*>([\s\S]*?)<\/episode-num>/)?.[1] ?? childText(inner, 'episode-num');
    const tuple: EpgProgrammeTuple = [start, stop, title];
    if (desc || sub || cat || ep) tuple.push(desc ?? '', sub ?? '', cat ?? '', ep ? decodeXml(ep).trim() : '');
    (this.data.programmes[channel] ??= []).push(tuple);
    this.count++;
  }
}

export function parseXmltv(text: string, opts?: XmltvParserOptions): EpgData {
  const p = new XmltvParser(opts);
  p.push(text);
  return p.finish();
}
