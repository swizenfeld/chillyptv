import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { isHttpUrl, sendError, userAgentFrom } from './util.js';
import { assertAllowedTarget } from './guard.js';

const PASS_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
const CONNECT_TIMEOUT_MS = Number(process.env.CHILLY_PROXY_TIMEOUT_MS ?? 20000);

/** True when a response body is an HLS media/master playlist (not a channel-list M3U). */
export function looksLikeHls(contentType: string, url: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('mpegurl')) return true;
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

/**
 * Rewrites every URI inside an HLS playlist so it is fetched through this proxy.
 * `makeProxyUrl` receives an absolute URL and returns the proxied URL.
 */
export function rewriteHlsPlaylist(body: string, baseUrl: string, makeProxyUrl: (abs: string) => string): string {
  const resolve = (ref: string): string => {
    try {
      return new URL(ref, baseUrl).toString();
    } catch {
      return ref;
    }
  };
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        if (!trimmed.includes('URI="')) return line;
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          if (uri.startsWith('data:') || uri.startsWith('skd:')) return `URI="${uri}"`;
          return `URI="${makeProxyUrl(resolve(uri))}"`;
        });
      }
      return makeProxyUrl(resolve(trimmed));
    })
    .join('\n');
}

export async function handleProxy(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const target = params.get('url');
  if (!isHttpUrl(target)) return sendError(res, 400, 'Missing or invalid url parameter');
  try {
    await assertAllowedTarget(target);
  } catch (e) {
    return sendError(res, 403, (e as Error).message);
  }
  const raw = params.get('raw') === '1';
  const ua = userAgentFrom(params);
  const referer = params.get('ref');

  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  const headers: Record<string, string> = { 'User-Agent': ua, Accept: '*/*' };
  if (referer && isHttpUrl(referer)) headers.Referer = referer;
  if (req.headers.range) headers.Range = String(req.headers.range);

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, redirect: 'follow', signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    res.off('close', onClose);
    if (controller.signal.aborted && res.destroyed) return;
    return sendError(res, 502, `Upstream request failed: ${(e as Error).message}`);
  }
  clearTimeout(timer);

  const contentType = upstream.headers.get('content-type') ?? '';
  const finalUrl = upstream.url || target;

  if (!raw && upstream.ok && looksLikeHls(contentType, finalUrl)) {
    const text = await upstream.text();
    if (text.includes('#EXT-X-') || text.includes('#EXTINF')) {
      const extra = new URLSearchParams();
      if (params.get('ua')) extra.set('ua', ua);
      if (referer) extra.set('ref', referer);
      const suffix = extra.toString() ? `&${extra.toString()}` : '';
      const rewritten = rewriteHlsPlaylist(text, finalUrl, (abs) => `proxy?url=${encodeURIComponent(abs)}${suffix}`);
      res.writeHead(upstream.status, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': Buffer.byteLength(rewritten),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(rewritten);
      return;
    }
    res.writeHead(upstream.status, { 'Content-Type': contentType || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(text);
    return;
  }

  const out: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  for (const h of PASS_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out[h] = v;
  }
  // fetch() transparently decompresses; the original length would be wrong.
  if (upstream.headers.get('content-encoding')) delete out['content-length'];
  out['X-Final-Url'] = finalUrl;
  res.writeHead(upstream.status, out);
  if (!upstream.body || req.method === 'HEAD') {
    res.end();
    return;
  }
  const body = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
