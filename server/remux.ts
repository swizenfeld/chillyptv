import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { ffmpegInfo, ffmpegPath, isHttpUrl, sendError, sendJson, userAgentFrom } from './util.js';
import { assertAllowedTarget } from './guard.js';
import { ffprobeArgs, parseProbe } from '../shared/media.js';

/** Only allow network protocols as ffmpeg input (no file:, pipe:, concat: …). */
export const SAFE_PROTOCOLS = 'http,https,tcp,tls,crypto,httpproxy';

/**
 * Builds ffmpeg arguments that turn any input (MKV, AVI, HEVC, AC3/EAC3 audio…)
 * into a browser-friendly MPEG-TS stream (H.264 + AAC) on stdout.
 */
export function buildRemuxArgs(opts: { url: string; ua: string; start?: number; transcodeVideo?: boolean; audioIndex?: number; subtitleIndex?: number; hasX264: boolean }): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', SAFE_PROTOCOLS, '-user_agent', opts.ua];
  args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  const subs = opts.subtitleIndex !== undefined && opts.subtitleIndex >= 0;
  // With subtitles, keep the file's own timestamps on every output: stream copy restarts at the
  // keyframe *before* the seek point, so cues timed from the seek point would show early.
  if (subs) args.push('-copyts');
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
  // Chosen subtitles leave the same ffmpeg process as WebVTT on fd 3, so the provider sees one
  // connection (plans often allow just one). Cues arrive as playback reaches them.
  // fd 4 reports the first video frame's time, which the player's clock starts from.
  if (subs) {
    args.push('-map', `0:s:${opts.subtitleIndex}`, '-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', 'pipe:3');
    args.push('-map', '0:v:0?', '-c:v', 'copy', '-frames:v', '1', '-f', 'framemd5', 'pipe:4');
  }
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
  const sid = /^[\w-]{8,64}$/.test(params.get('sid') ?? '') ? params.get('sid')! : undefined;
  const args = buildRemuxArgs({
    url,
    ua: userAgentFrom(params),
    start: Number(params.get('start') ?? 0) || 0,
    transcodeVideo: params.get('video') === 'transcode',
    audioIndex: Number(params.get('audio') ?? 0) || 0,
    subtitleIndex: sid && params.get('sub') !== null ? Number(params.get('sub')) : undefined,
    hasX264: info.libx264,
  });
  const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
  if (sid && args.includes('pipe:3')) {
    const session: SubtitleSession = { text: '', done: false, at: Date.now(), base: null };
    let md5 = '';
    (child.stdio[4] as NodeJS.ReadableStream).on('data', (d: Buffer) => {
      md5 += d.toString();
      if (session.base === null) session.base = firstFrameTime(md5);
    });
    subtitleSessions.set(sid, session);
    const fd3 = child.stdio[3] as NodeJS.ReadableStream;
    fd3.on('data', (d: Buffer) => {
      if (session.text.length < 8 * 1024 * 1024) session.text += d.toString('utf8');
      session.at = Date.now();
    });
    fd3.on('end', () => (session.done = true));
  }
  let stderr = '';
  child.stderr!.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  let started = false;
  child.stdout!.once('data', () => {
    started = true;
  });
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  child.stdout!.pipe(res);
  const kill = () => {
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  res.on('close', kill);
  child.on('exit', (code) => {
    if (!started && code !== 0) console.warn(`[remux] ffmpeg exited ${code}: ${stderr.trim()}`);
    res.end();
  });
}

/** Container duration, codecs, and audio/subtitle tracks via ffprobe (shared/media.ts). */
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
  const child = spawn(bin, ffprobeArgs(url, userAgentFrom(params), SAFE_PROTOCOLS), { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  child.on('error', () => sendError(res, 501, 'ffprobe is not installed on the server'));
  child.on('close', () => {
    clearTimeout(timer);
    if (res.headersSent) return;
    try {
      sendJson(res, 200, parseProbe(JSON.parse(out)));
    } catch {
      sendError(res, 502, 'Probe failed');
    }
  });
}

// ------------------------------------------------------------- subtitles ---
/** WebVTT written by running remux processes, by client session id. */
interface SubtitleSession {
  text: string;
  done: boolean;
  at: number;
  /** File time (s) of the first video frame sent; the player's clock is 0 there. */
  base: number | null;
}
const subtitleSessions = new Map<string, SubtitleSession>();

/** First packet time from ffmpeg's framemd5 output ("#tb 0: 1/1000" … "0, dts, pts, …"). */
export function firstFrameTime(md5: string): number | null {
  const tb = md5.match(/^#tb 0: (\d+)\/(\d+)/m);
  const line = md5.split('\n').find((l) => /^\s*0,/.test(l));
  if (!tb || !line) return null;
  const pts = Number(line.split(',')[2]);
  return Number.isFinite(pts) ? (pts * Number(tb[1])) / Number(tb[2]) : null;
}
setInterval(() => {
  for (const [k, v] of subtitleSessions) if (Date.now() - v.at > 30 * 60_000) subtitleSessions.delete(k);
}, 60_000).unref();

/** GET /api/remux/subs?sid=…&from=N → the WebVTT text after byte N so far, and whether it is complete. */
export function handleRemuxSubs(_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void {
  const s = subtitleSessions.get(params.get('sid') ?? '');
  if (!s) return sendJson(res, 200, { text: '', next: 0, done: false, base: null });
  const from = Math.max(0, Number(params.get('from') ?? 0) || 0);
  sendJson(res, 200, { text: s.text.slice(from), next: s.text.length, done: s.done, base: s.base });
}
