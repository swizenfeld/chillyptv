/**
 * Mock IPTV provider (Xtream Codes compatible) for development, demos and e2e tests.
 *
 *   npm run mock            → http://localhost:8788   (username: demo / password: demo)
 *
 * Endpoints: player_api.php, get.php (M3U), xmltv.php, /live, /movie, /series, /timeshift.
 * Media is generated locally with ffmpeg on first start (mock/media).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(here, 'media');
const PORT = Number(process.env.MOCK_PORT ?? 8788);
const USER = 'demo';
const PASS = 'demo';
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// ---------------------------------------------------------------- media ----
const SOURCES = [
  { key: 'a', src: 'testsrc2=size=640x360:rate=25', tone: 440, label: 'CHANNEL A' },
  { key: 'b', src: 'smptehdbars=size=640x360:rate=25', tone: 660, label: 'CHANNEL B' },
  { key: 'c', src: 'mandelbrot=size=640x360:rate=25', tone: 880, label: 'CHANNEL C' },
];

function ff(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function text(label: string): string {
  return existsSync(FONT)
    ? `,drawtext=fontfile=${FONT}:text='${label}':fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-90,drawtext=fontfile=${FONT}:text='%{pts\\:hms}':fontsize=28:fontcolor=yellow:x=20:y=20`
    : '';
}

function ensureMedia(): void {
  mkdirSync(MEDIA, { recursive: true });
  for (const s of SOURCES) {
    const out = join(MEDIA, `live-${s.key}.mp4`);
    if (existsSync(out)) continue;
    console.log(`[mock] generating ${out}`);
    ff(['-f', 'lavfi', '-i', `${s.src}`, '-f', 'lavfi', '-i', `sine=frequency=${s.tone}:sample_rate=48000`, '-t', '60',
      '-vf', `format=yuv420p${text(s.label)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '96k', '-shortest', out]);
  }
  const movie = join(MEDIA, 'movie.mp4');
  if (!existsSync(movie)) {
    console.log('[mock] generating movie.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=854x480:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=520:sample_rate=48000', '-t', '90',
      '-vf', `format=yuv420p${text('MOVIE')}`, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', movie]);
  }
  const mkv = join(MEDIA, 'movie-ac3.mkv');
  if (!existsSync(mkv)) {
    console.log('[mock] generating movie-ac3.mkv (needs server remux in browsers)');
    ff(['-f', 'lavfi', '-i', 'smptehdbars=size=854x480:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000', '-t', '60',
      '-vf', `format=yuv420p${text('MKV AC3')}`, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'ac3', '-shortest', mkv]);
  }
  const ep = join(MEDIA, 'episode.mp4');
  if (!existsSync(ep)) {
    console.log('[mock] generating episode.mp4');
    ff(['-f', 'lavfi', '-i', 'mandelbrot=size=854x480:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=48000', '-t', '45',
      '-vf', `format=yuv420p${text('EPISODE')}`, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', ep]);
  }
}

/** One continuous live HLS encoder (stream copy, looped) per source. */
const encoders: ChildProcess[] = [];
function startLiveEncoders(): void {
  for (const s of SOURCES) {
    const dir = join(MEDIA, `hls-${s.key}`);
    mkdirSync(dir, { recursive: true });
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', join(MEDIA, `live-${s.key}.mp4`),
      '-c', 'copy', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments+omit_endlist',
      '-hls_segment_filename', join(dir, 'seg_%05d.ts'), join(dir, 'index.m3u8')], { stdio: 'ignore' });
    encoders.push(p);
  }
}
process.on('exit', () => encoders.forEach((p) => p.kill('SIGKILL')));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ----------------------------------------------------------------- data ----
const LIVE_CATS = ['News', 'Sports', 'Movies 24/7', 'Kids', 'Documentary', 'Music', 'UK | Entertainment', 'US | Local', 'Adult XXX'];
const VOD_CATS = ['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Family'];
const SERIES_CATS = ['Crime Drama', 'Sitcoms', 'Anime'];
const WORDS = ['Global', 'Prime', 'Star', 'Nova', 'Metro', 'Pulse', 'Vista', 'Arena', 'Echo', 'Zen', 'Orbit', 'Peak', 'Wave', 'Blue', 'Fox', 'Sky'];
const SHOWS = ['Morning Briefing', 'World Report', 'Match Day Live', 'The Late Show', 'Nature Uncovered', 'Kitchen Heroes', 'Top 40 Countdown',
  'Cartoon Club', 'Breaking Point', 'Market Watch', 'Champions League Highlights', 'Classic Cinema', 'Weather Now', 'Planet Ocean', 'Tech Today',
  'Comedy Hour', 'Inside the Studio', 'Grand Prix Qualifying', 'History Mysteries', 'Late Night Jazz'];

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface LiveCh { id: number; name: string; cat: number; src: string; archive: boolean; epgId: string }
const live: LiveCh[] = [];
{
  const r = rand(42);
  let id = 1;
  LIVE_CATS.forEach((cat, ci) => {
    const n = ci === 0 ? 40 : 12 + Math.floor(r() * 20);
    for (let i = 0; i < n; i++) {
      const prefix = cat.includes('|') ? cat.split('|')[0].trim() + ': ' : '';
      const name = `${prefix}${WORDS[Math.floor(r() * WORDS.length)]} ${cat.replace(/.*\| /, '').split(' ')[0]} ${i + 1}${r() > 0.7 ? ' HD' : ''}`;
      live.push({ id, name, cat: ci + 1, src: SOURCES[id % 3].key, archive: r() > 0.5, epgId: `ch${id}.mock` });
      id++;
    }
  });
}
const movies = Array.from({ length: 60 }, (_, i) => ({
  id: 5000 + i,
  name: `${['The', 'Return of the', 'Last', 'Secret', 'Midnight'][i % 5]} ${WORDS[i % WORDS.length]} ${['Protocol', 'Odyssey', 'Heist', 'Garden', 'Signal', 'Run'][i % 6]} (${2000 + (i % 25)})`,
  cat: (i % VOD_CATS.length) + 1,
  ext: i % 7 === 3 ? 'mkv' : 'mp4',
  rating: ((i * 37) % 50) / 10 + 5,
  added: Math.floor(Date.now() / 1000) - i * 86400,
}));
const series = Array.from({ length: 18 }, (_, i) => ({
  id: 9000 + i,
  name: `${WORDS[(i + 3) % WORDS.length]} ${['Detectives', 'Family', 'Academy', 'Chronicles', 'Street', 'Hospital'][i % 6]}`,
  cat: (i % SERIES_CATS.length) + 1,
  seasons: 1 + (i % 3),
  eps: 4 + (i % 4),
}));

