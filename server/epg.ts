import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { XmltvParser, type EpgData } from '../shared/xmltv.js';
import { isHttpUrl, sendError, userAgentFrom } from './util.js';
import { assertAllowedTarget } from './guard.js';

interface CacheEntry {
  at: number;
  body: Buffer; // gzipped JSON
  promise?: Promise<Buffer>;
}

const TTL_MS = Number(process.env.CHILLY_EPG_TTL_MIN ?? 180) * 60_000;
const cache = new Map<string, CacheEntry>();

/** Downloads (optionally gzipped) XMLTV and streams it through the parser. */
export async function fetchXmltv(url: string, ua: string, opts: { pastDays: number; futureDays: number }): Promise<EpgData> {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: '*/*' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`EPG download failed: HTTP ${res.status}`);
  const now = Date.now();
  const parser = new XmltvParser({ from: now - opts.pastDays * 86_400_000, to: now + opts.futureDays * 86_400_000 });
  let stream: ReadableStream<Uint8Array> = res.body;
  const reader0 = stream.getReader();
  const first = await reader0.read();
  reader0.releaseLock();
  const head = first.value;
  // Re-assemble the stream with the sniffed first chunk.
  const rest = stream;
  stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (head) controller.enqueue(head);
      const r = rest.getReader();
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        controller.enqueue(value);
      }
      controller.close();
    },
  });
  const gz = head && head[0] === 0x1f && head[1] === 0x8b;
  if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  return parser.finish();
}

export async function serveEpg(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const url = params.get('url');
  if (!isHttpUrl(url)) return sendError(res, 400, 'Missing or invalid url parameter');
  try {
    await assertAllowedTarget(url);
  } catch (e) {
    return sendError(res, 403, (e as Error).message);
  }
  const ua = userAgentFrom(params);
  const pastDays = Math.min(14, Math.max(0, Number(params.get('past') ?? 3)));
  const futureDays = Math.min(14, Math.max(1, Number(params.get('future') ?? 4)));
  const key = `${url}|${pastDays}|${futureDays}`;
  const force = params.get('refresh') === '1';

  let entry = cache.get(key);
  if (force || !entry || Date.now() - entry.at > TTL_MS) {
    if (!entry?.promise) {
      const promise = fetchXmltv(url, ua, { pastDays, futureDays }).then((data) => gzipSync(JSON.stringify(data)));
      entry = { at: entry?.at ?? 0, body: entry?.body ?? Buffer.alloc(0), promise };
      cache.set(key, entry);
      promise
        .then((body) => cache.set(key, { at: Date.now(), body }))
        .catch(() => {
          const e = cache.get(key);
          if (e) e.promise = undefined;
        });
    }
    try {
      await entry.promise;
    } catch (e) {
      if (!entry.body.length) return sendError(res, 502, (e as Error).message);
    }
    entry = cache.get(key)!;
  }
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const { gunzipSync } = await import('node:zlib');
  const body = acceptsGzip ? entry.body : gunzipSync(entry.body);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...(acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(body);
}
