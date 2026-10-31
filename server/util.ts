import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, status, { error: message });
}

export async function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJson<T = unknown>(req: IncomingMessage): Promise<T> {
  const text = await readBody(req);
  return (text ? JSON.parse(text) : {}) as T;
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

let ffmpegCache: { ffmpeg: boolean; libx264: boolean } | null = null;
export function ffmpegInfo(): { ffmpeg: boolean; libx264: boolean } {
  if (ffmpegCache) return ffmpegCache;
  const bin = ffmpegPath();
  const probe = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const ok = probe.status === 0;
  ffmpegCache = { ffmpeg: ok, libx264: ok && /libx264/.test(probe.stdout) };
  return ffmpegCache;
}

export function ffmpegPath(): string {
  return process.env.CHILLY_FFMPEG ?? 'ffmpeg';
}

export const DEFAULT_UA =
  process.env.CHILLY_USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Picks a user agent from the request query (`ua`) or falls back to the default. */
export function userAgentFrom(params: URLSearchParams): string {
  const ua = params.get('ua');
  return ua && ua.length < 512 ? ua : DEFAULT_UA;
}