function epgFor(ch: LiveCh, from: number, to: number) {
  const slot = 30 * 60_000;
  const out: { start: number; end: number; title: string; desc: string }[] = [];
  let t = Math.floor(from / slot) * slot;
  while (t < to) {
    const r = rand(ch.id * 100000 + Math.floor(t / slot));
    const len = slot * (1 + Math.floor(r() * 3));
    const title = SHOWS[Math.floor(r() * SHOWS.length)];
    out.push({ start: t, end: t + len, title, desc: `${title} on ${ch.name}. Episode ${1 + Math.floor(r() * 120)} — a mock programme description for testing.` });
    t += len;
  }
  return out;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const pad = (n: number) => String(n).padStart(2, '0');
const fmtLocal = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const xmltvDate = (ms: number) => fmtLocal(ms).replace(/[-: ]/g, '') + ' +0000';
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- http -----
function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const size = statSync(file).size;
  const m = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

function svg(res: ServerResponse, label: string, hue: number, w: number, h: number) {
  const initials = label.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
  res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,25%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.min(w, h) / 3}" fill="white">${escXml(initials)}</text></svg>`);
}

function base(req: IncomingMessage) {
  return `http://${req.headers.host ?? `localhost:${PORT}`}`;
}

function liveStreamTs(res: ServerResponse, src: string, opts: { realtime: boolean; seconds?: number }) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (opts.realtime) args.push('-re');
  args.push('-stream_loop', '-1', '-i', join(MEDIA, `live-${src}.mp4`));
  if (opts.seconds) args.push('-t', String(opts.seconds));
  args.push('-c', 'copy', '-f', 'mpegts', 'pipe:1');
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  res.writeHead(200, { 'Content-Type': 'video/mp2t' });
  p.stdout.pipe(res);
  res.on('close', () => p.kill('SIGKILL'));
}

