import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy } from './proxy.js';
import { handleProbe, handleRemux } from './remux.js';
import { RecordingManager, handleRecordings } from './recordings.js';
import { StateStore, handleState } from './state.js';
import { serveStatic } from './static.js';
import { serveEpg } from './epg.js';
import { handleFixtures } from './sports.js';
import { ffmpegInfo, sendError, sendJson } from './util.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.CHILLY_DATA_DIR ?? join(process.cwd(), 'data'));
const STATIC_DIR = resolve(
  process.env.CHILLY_STATIC_DIR ?? [join(here, '..', 'dist'), join(here, '..', '..', 'dist')].find((d) => existsSync(join(d, 'index.html'))) ?? join(here, '..', 'dist'),
);
const PASSWORD = process.env.CHILLY_PASSWORD ?? '';
const VERSION = '0.1.0';

const recordings = new RecordingManager(DATA_DIR);
const state = new StateStore(DATA_DIR);

function authorized(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  const a = Buffer.from(pass);
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="ChillyPTV", charset="UTF-8"' });
    res.end('Authentication required');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Range',
    });
    res.end();
    return;
  }

  if (path === '/api/health') {
    const ff = ffmpegInfo();
    return sendJson(res, 200, { ok: true, version: VERSION, ffmpeg: ff.ffmpeg, transcode: ff.libx264, recordings: ff.ffmpeg, sync: true, time: Date.now() });
  }
  if (path === '/api/proxy') return handleProxy(req, res, url.searchParams);
  if (path === '/api/remux') return handleRemux(req, res, url.searchParams);
  if (path === '/api/probe') return handleProbe(req, res, url.searchParams);
  if (path === '/api/epg') return serveEpg(req, res, url.searchParams);
  if (path === '/api/sports/fixtures') return handleFixtures(req, res, url.searchParams);
  if (path === '/api/recordings' || path.startsWith('/api/recordings/')) return handleRecordings(recordings, req, res, path);
  if (path.startsWith('/api/state/')) return handleState(state, req, res, path);
  if (path.startsWith('/api/')) return sendError(res, 404, 'Unknown API route');

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method not allowed');
  const served = await serveStatic(req, res, STATIC_DIR, path);
  if (!served) sendError(res, 404, 'Not found');
}

async function main(): Promise<void> {
  await Promise.all([recordings.init(), state.init()]);
  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error('[server]', err);
      sendError(res, 500, 'Internal server error');
    });
  });
  server.requestTimeout = 0; // live streams are long-lived
  server.listen(PORT, HOST, () => {
    const ff = ffmpegInfo();
    console.log(`ChillyPTV server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  data dir: ${DATA_DIR}`);
    console.log(`  ffmpeg:   ${ff.ffmpeg ? 'available' : 'not found (remux/recording disabled)'}`);
    if (PASSWORD) console.log('  auth:     password protection enabled');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
