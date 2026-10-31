import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SAFE_PROTOCOLS } from './remux.js';
import { DEFAULT_UA, ffmpegInfo, ffmpegPath, isHttpUrl, readJson, sendError, sendJson } from './util.js';

export type RecordingStatus = 'scheduled' | 'recording' | 'processing' | 'completed' | 'failed' | 'stopped';

export interface Recording {
  id: string;
  title: string;
  channel?: string;
  logo?: string;
  url: string;
  userAgent?: string;
  start: number; // epoch ms
  end: number; // epoch ms
  status: RecordingStatus;
  file?: string;
  size?: number;
  error?: string;
  createdAt: number;
}

const MAX_DURATION_MS = 12 * 60 * 60 * 1000;

export class RecordingManager {
  private items = new Map<string, Recording>();
  private procs = new Map<string, ChildProcess>();
  private timer?: NodeJS.Timeout;
  private readonly dir: string;
  private readonly indexFile: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'recordings');
    this.indexFile = join(this.dir, 'index.json');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const list = JSON.parse(await readFile(this.indexFile, 'utf8')) as Recording[];
      for (const r of list) {
        // Anything that was running when the server died is no longer running.
        if (r.status === 'recording' || r.status === 'processing') {
          r.status = r.file ? 'stopped' : 'failed';
          r.error = r.error ?? 'Server restarted during recording';
        }
        this.items.set(r.id, r);
      }
    } catch {
      /* no index yet */
    }
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
    await this.tick();
  }

  list(): Recording[] {
    return [...this.items.values()].sort((a, b) => b.start - a.start);
  }

  get(id: string): Recording | undefined {
    return this.items.get(id);
  }

  async add(input: Partial<Recording> & { durationMin?: number }): Promise<Recording> {
    if (!isHttpUrl(input.url)) throw new Error('A valid stream url is required');
    const now = Date.now();
    const start = Number(input.start ?? now);
    let end = Number(input.end ?? 0);
    if (!end) end = start + Math.max(1, Number(input.durationMin ?? 60)) * 60_000;
    if (end <= start) throw new Error('End must be after start');
    if (end - start > MAX_DURATION_MS) throw new Error('Recordings are limited to 12 hours');
    if (end <= now) throw new Error('That programme has already finished');
    const rec: Recording = {
      id: randomUUID(),
      title: String(input.title ?? 'Recording').slice(0, 200),
      channel: input.channel ? String(input.channel).slice(0, 200) : undefined,
      logo: input.logo ? String(input.logo).slice(0, 1000) : undefined,
      url: input.url,
      userAgent: input.userAgent,
      start,
      end,
      status: 'scheduled',
      createdAt: now,
    };
    this.items.set(rec.id, rec);
    await this.save();
    await this.tick();
    return rec;
  }

  async stop(id: string): Promise<Recording | undefined> {
    const rec = this.items.get(id);
    if (!rec) return undefined;
    if (rec.status === 'scheduled') {
      rec.status = 'stopped';
      rec.error = 'Cancelled';
    } else if (rec.status === 'recording') {
      rec.end = Date.now();
      this.stopProcess(id);
    }
    await this.save();
    return rec;
  }

  async remove(id: string): Promise<boolean> {
    const rec = this.items.get(id);
    if (!rec) return false;
    this.stopProcess(id);
    if (rec.file) await rm(join(this.dir, rec.file), { force: true });
    await rm(join(this.dir, `${id}.ts`), { force: true });
    this.items.delete(id);
    await this.save();
    return true;
  }

  filePath(rec: Recording): string | undefined {
    return rec.file ? join(this.dir, rec.file) : undefined;
  }

  private stopProcess(id: string): void {
    const proc = this.procs.get(id);
    if (proc && proc.exitCode === null) {
      // 'q' lets ffmpeg close the container cleanly.
      try {
        proc.stdin?.write('q');
      } catch {
        proc.kill('SIGINT');
      }
      setTimeout(() => proc.exitCode === null && proc.kill('SIGKILL'), 5000).unref();
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const rec of this.items.values()) {
      if (rec.status === 'scheduled' && rec.start <= now) {
        if (rec.end <= now) {
          rec.status = 'failed';
          rec.error = 'Missed: server was not running at the scheduled time';
          await this.save();
        } else {
          this.begin(rec);
        }
      } else if (rec.status === 'recording' && rec.end <= now) {
        this.stopProcess(rec.id);
      }
    }
  }

  private begin(rec: Recording): void {
    if (!ffmpegInfo().ffmpeg) {
      rec.status = 'failed';
      rec.error = 'ffmpeg is not installed on the server';
      void this.save();
      return;
    }
    const tsName = `${rec.id}.ts`;
    const out = join(this.dir, tsName);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', SAFE_PROTOCOLS,
      '-user_agent', rec.userAgent ?? DEFAULT_UA,
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10',
      '-i', rec.url,
      '-map', '0:v?', '-map', '0:a?', '-c', 'copy',
      '-f', 'mpegts', '-y', out,
    ];
    const proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    this.procs.set(rec.id, proc);
    rec.status = 'recording';
    rec.file = tsName;
    void this.save();
    proc.on('exit', async (code) => {
      this.procs.delete(rec.id);
      const size = await stat(out).then((s) => s.size).catch(() => 0);
      if (size < 1024) {
        rec.status = 'failed';
        rec.error = stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`;
        await rm(out, { force: true });
        rec.file = undefined;
        await this.save();
        return;
      }
      rec.status = 'processing';
      await this.save();
      await this.finalize(rec, out);
    });
  }

  /** Converts the captured MPEG-TS into a seekable MP4 with AAC audio. */
  private async finalize(rec: Recording, tsPath: string): Promise<void> {
    const mp4Name = `${rec.id}.mp4`;
    const mp4Path = join(this.dir, mp4Name);
    const tmp = `${mp4Path}.part`;
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', tsPath, '-map', '0:v?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', '-y', tmp], { stdio: 'ignore' });
      p.on('exit', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    if (ok) {
      await rename(tmp, mp4Path);
      await rm(tsPath, { force: true });
      rec.file = mp4Name;
    } else {
      await rm(tmp, { force: true });
    }
    rec.size = await stat(join(this.dir, rec.file!)).then((s) => s.size).catch(() => 0);
    rec.status = 'completed';
    await this.save();
  }

  private saving: Promise<void> = Promise.resolve();
  private save(): Promise<void> {
    this.saving = this.saving.then(() => writeFile(this.indexFile, JSON.stringify(this.list(), null, 2))).catch(() => {});
    return this.saving;
  }
}

export async function handleRecordings(manager: RecordingManager, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean); // ['api','recordings',id?,action?]
  const id = parts[2];
  const action = parts[3];
  try {
    if (!id) {
      if (req.method === 'GET') return sendJson(res, 200, manager.list());
      if (req.method === 'POST') {
        const body = await readJson<Partial<Recording> & { durationMin?: number }>(req);
        return sendJson(res, 201, await manager.add(body));
      }
      return sendError(res, 405, 'Method not allowed');
    }
    const rec = manager.get(id);
    if (!rec) return sendError(res, 404, 'Recording not found');
    if (!action && req.method === 'DELETE') {
      await manager.remove(id);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'stop' && req.method === 'POST') return sendJson(res, 200, await manager.stop(id));
    if (action === 'file' && (req.method === 'GET' || req.method === 'HEAD')) return serveFile(req, res, manager.filePath(rec), rec);
    return sendError(res, 404, 'Not found');
  } catch (e) {
    return sendError(res, 400, (e as Error).message);
  }
}

async function serveFile(req: IncomingMessage, res: ServerResponse, file: string | undefined, rec: Recording): Promise<void> {
  if (!file) return sendError(res, 404, 'No file for this recording');
  const info = await stat(file).catch(() => null);
  if (!info) return sendError(res, 404, 'File missing');
  const type = file.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';
  const safeTitle = rec.title.replace(/[^\w\- ]+/g, '').trim() || 'recording';
  const disposition = new URL(req.url ?? '/', 'http://x').searchParams.get('download') ? `attachment; filename="${safeTitle}${file.endsWith('.mp4') ? '.mp4' : '.ts'}"` : 'inline';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      return void res.end();
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}