function handleApi(req: IncomingMessage, res: ServerResponse, q: URLSearchParams) {
  if (q.get('username') !== USER || q.get('password') !== PASS) {
    return json(res, { user_info: { auth: 0 } });
  }
  const host = new URL(base(req));
  const action = q.get('action');
  const now = Date.now();
  const catId = q.get('category_id');
  switch (action) {
    case null:
    case '':
      return json(res, {
        user_info: { username: USER, password: PASS, message: 'Welcome to the ChillyPTV mock provider', auth: 1, status: 'Active',
          exp_date: String(Math.floor(now / 1000) + 86400 * 120), is_trial: '0', active_cons: '0', created_at: String(Math.floor(now / 1000) - 86400 * 200),
          max_connections: '2', allowed_output_formats: ['m3u8', 'ts'] },
        server_info: { url: host.hostname, port: host.port || '80', https_port: '443', server_protocol: 'http', rtmp_port: '1935',
          timezone: 'UTC', timestamp_now: Math.floor(now / 1000), time_now: fmtLocal(now) },
      });
    case 'get_live_categories':
      return json(res, LIVE_CATS.map((name, i) => ({ category_id: String(i + 1), category_name: name, parent_id: 0 })));
    case 'get_vod_categories':
      return json(res, VOD_CATS.map((name, i) => ({ category_id: String(i + 101), category_name: name, parent_id: 0 })));
    case 'get_series_categories':
      return json(res, SERIES_CATS.map((name, i) => ({ category_id: String(i + 201), category_name: name, parent_id: 0 })));
    case 'get_live_streams':
      return json(res, live.filter((c) => !catId || String(c.cat) === catId).map((c, i) => ({
        num: i + 1, name: c.name, stream_type: 'live', stream_id: c.id, stream_icon: `${base(req)}/logo/${c.id}.svg`, epg_channel_id: c.epgId,
        added: '1700000000', category_id: String(c.cat), custom_sid: '', tv_archive: c.archive ? 1 : 0, direct_source: '', tv_archive_duration: c.archive ? 3 : 0,
      })));
    case 'get_vod_streams':
      return json(res, movies.filter((m) => !catId || String(m.cat + 100) === catId).map((m, i) => ({
        num: i + 1, name: m.name, stream_type: 'movie', stream_id: m.id, stream_icon: `${base(req)}/poster/${m.id}.svg`, rating: m.rating.toFixed(1),
        rating_5based: (m.rating / 2).toFixed(1), added: String(m.added), category_id: String(m.cat + 100), container_extension: m.ext, custom_sid: '', direct_source: '',
      })));
    case 'get_series':
      return json(res, series.filter((s) => !catId || String(s.cat + 200) === catId).map((s, i) => ({
        num: i + 1, name: s.name, series_id: s.id, cover: `${base(req)}/poster/${s.id}.svg`, plot: `${s.name} follows a group of characters through ${s.seasons} season(s) of mock drama.`,
        cast: 'Alex Doe, Sam Roe', director: 'J. Smith', genre: SERIES_CATS[s.cat - 1], releaseDate: '2021-05-01', last_modified: String(Math.floor(now / 1000) - s.id),
        rating: '7.8', rating_5based: '3.9', backdrop_path: [`${base(req)}/backdrop/${s.id}.svg`], youtube_trailer: '', episode_run_time: '45', category_id: String(s.cat + 200),
      })));
    case 'get_vod_info': {
      const m = movies.find((x) => String(x.id) === q.get('vod_id'));
      if (!m) return json(res, { info: [], movie_data: {} });
      return json(res, {
        info: { movie_image: `${base(req)}/poster/${m.id}.svg`, backdrop_path: [`${base(req)}/backdrop/${m.id}.svg`], youtube_trailer: '', genre: VOD_CATS[m.cat - 1],
          plot: `${m.name} is a thrilling mock feature used to test the movie details screen, resume playback and the server-side remux for ${m.ext.toUpperCase()} files.`,
          cast: 'Jane Actor, John Performer, Max Extra', director: 'Ada Director', rating: m.rating.toFixed(1), releasedate: `${m.name.match(/\((\d{4})\)/)?.[1] ?? '2020'}-01-01`,
          duration_secs: m.ext === 'mkv' ? 60 : 90, duration: m.ext === 'mkv' ? '00:01:00' : '00:01:30', video: { codec_name: 'h264', width: 854, height: 480 },
          audio: { codec_name: m.ext === 'mkv' ? 'ac3' : 'aac', channels: 2 }, bitrate: 1200 },
        movie_data: { stream_id: m.id, name: m.name, added: String(m.added), category_id: String(m.cat + 100), container_extension: m.ext },
      });
    }
    case 'get_series_info': {
      const s = series.find((x) => String(x.id) === q.get('series_id'));
      if (!s) return json(res, { seasons: [], info: {}, episodes: {} });
      const episodes: Record<string, unknown[]> = {};
      for (let se = 1; se <= s.seasons; se++) {
        episodes[String(se)] = Array.from({ length: s.eps }, (_, e) => ({
          id: String(s.id * 100 + se * 10 + e + 1), episode_num: e + 1, title: `${s.name} - S${pad(se)}E${pad(e + 1)} - Chapter ${e + 1}`,
          container_extension: 'mp4', info: { duration_secs: 45, duration: '00:00:45', plot: `Episode ${e + 1} of season ${se}.`, movie_image: `${base(req)}/backdrop/${s.id + se + e}.svg`, rating: '8.1' },
          season: se, added: String(Math.floor(now / 1000) - e * 3600),
        }));
      }
      return json(res, {
        seasons: Array.from({ length: s.seasons }, (_, i) => ({ season_number: i + 1, name: `Season ${i + 1}`, episode_count: s.eps, cover: `${base(req)}/poster/${s.id}.svg` })),
        info: { name: s.name, cover: `${base(req)}/poster/${s.id}.svg`, plot: `${s.name} follows a group of characters through ${s.seasons} season(s) of mock drama.`, cast: 'Alex Doe, Sam Roe',
          director: 'J. Smith', genre: SERIES_CATS[s.cat - 1], releaseDate: '2021-05-01', rating: '7.8', backdrop_path: [`${base(req)}/backdrop/${s.id}.svg`], youtube_trailer: '', category_id: String(s.cat + 200) },
        episodes,
      });
    }
    case 'get_short_epg':
    case 'get_simple_data_table': {
      const ch = live.find((c) => String(c.id) === q.get('stream_id'));
      if (!ch) return json(res, { epg_listings: [] });
      const full = action === 'get_simple_data_table';
      let list = epgFor(ch, full ? now - 3 * 86400_000 : now - 3600_000, now + (full ? 2 : 1) * 86400_000);
      if (!full) list = list.filter((p) => p.end > now).slice(0, Number(q.get('limit') ?? 4));
      return json(res, {
        epg_listings: list.map((p, i) => ({
          id: String(ch.id * 10000 + i), epg_id: ch.epgId, title: b64(p.title), lang: 'en', start: fmtLocal(p.start), end: fmtLocal(p.end),
          description: b64(p.desc), channel_id: ch.epgId, start_timestamp: String(p.start / 1000), stop_timestamp: String(p.end / 1000),
          ...(full ? { now_playing: p.start <= now && p.end > now ? 1 : 0, has_archive: ch.archive && p.end < now ? 1 : 0 } : {}),
        })),
      });
    }
    default:
      return json(res, []);
  }
}

