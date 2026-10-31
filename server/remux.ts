import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { ffmpegInfo, ffmpegPath, isHttpUrl, sendError, sendJson, userAgentFrom } from './util.js';
import { assertAllowedTarget } from './guard.js';

/** Only allow network protocols as ffmpeg input (no file:, pipe:, concat: …). */
export const SAFE_PROTOCOLS = 'http,https,tcp,tls,crypto,httpproxy';

/**
 * Builds ffmpeg arguments that turn any input (MKV, AVI, HEVC, AC3/EAC3 audio…)
 * into a browser-friendly MPEG-TS stream (H.264 + AAC) on stdout.
 */
export function buildRemuxArgs(opts: { url: string; ua: string; start?: number; transcodeVideo?: boolean; audioIndex?: number; hasX264: boolean }): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', SAFE_PROTOCOLS, '-user_agent', opts.ua];
  args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  if (opts.start && opts.start > 0) args.push('-ss', String(Math.floor(opts.start)));
  args.push('-i', opts.url);
  args.push('-map', '0:v:0?', '-map', `0:a:${opts.audioIndex ?? 0}?`);
  if (opts.transcodeVideo && opts.hasX264) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }
  args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  args.push('-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1');
  return args;
}

export async function handleRemux(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const info = ffmpegInfo();
  if (!info.ffmpeg) return sendError(res, 501, 'ffmpeg is not installed on the server');
  const url = params.get('url');
  if (!isHttpUrl(url)) return sendError(res, 400, 'Missing or invalid url parameter');
  try {
    await assertAllowedTarget(url);
  } catch (e) {
    return sendError(res, 403, (e as Error).message);
  }
  const args = buildRemuxArgs({
    url,
    ua: userAgentFrom(params),
    start: Number(params.get('start') ?? 0) || 0,
    transcodeVideo: params.get('video') === 'transcode',
    audioIndex: Number(params.get('audio') ?? 0) || 0,
    hasX264: info.libx264,
  });
  const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  let started = false;
  child.stdout.once('data', () => {
    started = true;
  });
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  child.stdout.pipe(res);
  const kill = () => {
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  res.on('close', kill);
  child.on('exit', (code) => {
    if (!started && code !== 0) console.warn(`[remux] ffmpeg exited ${code}: ${stderr.trim()}`);
    res.end();
  });
}

/** Returns container duration and codecs via ffprobe (used for remux seeking). */
export async function handleProbe(_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  if (!ffmpegInfo().ffmpeg) return sendError(res, 501, 'ffmpeg is not installed on the server');
  const url = params.get('url');
  if (!isHttpUrl(url)) return sendError(res, 400, 'Missing or invalid url parameter');
  try {
    await assertAllowedTarget(url);
  } catch (e) {
    return sendError(res, 403, (e as Error).message);
  }
  const bin = process.env.CHILLY_FFPROBE ?? ffmpegPath().replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  const child = spawn(bin, ['-v', 'error', '-protocol_whitelist', SAFE_PROTOCOLS, '-user_agent', userAgentFrom(params), '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,channels:stream_tags=language', '-of', 'json', url], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  child.on('close', () => {
    clearTimeout(timer);
    try {
      const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number; channels?: number; tags?: { language?: string } }[] };
      sendJson(res, 200, {
        duration: Number(j.format?.duration) || null,
        streams: (j.streams ?? []).map((s) => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height, channels: s.channels, language: s.tags?.language })),
      });
    } catch {
      sendError(res, 502, 'Probe failed');
    }
  });
}
