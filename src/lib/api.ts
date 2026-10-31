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

export function remuxUrl(url: string, opts: { ua?: string; start?: number; transcode?: boolean; audio?: number } = {}): string {
  const p = upstreamParams(url, { ua: opts.ua });
  if (opts.start) p.set('start', String(Math.floor(opts.start)));
  if (opts.transcode) p.set('video', 'transcode');
  if (opts.audio) p.set('audio', String(opts.audio));
  return `${API}/remux?${p}`;
}

export interface ProbeResult {
  duration: number | null;
  streams: { type: string; codec: string; width?: number; height?: number; channels?: number; language?: string }[];
}

export async function probe(url: string, ua?: string): Promise<ProbeResult | null> {
  if (!health?.ffmpeg) return null;
  const p = upstreamParams(url, { ua });
  try {
    const res = await fetch(`${API}/probe?${p}`);
    return res.ok ? ((await res.json()) as ProbeResult) : null;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
    let detail = '';
    try {
      const body = await res.clone().json();
      detail = body?.error ?? '';
    } catch {
      /* not json */
    }
    throw new HttpError(res.status, detail || `Provider returned HTTP ${res.status}`);
  }
  return res;
}

export async function fetchUpstreamJson<T>(url: string, opts: UpstreamOpts & { signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetchUpstream(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Provider returned an invalid response (not JSON). Check the server URL.');
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