function m3u(req: IncomingMessage, res: ServerResponse) {
  const b = base(req);
  const lines = [`#EXTM3U url-tvg="${b}/xmltv.php?username=${USER}&password=${PASS}"`];
  for (const c of live) {
    lines.push(`#EXTINF:-1 tvg-id="${c.epgId}" tvg-name="${c.name}" tvg-logo="${b}/logo/${c.id}.svg" group-title="${LIVE_CATS[c.cat - 1]}"${c.archive ? ' catchup="xc" catchup-days="3"' : ''},${c.name}`);
    lines.push(`${b}/live/${USER}/${PASS}/${c.id}.m3u8`);
  }
  for (const m of movies) {
    lines.push(`#EXTINF:-1 tvg-name="${m.name}" tvg-logo="${b}/poster/${m.id}.svg" group-title="${VOD_CATS[m.cat - 1]}",${m.name}`);
    lines.push(`${b}/movie/${USER}/${PASS}/${m.id}.${m.ext}`);
  }
  for (const s of series) {
    for (let se = 1; se <= s.seasons; se++) {
      for (let e = 1; e <= s.eps; e++) {
        const n = `${s.name} S${pad(se)} E${pad(e)}`;
        lines.push(`#EXTINF:-1 tvg-name="${n}" tvg-logo="${b}/poster/${s.id}.svg" group-title="${SERIES_CATS[s.cat - 1]}",${n}`);
        lines.push(`${b}/series/${USER}/${PASS}/${s.id * 100 + se * 10 + e}.mp4`);
      }
    }
  }
  res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
  res.end(lines.join('\n'));
}

