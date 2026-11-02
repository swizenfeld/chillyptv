import type { MediaProbe } from '../../shared/media';
/** Talks to the ChillyPTV backend (proxy, remux, EPG, recordings, sync). */

export interface Health {
  ok: boolean;
  version: string;
  ffmpeg: boolean;
  transcode: boolean;
  recordings: boolean;
  sync: boolean;
  time: number;
}

const API = `${import.meta.env.BASE_URL}api`;

interface NetConfig {
  useProxy: boolean;
  userAgent?: string;
}
let net: NetConfig = { useProxy: true };
let health: Health | null = null;

export function setNetworkConfig(cfg: NetConfig): void {
  net = cfg;
}

export function backendHealth(): Health | null {
  return health;
}

export async function checkBackend(): Promise<Health | null> {
  try {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    health = res.ok ? ((await res.json()) as Health) : null;
  } catch {
    health = null;
  }
  return health;
}

export function proxyActive(): boolean {
  return net.useProxy && !!health?.ok;
}

export interface UpstreamOpts {
  ua?: string;
  ref?: string;
  /** Do not rewrite HLS manifests (for API calls and channel-list M3U files). */
  raw?: boolean;
}

function upstreamParams(url: string, opts: UpstreamOpts = {}): URLSearchParams {
  const p = new URLSearchParams({ url });
  const ua = opts.ua || net.userAgent;
  if (ua) p.set('ua', ua);
  if (opts.ref) p.set('ref', opts.ref);
  if (opts.raw) p.set('raw', '1');
  return p;
}

/** Returns a URL that fetches `url` through the backend proxy when it is available. */
export function proxied(url: string, opts: UpstreamOpts = {}): string {
  if (!proxyActive() || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith(API)) return url;
  return `${API}/proxy?${upstreamParams(url, opts)}`;
}

/** Image URLs: proxy only when the page is https and the image is http (mixed content). */
export function imageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (location.protocol === 'https:' && url.startsWith('http:') && proxyActive()) return proxied(url, { raw: true });
  return url;
}

export function remuxUrl(url: string, opts: { ua?: string; start?: number; transcode?: boolean; audio?: number; sub?: number; sid?: string } = {}): string {
  const p = upstreamParams(url, { ua: opts.ua });
  if (opts.start) p.set('start', String(Math.floor(opts.start)));
  if (opts.transcode) p.set('video', 'transcode');
  if (opts.audio) p.set('audio', String(opts.audio));
  if (opts.sid) p.set('sid', opts.sid);
  if (opts.sub !== undefined && opts.sub >= 0) p.set('sub', String(opts.sub));
  return `${API}/remux?${p}`;
}