function xmltv(_req: IncomingMessage, res: ServerResponse) {
  const now = Date.now();
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="chillyptv-mock">'];
  for (const c of live) out.push(`<channel id="${c.epgId}"><display-name>${escXml(c.name)}</display-name></channel>`);
  for (const c of live) {
    for (const p of epgFor(c, now - 3 * 86400_000, now + 2 * 86400_000)) {
      out.push(`<programme start="${xmltvDate(p.start)}" stop="${xmltvDate(p.end)}" channel="${c.epgId}"><title lang="en">${escXml(p.title)}</title><desc lang="en">${escXml(p.desc)}</desc><category>Mock</category></programme>`);
    }
  }
  out.push('</tv>');
  res.writeHead(200, { 'Content-Type': 'application/xml' });
  res.end(out.join('\n'));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', base(req));
  const p = url.pathname;
  res.setHeader('Server', 'mock-xtream');
  if (p === '/player_api.php') return handleApi(req, res, url.searchParams);
  if (p === '/get.php') return m3u(req, res);
  if (p === '/xmltv.php') return xmltv(req, res);
  let m = p.match(/^\/logo\/(\d+)\.svg$/);
  if (m) return svg(res, live.find((c) => String(c.id) === m![1])?.name ?? 'TV', (+m[1] * 47) % 360, 200, 200);
  m = p.match(/^\/(poster|backdrop)\/(\d+)\.svg$/);
  if (m) {
    const id = +m[2];
    const name = movies.find((x) => x.id === id)?.name ?? series.find((x) => x.id === id)?.name ?? 'Show';
    return m[1] === 'poster' ? svg(res, name, (id * 29) % 360, 300, 450) : svg(res, name, (id * 29) % 360, 1280, 720);
  }
  m = p.match(/^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(m3u8|ts)$/);
  if (m) {
    if (m[1] !== USER || m[2] !== PASS) return res.writeHead(403).end();
    const ch = live.find((c) => String(c.id) === m![3]);
    if (!ch) return res.writeHead(404).end();
    if (m[4] === 'ts') return liveStreamTs(res, ch.src, { realtime: true });
    // Redirect like many real panels do, so the proxy's redirect handling is exercised.
    res.writeHead(302, { Location: `/hls/${ch.src}/index.m3u8?token=${ch.id}` });
    return res.end();
  }
  m = p.match(/^\/hls\/([abc])\/(index\.m3u8|seg_\d+\.ts)$/);
  if (m) return serveFile(req, res, join(MEDIA, `hls-${m[1]}`, m[2]), m[2].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
  m = p.match(/^\/movie\/[^/]+\/[^/]+\/(\d+)\.(\w+)$/);
  if (m) return m[2] === 'mkv' ? serveFile(req, res, join(MEDIA, 'movie-ac3.mkv'), 'video/x-matroska') : serveFile(req, res, join(MEDIA, 'movie.mp4'), 'video/mp4');
  m = p.match(/^\/series\/[^/]+\/[^/]+\/(\d+)\.(\w+)$/);
  if (m) return serveFile(req, res, join(MEDIA, 'episode.mp4'), 'video/mp4');
  // Xtream timeshift: /timeshift/{user}/{pass}/{duration}/{YYYY-MM-DD:HH-MM}/{id}.ts
  m = p.match(/^\/timeshift\/[^/]+\/[^/]+\/(\d+)\/[^/]+\/(\d+)\.(ts|m3u8)$/);
  if (m) {
    const ch = live.find((c) => String(c.id) === m![2]);
    if (!ch) return res.writeHead(404).end();
    return liveStreamTs(res, ch.src, { realtime: false, seconds: Math.min(+m[1] * 60, 300) });
  }
  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`ChillyPTV mock provider\n\nXtream: server ${base(req)}  user ${USER}  pass ${PASS}\nM3U:    ${base(req)}/get.php?username=${USER}&password=${PASS}&type=m3u_plus&output=m3u8\nEPG:    ${base(req)}/xmltv.php?username=${USER}&password=${PASS}\n`);
  }
  res.writeHead(404).end();
});

ensureMedia();
startLiveEncoders();
server.listen(PORT, () => {
  console.log(`[mock] Xtream mock provider on http://localhost:${PORT} (demo/demo), ${live.length} channels, ${movies.length} movies, ${series.length} series`);
});