/** WebVTT written so far by a remux session (see remuxUrl `sid`/`sub`). */
export async function remuxSubtitles(sid: string, from: number): Promise<{ text: string; next: number; done: boolean; base: number | null } | null> {
  try {
    const res = await fetch(`${API}/remux/subs?${new URLSearchParams({ sid, from: String(from) })}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as { text: string; next: number; done: boolean; base: number | null }) : null;
  } catch {
    return null;
  }
}

export type ProbeResult = MediaProbe;

export async function probe(url: string, ua?: string, signal?: AbortSignal): Promise<ProbeResult | null> {
  if (!health?.ffmpeg) return null;
  const p = upstreamParams(url, { ua });
  try {
    const res = await fetch(`${API}/probe?${p}`, { signal });
    return res.ok ? ((await res.json()) as ProbeResult) : null;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** "network": the ChillyPTV server could not reach the provider; "http": the provider answered with this status. */
    public kind: 'network' | 'http' = 'http',
  ) {
    super(message);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Rewrites a failed login/playlist request as a message that says what to check. */
export function explainSourceError(e: unknown, url: string, kind: 'xtream' | 'm3u'): Error {
  if (!(e instanceof HttpError)) return e as Error;
  const host = hostOf(url);
  if (e.kind === 'network') return new Error(`${e.message}. Check the server address and port, and that the provider is online.`);
  if (e.status === 404)
    return new Error(
      kind === 'xtream'
        ? `No Xtream Codes service at ${host} (HTTP 404). Check the server URL and port: it is the part before /get.php or /player_api.php.`
        : 'Playlist not found at that address (HTTP 404). Check that the link is complete and still valid.',
    );
  if (e.status === 401 || e.status === 403)
    return new Error(`${host} refused access (HTTP ${e.status}). The subscription may be blocked or expired, or the provider requires a specific User-Agent (see Advanced options).`);
  if (e.status === 429) return new Error(`${host} is rate-limiting requests (HTTP 429). Wait a minute and try again.`);
  if (e.status >= 500) return new Error(`${host} had a server error (HTTP ${e.status}). Try again in a few minutes.`);
  return new Error(`${host} answered with HTTP ${e.status}.`);
}

export async function fetchUpstream(url: string, opts: UpstreamOpts & { signal?: AbortSignal } = {}): Promise<Response> {
  const target = proxyActive() ? `${API}/proxy?${upstreamParams(url, { ...opts, raw: true })}` : url;
  let res: Response;
  try {
    res = await fetch(target, { signal: opts.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(
      proxyActive()
        ? `Could not reach the ChillyPTV server: ${(e as Error).message}`
        : 'Network error. The provider probably blocks browser requests (CORS) — start the ChillyPTV server and enable the proxy in Settings.',
    );
  }
  if (!res.ok) {
    // Real provider responses carry X-Final-Url; anything else is the proxy reporting a connection problem.
    const fromProxy = proxyActive() && !res.headers.get('x-final-url');
    let detail = '';
    if (fromProxy) {
      try {
        detail = ((await res.clone().json()) as { error?: string })?.error ?? '';
      } catch {
        /* not json */
      }
    }
    throw new HttpError(res.status, detail || `Provider returned HTTP ${res.status}`, fromProxy ? 'network' : 'http');
  }
  return res;
}

export async function fetchUpstreamJson<T>(url: string, opts: UpstreamOpts & { signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetchUpstream(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("That address answered, but not like an Xtream Codes server (the response isn't JSON). Check the server URL and port.");
  }
}

export async function fetchUpstreamText(url: string, opts: UpstreamOpts & { signal?: AbortSignal } = {}): Promise<string> {
  const res = await fetchUpstream(url, opts);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

/** Server-side parsed XMLTV (compact JSON). */
export function epgEndpoint(url: string, opts: { ua?: string; past?: number; future?: number; refresh?: boolean } = {}): string {
  const p = upstreamParams(url, { ua: opts.ua });
  if (opts.past !== undefined) p.set('past', String(opts.past));
  if (opts.future !== undefined) p.set('future', String(opts.future));
  if (opts.refresh) p.set('refresh', '1');
  return `${API}/epg?${p}`;
}

// ------------------------------------------------------------ recordings ----
export interface RecordingDto {
  id: string;
  title: string;
  channel?: string;
  logo?: string;
  url: string;
  start: number;
  end: number;
  status: 'scheduled' | 'recording' | 'processing' | 'completed' | 'failed' | 'stopped';
  file?: string;
  size?: number;
  error?: string;
  createdAt: number;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const recordingsApi = {
  list: () => apiJson<RecordingDto[]>('/recordings'),
  create: (body: { url: string; title: string; channel?: string; logo?: string; start?: number; end?: number; durationMin?: number; userAgent?: string }) =>
    apiJson<RecordingDto>('/recordings', { method: 'POST', body: JSON.stringify(body) }),
  stop: (id: string) => apiJson<RecordingDto>(`/recordings/${id}/stop`, { method: 'POST' }),
  remove: (id: string) => apiJson<{ ok: true }>(`/recordings/${id}`, { method: 'DELETE' }),
  fileUrl: (id: string, download = false) => `${API}/recordings/${id}/file${download ? '?download=1' : ''}`,
};

// ------------------------------------------------------------------ sync ----
export const syncApi = {
  async get<T>(key: string): Promise<T | null> {
    const res = await fetch(`${API}/state/${key}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  },
  async put(key: string, value: unknown): Promise<void> {
    const res = await fetch(`${API}/state/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  },
};
