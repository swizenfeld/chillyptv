/**
 * ChillyPTV provider diagnostic.
 *
 *   npm run diagnose -- --server http://host:port --user NAME --pass SECRET
 *   npm run diagnose -- --m3u "https://host/get.php?..."        (M3U playlists)
 *   npm run diagnose                                              (asks for the details)
 *
 * Logs in the way the app does and writes a report (chillyptv-diagnose.md) about the
 * playlist, the TV guide, channel naming, today's football and timings. The report never
 * contains the username, password, server address or any stream URL.
 *
 * Options: --movies N / --episodes N (files checked for audio and subtitle tracks; --no-media skips)
 *          --epg URL (extra XMLTV source)  --ua "User-Agent"  --languages es,en  --no-stream (skip the
 * one-channel stream check)  --out FILE  --leagues eng.1,esp.1,...
 */
import { writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { XmltvParser, type EpgData } from '../shared/xmltv';
import { parseM3u } from '../shared/m3u';
import { parseChannelTags, feedRank, compareRank, eventLabel, QUALITY_LABEL, type ChannelTags } from '../shared/channels';
import {
  DEFAULT_LEAGUES, LEAGUE_BY_ID, broadcasterScore, channelNameScore, competitionHint, detectGuideFixture, fixtureKey, parseEspnScoreboard, prepareFixture,
  scorePrepared, type Fixture,
} from '../shared/sports';
import { normalize } from '../src/lib/search';
import { trimGuide } from '../shared/guide';
import { eventListing } from '../shared/events';
import { ffmpegInfoArgs, ffprobeArgs, languageName, parseFfmpegInfo, parseProbe, type MediaProbe } from '../shared/media';

// ------------------------------------------------------------------ options
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : process.env[`CHILLY_DIAG_${name.toUpperCase()}`];
};
const flag = (name: string) => argv.includes(`--${name}`);

const UA = opt('ua') ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ESPN = process.env.CHILLY_FIXTURES_BASE ?? 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const OUT = opt('out') ?? 'chillyptv-diagnose.md';

interface Ch {
  id: string;
  name: string;
  category: string;
  epgId?: string;
  archive: boolean;
  tags: ChannelTags;
}

// ------------------------------------------------------------------ redaction
const secrets: string[] = [];
function redact(s: string): string {
  let out = s;
  for (const x of secrets) if (x && x.length >= 3) out = out.split(x).join('•••').split(encodeURIComponent(x)).join('•••');
  return out.replace(/https?:\/\/[^\s)'"]+/g, (u) => (u.includes('espn.com') ? u : '[link]'));
}

// ------------------------------------------------------------------ report
const lines: string[] = [];
const out = (s = '') => {
  lines.push(redact(s));
  process.stdout.write(`${redact(s)}\n`);
};
const timings: [string, number][] = [];
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timings.push([label, Math.round(performance.now() - t0)]);
  }
}
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const table = (head: string[], rows: (string | number)[][]) => {
  out(`| ${head.join(' | ')} |`);
  out(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) out(`| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
  out();
};
function top<T>(items: T[], key: (x: T) => string | undefined, n = 12): [string, number][] {
  const m = new Map<string, number>();
  for (const x of items) {
    const k = key(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function getText(url: string, timeoutMs = 60_000): Promise<{ text: string; bytes: number; status: number; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const buf = new Uint8Array(await res.arrayBuffer());
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : buf;
  return { text: new TextDecoder().decode(raw), bytes: buf.length, status: res.status, ms: Math.round(performance.now() - t0) };
}

function why(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
  const c = err?.cause;
  const code = c?.code ?? c?.errors?.find((x) => x.code)?.code;
  const hints: Record<string, string> = {
    ECONNREFUSED: 'connection refused — wrong port, or the server is down',
    ENOTFOUND: 'server name not found — check the address',
    ECONNRESET: 'connection reset by the server',
    ETIMEDOUT: 'timed out',
    UND_ERR_CONNECT_TIMEOUT: 'timed out connecting',
  };
  if (code) return hints[code] ? `${hints[code]} (${code})` : code;
  if (err?.name === 'TimeoutError') return 'timed out';
  return c?.message ? `${err.message}: ${c.message}` : (err?.message ?? String(e));
}

// ------------------------------------------------------------------ main
async function main() {
  let server = opt('server');
  let user = opt('user');
  let pass = opt('pass');
  const m3u = opt('m3u');
  if (!m3u && (!server || !user || !pass)) {
    if (!stdin.isTTY) throw new Error('Pass --server, --user and --pass (or --m3u).');
    const rl = createInterface({ input: stdin, output: stdout });
    server ||= await rl.question('Server URL (e.g. http://host:8080): ');
    user ||= await rl.question('Username: ');
    pass ||= await rl.question('Password: ');
    rl.close();
  }
  let base = '';
  if (server) {
    base = server.trim().replace(/\/+$/, '').replace(/\/(player_api|get|xmltv)\.php.*$/i, '');
    if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
    secrets.push(new URL(base).host, new URL(base).hostname);
  }
  if (m3u) secrets.push(new URL(m3u).host, new URL(m3u).hostname);
  secrets.push(user ?? '', pass ?? '');

  out('# ChillyPTV provider diagnostic');
  out();
  out(`Generated ${new Date().toISOString()} · Node ${process.version} · ${process.platform}`);
  out('Username, password, server address and stream links are removed from this report.');
  out();

  // ---------------------------------------------------------------- playlist
  let channels: Ch[] = [];
  let vodCount = 0;
  let seriesCount = 0;
  let vodItems: Record<string, unknown>[] = [];
  let seriesItems: Record<string, unknown>[] = [];
  let vodCatName = new Map<string, string>();
  let api: ((q?: Record<string, string>) => string) | null = null;
  let busy = false;
  let epgUrls: string[] = [];
  let timezone: string | undefined;

  if (!m3u) {
    const xapi = (q: Record<string, string> = {}) => `${base}/player_api.php?${new URLSearchParams({ username: user!, password: pass!, ...q })}`;
    api = xapi;
    out('## Account');
    const acct = await timed('Login (player_api)', () => getText(xapi(), 20_000)).catch((e) => {
      throw new Error(`Login request failed: ${why(e)}`);
    });
    let info: { user_info?: Record<string, unknown>; server_info?: Record<string, unknown> };
    try {
      info = JSON.parse(acct.text);
    } catch {
      throw new Error(`Login answered HTTP ${acct.status} but not with JSON — is this an Xtream Codes server?`);
    }
    const ui = info.user_info ?? {};
    if (String(ui.auth) !== '1') throw new Error('Login failed: the provider rejected the username or password.');
    timezone = info.server_info?.timezone as string | undefined;
    const exp = Number(ui.exp_date) * 1000;
    table(['Item', 'Value'], [
      ['Status', String(ui.status ?? '?')],
      ['Expires', exp ? `${new Date(exp).toISOString().slice(0, 10)} (${Math.ceil((exp - Date.now()) / 86_400_000)} days)` : 'never'],
      ['Connections', `${ui.active_cons ?? '?'} active of ${ui.max_connections ?? '?'}`],
      ['Trial', String(ui.is_trial) === '1' ? 'yes' : 'no'],
      ['Output formats', Array.isArray(ui.allowed_output_formats) ? (ui.allowed_output_formats as string[]).join(', ') : '?'],
      ['Server timezone', timezone ?? '?'],
      ['Login time', `${acct.ms} ms`],
    ]);
    busy = Number(ui.active_cons) > 0 && Number(ui.active_cons) >= Number(ui.max_connections);
    if (busy) {
      out(`> **Something was playing on this account during the check** (${ui.active_cons} of ${ui.max_connections} connections in use). Downloads and the movie checks below wait for or are refused by the provider, so their times are not representative. Stop playback on every device and run it again.`);
      out();
    }

    const get = async (action: string) => {
      const r = await timed(action, () => getText(xapi({ action }), 120_000));
      try {
        return { list: JSON.parse(r.text) as Record<string, unknown>[], bytes: r.bytes, ms: r.ms };
      } catch {
        return { list: [] as Record<string, unknown>[], bytes: r.bytes, ms: r.ms };
      }
    };
    const [cats, live, vod, series] = await Promise.all([get('get_live_categories'), get('get_live_streams'), get('get_vod_streams'), get('get_series')]);
    const catName = new Map((Array.isArray(cats.list) ? cats.list : []).map((c) => [String(c.category_id), String(c.category_name ?? '')]));
    channels = (Array.isArray(live.list) ? live.list : []).map((s) => {
      const category = catName.get(String(s.category_id)) ?? '';
      const name = String(s.name ?? '').trim();
      return { id: String(s.stream_id), name, category, epgId: (s.epg_channel_id as string) || undefined, archive: String(s.tv_archive) === '1', tags: parseChannelTags(name, category) };
    });
    vodCount = Array.isArray(vod.list) ? vod.list.length : 0;
    seriesCount = Array.isArray(series.list) ? series.list.length : 0;
    vodItems = Array.isArray(vod.list) ? vod.list : [];
    seriesItems = Array.isArray(series.list) ? series.list : [];
    epgUrls = [`${base}/xmltv.php?${new URLSearchParams({ username: user!, password: pass! })}`];
    out('## Playlist');
    table(['', 'Count', 'Download', 'Time'], [
      ['Live categories', catName.size, mb(cats.bytes), `${cats.ms} ms`],
      ['Live channels', channels.length, mb(live.bytes), `${live.ms} ms`],
      ['Movies', vodCount, mb(vod.bytes), `${vod.ms} ms`],
      ['Series', seriesCount, mb(series.bytes), `${series.ms} ms`],
    ]);
  } else {
    const r = await timed('Playlist (M3U)', () => getText(m3u, 180_000));
    const pl = parseM3u(r.text);
    channels = pl.entries.filter((e) => e.kind === 'live').map((e, i) => ({ id: String(i), name: e.name, category: e.group, epgId: e.tvgId, archive: !!e.catchup, tags: parseChannelTags(e.name, e.group) }));
    vodCount = pl.entries.filter((e) => e.kind === 'movie').length;
    seriesCount = pl.entries.filter((e) => e.kind === 'series').length;
    epgUrls = pl.epgUrls;
    out('## Playlist (M3U)');
    table(['', 'Value'], [
      ['Download', `${mb(r.bytes)} in ${r.ms} ms`],
      ['Live channels', channels.length],
      ['Movie entries', vodCount],
      ['Series episodes', seriesCount],
      ['Guide links in header', epgUrls.length],
    ]);
  }
  if (opt('epg')) epgUrls.push(opt('epg')!);

  // ---------------------------------------------------------------- channel naming
  const n = channels.length;
  out('## Channel names');
  out('How well names carry region, quality and language decides how well "best feed" ranking and filters work.');
  out();
  table(['Signal', 'Channels', 'Share'], [
    ['Region prefix (LAT|, UK:, AR -…)', channels.filter((c) => c.tags.region).length, pct(channels.filter((c) => c.tags.region).length, n)],
    ['Quality tag (4K/FHD/HD/SD)', channels.filter((c) => c.tags.quality !== 'unknown').length, pct(channels.filter((c) => c.tags.quality !== 'unknown').length, n)],
    ['Language known', channels.filter((c) => c.tags.lang).length, pct(channels.filter((c) => c.tags.lang).length, n)],
    ['Raw / backup variant', channels.filter((c) => c.tags.variant).length, pct(channels.filter((c) => c.tags.variant).length, n)],
    ['Has guide id (epg_channel_id / tvg-id)', channels.filter((c) => c.epgId).length, pct(channels.filter((c) => c.epgId).length, n)],
    ['Catch-up', channels.filter((c) => c.archive).length, pct(channels.filter((c) => c.archive).length, n)],
    ['Event channels (live / ended / empty)', `${channels.filter((c) => c.tags.event === 'live').length} / ${channels.filter((c) => c.tags.event === 'ended').length} / ${channels.filter((c) => c.tags.event === 'idle').length}`, pct(channels.filter((c) => c.tags.event).length, n)],
  ]);
  table(['Region prefix', 'Channels'], top(channels, (c) => c.tags.region, 15));
  table(['Quality', 'Channels'], top(channels, (c) => QUALITY_LABEL[c.tags.quality] || 'none'));
  table(['Language', 'Channels'], top(channels, (c) => c.tags.lang ?? 'unknown'));
  const byBase = new Map<string, Ch[]>();
  for (const c of channels) if (c.tags.base) (byBase.get(c.tags.base) ?? byBase.set(c.tags.base, []).get(c.tags.base)!).push(c);
  const dupGroups = [...byBase.values()].filter((g) => g.length > 1);
  out(`**Duplicate feeds:** ${dupGroups.length.toLocaleString()} channel names appear more than once (${dupGroups.reduce((a, g) => a + g.length, 0).toLocaleString()} channels). Merging them would leave ${byBase.size.toLocaleString()} distinct channels.`);
  out();
  out('Largest duplicate groups:');
  out();
  for (const g of dupGroups.sort((a, b) => b.length - a.length).slice(0, 8)) out(`- ${g.length}× ${g.slice(0, 6).map((c) => `\`${c.name}\``).join(', ')}${g.length > 6 ? ', …' : ''}`);
  out();
  out('Largest categories:');
  out();
  table(['Category', 'Channels'], top(channels, (c) => c.category, 20));
  const sportsCats = [...new Set(channels.filter((c) => /sport|deport|futbol|fútbol|football|soccer|ppv|liga|espn|tyc|dazn|bein|fanatiz/i.test(`${c.category} ${c.name}`)).map((c) => c.category))];
  out(`Sports-looking categories (${sportsCats.length}): ${sportsCats.slice(0, 30).join(' · ')}`);
  out();
  out('Sample sports channel names:');
  out();
  const sample = channels.filter((c) => sportsCats.includes(c.category));
  for (const c of sample.filter((_, i) => i % Math.max(1, Math.floor(sample.length / 30)) === 0).slice(0, 30)) {
    out(`- \`${c.name}\` → ${[c.tags.region, QUALITY_LABEL[c.tags.quality], c.tags.lang, c.tags.variant].filter(Boolean).join(' · ') || 'no tags'}`);
  }
  out();

  // ---------------------------------------------------------------- guide
  out('## TV guide');
  const now = Date.now();
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  let epg: EpgData = { channels: {}, programmes: {}, fetchedAt: now };
  for (const [i, url] of epgUrls.entries()) {
    try {
      const r = await timed(i === 0 ? 'Guide download (provider)' : `Guide download (extra ${i})`, () => getText(url, 300_000));
      const t0 = performance.now();
      const p = new XmltvParser({ from: now - 3 * 86_400_000, to: now + 3 * 86_400_000 });
      p.push(r.text);
      const d = p.finish();
      timings.push([`Guide parse (${i === 0 ? 'provider' : `extra ${i}`})`, Math.round(performance.now() - t0)]);
      const jsonBytes = Buffer.byteLength(JSON.stringify(d));
      out(`- ${i === 0 ? 'Provider guide' : `Extra source ${i}`}: HTTP ${r.status}, ${mb(r.bytes)} downloaded, ${Object.keys(d.channels).length.toLocaleString()} guide channels, ${Object.values(d.programmes).reduce((a, l) => a + l.length, 0).toLocaleString()} listings (±3 days) → ${mb(jsonBytes)} as app JSON`);
      const programmes = { ...d.programmes, ...epg.programmes };
      for (const [k, l] of Object.entries(d.programmes)) if (!epg.programmes[k]?.length) programmes[k] = l;
      epg = { channels: { ...d.channels, ...epg.channels }, programmes, fetchedAt: now };
    } catch (e) {
      out(`- ${i === 0 ? 'Provider guide' : `Extra source ${i}`}: failed (${why(e)})`);
    }
  }
  out();
  // Same resolution as the app: guide id, exact name, then cleaned base name.
  const size = (id: string) => epg.programmes[id]?.length ?? 0;
  const rById = new Map<string, string>();
  const rByName = new Map<string, string>();
  const rByBase = new Map<string, string>();
  const put = (m: Map<string, string>, k: string, id: string) => {
    const prev = m.get(k);
    if (k && (!prev || size(id) > size(prev))) m.set(k, id);
  };
  for (const id of Object.keys(epg.programmes)) rById.set(id.toLowerCase(), id);
  for (const gc of Object.values(epg.channels)) {
    rById.set(gc.id.toLowerCase(), gc.id);
    put(rByName, normalize(gc.name), gc.id);
    const b = parseChannelTags(gc.name).base;
    if (b.length >= 3) put(rByBase, b, gc.id);
  }
  const how = new Map<string, number>();
  const keyOf = new Map<string, string>();
  for (const c of channels) {
    let k = c.epgId ? rById.get(c.epgId.toLowerCase()) : undefined;
    let via = 'guide id';
    if (!k) [k, via] = [rByName.get(normalize(c.name)), 'exact name'];
    if (!k && c.tags.base.length >= 3) [k, via] = [rByBase.get(c.tags.base), 'cleaned name'];
    if (k && size(k)) {
      keyOf.set(c.id, k);
      how.set(via, (how.get(via) ?? 0) + 1);
    }
  }
  out(`**Coverage:** ${keyOf.size.toLocaleString()} of ${n.toLocaleString()} channels have listings (${pct(keyOf.size, n)}).`);
  out();
  table(['Matched by', 'Channels'], [...how.entries()]);
  const uncovered = channels.filter((c) => !keyOf.has(c.id));
  table(['Category without guide', 'Channels'], top(uncovered, (c) => c.category, 15));
  // What the app now downloads: listings only for guide channels the playlist links to.
  {
    const t0 = performance.now();
    const trimmed = trimGuide(epg, channels.map((c) => [c.epgId ?? '', c.name]));
    const ms = Math.round(performance.now() - t0);
    const full = Buffer.byteLength(JSON.stringify(epg));
    const slim = Buffer.byteLength(JSON.stringify(trimmed));
    out(`**Trimmed guide (what the app loads):** ${mb(slim)} instead of ${mb(full)} (${pct(slim, full)}), listings for ${Object.keys(trimmed.programmes).length.toLocaleString()} of ${Object.keys(epg.programmes).length.toLocaleString()} guide channels; trimming took ${ms} ms.`);
    out();
  }
  // Event channels without a guide get a listing from their own name.
  {
    const fromName = uncovered.map((c) => ({ c, e: eventListing(c.name) })).filter((x) => x.e);
    out(`**Listings from event channel names:** ${fromName.length.toLocaleString()} channels without a guide get one (coverage ${pct(keyOf.size, n)} → ${pct(keyOf.size + fromName.length, n)}).`);
    out();
    const fmt = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ');
    for (const { c, e } of fromName.filter((_, i) => i % Math.max(1, Math.floor(fromName.length / 15)) === 0).slice(0, 15)) out(`- ${fmt(e!.start)} UTC · ${e!.title} ← \`${c.name}\``);
    // Finished slots without a time ("End | … | 00:00 (GMT)") need no listing; anything else here is a miss.
    const timeLike = /\b\d{1,2}:\d{2}\b|\d{4}-\d{2}-\d{2}|^\W*(next|live|upcoming|soon)\W/i;
    const skipped = uncovered.filter((c) => !c.tags.event && /\|/.test(c.name) && /\s(vs?\.?|x|-)\s/i.test(c.name) && timeLike.test(c.name) && !eventListing(c.name));
    const endedNoTime = uncovered.filter((c) => c.tags.event === 'ended' && !eventListing(c.name)).length;
    if (endedNoTime) out(`(${endedNoTime.toLocaleString()} finished event slots carry no time and get no listing; that's expected.)`);
    if (skipped.length) {
      out();
      out(`Event-looking names that produced no listing (${skipped.length}), samples:`);
      for (const c of skipped.filter((_, i) => i % Math.max(1, Math.floor(skipped.length / 15)) === 0).slice(0, 15)) out(`- \`${c.name}\``);
    }
    out();
  }

  // ---------------------------------------------------------------- football today
  out("## Today's football");
  const leagues = (opt('leagues') ?? DEFAULT_LEAGUES.join(',')).split(',').filter((id) => LEAGUE_BY_ID.has(id));
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const days = [...new Set([ymd(day0.getTime() - 6 * 3_600_000), ymd(day0.getTime() + 12 * 3_600_000), ymd(day0.getTime() + 30 * 3_600_000)])];
  const fixtures = new Map<string, Fixture>();
  const leagueErrors: string[] = [];
  await timed('Fixtures (ESPN)', async () => {
    for (const id of leagues) {
      const results = await Promise.allSettled(
        days.map(async (d) => {
          for (let attempt = 0; ; attempt++) {
            try {
              const res = await fetch(`${ESPN}/${id}/scoreboard?dates=${d}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return parseEspnScoreboard(await res.json(), id);
            } catch (e) {
              if (attempt >= 1) throw e;
            }
          }
        }),
      );
      const ok = results.filter((r): r is PromiseFulfilledResult<Fixture[]> => r.status === 'fulfilled');
      if (!ok.length) leagueErrors.push(`${id} (${why((results[0] as PromiseRejectedResult).reason)})`);
      for (const r of ok) for (const f of r.value) if (f.start >= day0.getTime() && f.start < day0.getTime() + 86_400_000) fixtures.set(f.id, f);
    }
  });
  out(`ESPN: ${fixtures.size} matches today in ${leagues.length} competitions.${leagueErrors.length ? ` Failed: ${leagueErrors.join(', ')}.` : ' All competitions answered.'}`);
  out();

  // Guide entries for today, normalised once.
  const t0 = performance.now();
  const todays: { c: Ch; start: number; end: number; title: string; text: string; ntitle: string }[] = [];
  for (const c of channels) {
    const k = keyOf.get(c.id);
    if (!k) continue;
    for (const p of epg.programmes[k] ?? []) {
      if (p[1] <= day0.getTime() || p[0] >= day0.getTime() + 86_400_000) continue;
      todays.push({ c, start: p[0], end: p[1], title: p[2], text: normalize(`${p[2]} ${p[4] ?? ''} ${p[3] ?? ''}`), ntitle: normalize(p[2]) });
    }
  }
  const names = channels.map((c) => ({ c, name: normalize(c.name) }));
  const prefs = { languages: (opt('languages') ?? 'es,en').split(','), maxQuality: 'uhd' as const };
  const rows: (string | number)[][] = [];
  let found = 0;
  for (const f of [...fixtures.values()].sort((a, b) => a.start - b.start)) {
    const pf = prepareFixture(f);
    const best = new Map<string, { c: Ch; score: number }>();
    const offer = (c: Ch, score: number) => {
      if (c.tags.event === 'idle') return;
      if ((best.get(c.id)?.score ?? 0) < score) best.set(c.id, { c, score });
    };
    for (const t of todays) {
      const s = scorePrepared(t.text, t.start, t.end, pf, t.ntitle);
      if (s) offer(t.c, s);
    }
    for (const { c, name } of names) if (channelNameScore(name, pf)) offer(c, 1);
    for (const c of channels) if (!best.has(c.id) && broadcasterScore(c.name, f)) offer(c, 0.35);
    // Same order as the app: ended event channels last, then confidence, language and quality,
    // then one feed per source first (category + language) so a network's local stations don't fill the top.
    const sorted = [...best.values()].sort(
      (a, b) => (a.c.tags.event === 'ended' ? 1 : 0) - (b.c.tags.event === 'ended' ? 1 : 0) || (b.score >= 1 ? 1 : 0) - (a.score >= 1 ? 1 : 0) || compareRank(feedRank(a.c.tags, prefs), feedRank(b.c.tags, prefs)),
    );
    const seenSrc = new Set<string>();
    const lead = sorted.filter((x) => {
      const k = `${x.c.category}|${x.c.tags.lang ?? ''}|${x.c.tags.event === 'ended'}`;
      const first = !seenSrc.has(k);
      seenSrc.add(k);
      return first;
    });
    const ranked = [...lead, ...sorted.filter((x) => !lead.includes(x))];
    const ended = ranked.filter((x) => x.c.tags.event === 'ended').length;
    const sure = ranked.filter((x) => x.score >= 0.6).length;
    if (sure) found++;
    rows.push([
      new Date(f.start).toTimeString().slice(0, 5),
      f.leagueName,
      `${f.home.name} v ${f.away.name}`,
      `${sure} confirmed, ${ranked.length - sure} maybe${ended ? `, ${ended} ended` : ''}`,
      ranked.slice(0, 3).map((x) => `${eventLabel(x.c.name) ?? x.c.name}${x.c.tags.lang ? ` [${x.c.tags.lang}]` : ''}`).join(' · ') || `— (TV: ${f.broadcasts.join(', ') || '?'})`,
    ]);
  }
  timings.push(['Match ↔ channel matching', Math.round(performance.now() - t0)]);
  if (rows.length) table([`Kick-off (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, 'Competition', 'Match', 'Channels', 'Best feeds'], rows);
  out(`Matches with at least one confirmed channel: **${found} of ${fixtures.size}**.`);
  out();
  const hint = competitionHint(leagues);
  const guideOnly = new Map<string, string>();
  for (const t of todays) {
    if (!hint.test(t.title)) continue;
    const f = detectGuideFixture({ start: t.start, end: t.end, title: t.title }, leagues);
    if (f) guideOnly.set(fixtureKey(f), t.title);
  }
  out(`Guide-only detection (used when ESPN is unreachable): ${guideOnly.size} matches recognised from programme titles.`);
  for (const title of [...guideOnly.values()].slice(0, 10)) out(`- \`${title}\``);
  const sportsTitles = todays.filter((t) => /\b(vs?\.?|x)\b/i.test(t.title) && /futbol|fútbol|liga|copa|league|cup|premier|champions/i.test(t.title)).map((t) => t.title);
  out();
  out(`Sample football-looking guide titles (${sportsTitles.length} today):`);
  for (const t of [...new Set(sportsTitles)].slice(0, 15)) out(`- \`${t}\``);
  out();

  // ---------------------------------------------------------------- movies & episodes: tracks
  if (!flag('no-media') && !m3u && api && (vodItems.length || seriesItems.length)) {
    out('## Movies and episodes: languages and subtitles');
    const ffprobe = process.env.CHILLY_FFPROBE ?? 'ffprobe';
    const hasFfprobe = spawnSync(ffprobe, ['-version'], { stdio: 'ignore' }).status === 0;
    // ffmpeg-only installs (no ffprobe): ffmpeg's own stream listing carries the same track details.
    const ffmpegBin = process.env.CHILLY_FFMPEG ?? 'ffmpeg';
    const hasFfmpeg = !hasFfprobe && spawnSync(ffmpegBin, ['-version'], { stdio: 'ignore' }).status === 0;
    const hasProbe = hasFfprobe || hasFfmpeg;
    const wantMovies = Number(opt('movies') ?? 24);
    const wantEpisodes = Number(opt('episodes') ?? 8);
    // Spread the sample across categories (newest first in each), like browsing would.
    const spread = <T,>(items: T[], cat: (x: T) => string, added: (x: T) => number, n: number): T[] => {
      const by = new Map<string, T[]>();
      for (const x of [...items].sort((a, b) => added(b) - added(a))) (by.get(cat(x)) ?? by.set(cat(x), []).get(cat(x))!).push(x);
      const lists = [...by.values()];
      const outList: T[] = [];
      for (let round = 0; outList.length < n && lists.some((l) => l.length > round); round++) for (const l of lists) if (l[round] && outList.length < n) outList.push(l[round]);
      return outList;
    };
    const catsRes = await getText(api({ action: 'get_vod_categories' }), 30_000).catch(() => null);
    try {
      vodCatName = new Map((JSON.parse(catsRes?.text ?? '[]') as Record<string, unknown>[]).map((c) => [String(c.category_id), String(c.category_name ?? '')]));
    } catch {
      /* ignore */
    }
    type Item = { kind: 'movie' | 'episode'; title: string; category: string; url: string; info?: Record<string, unknown> };
    const items: Item[] = spread(vodItems, (m) => String(m.category_id), (m) => Number(m.added) || 0, wantMovies).map((m) => ({
      kind: 'movie',
      title: String(m.name ?? ''),
      category: vodCatName.get(String(m.category_id)) ?? '',
      url: `${base}/movie/${encodeURIComponent(user!)}/${encodeURIComponent(pass!)}/${m.stream_id}.${m.container_extension || 'mp4'}`,
      info: m,
    }));
    for (const s of spread(seriesItems, (x) => String(x.category_id), (x) => Number(x.last_modified) || 0, wantEpisodes)) {
      try {
        const r = await getText(api({ action: 'get_series_info', series_id: String(s.series_id) }), 30_000);
        const eps = (JSON.parse(r.text) as { episodes?: Record<string, Record<string, unknown>[]> }).episodes ?? {};
        const first = Object.values(eps).flat()[0];
        if (first) items.push({ kind: 'episode', title: `${s.name} · ${first.title ?? ''}`, category: '', url: `${base}/series/${encodeURIComponent(user!)}/${encodeURIComponent(pass!)}/${first.id}.${first.container_extension || 'mp4'}` });
      } catch {
        /* skip */
      }
    }
    const probeOne = (url: string) =>
      new Promise<MediaProbe | string>((resolve) => {
        const protocols = 'http,https,tcp,tls,crypto,httpproxy';
        const child = hasFfprobe
          ? spawn(ffprobe, ffprobeArgs(url, UA, protocols), { stdio: ['ignore', 'pipe', 'pipe'] })
          : spawn(ffmpegBin, ffmpegInfoArgs(url, UA, protocols), { stdio: ['ignore', 'pipe', 'pipe'] });
        let o = '';
        let err = '';
        child.stdout.on('data', (d: Buffer) => (o += d));
        child.stderr.on('data', (d: Buffer) => (err += d));
        const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
        child.on('error', (e) => resolve(e.message));
        child.on('close', () => {
          clearTimeout(timer);
          try {
            const parsed = hasFfprobe ? parseProbe(JSON.parse(o)) : parseFfmpegInfo(err);
            if (!parsed) throw new Error('no stream info');
            resolve(parsed);
          } catch {
            resolve(err.trim().split('\n').pop() || 'no answer within 30 s');
          }
        });
      });
    // What titles and categories say about languages, across the whole catalogue (cheap, name-based).
    {
      const all = vodItems.map((m) => `${m.name ?? ''} ${vodCatName.get(String(m.category_id)) ?? ''}`);
      const n = (re: RegExp) => all.filter((t) => re.test(t)).length;
      table(['Movie titles / categories that say…', 'Movies', 'Share'], [
        ['MULTI SUB / multiple subtitles', n(/multi[\s-]*subs?/i), pct(n(/multi[\s-]*subs?/i), all.length)],
        ['ENG SUB / English subtitles', n(/\beng?[\s-]*subs?\b|english sub/i), pct(n(/\beng?[\s-]*subs?\b|english sub/i), all.length)],
        ['MULTI AUDIO / DUAL audio', n(/multi[\s-]*audio|\bdual\b/i), pct(n(/multi[\s-]*audio|\bdual\b/i), all.length)],
        ['Latino / Castellano / Spanish', n(/latino|castellano|espa[nñ]ol|spanish|\|lat\||\bes\b/i), pct(n(/latino|castellano|espa[nñ]ol|spanish|\|lat\||\bes\b/i), all.length)],
      ]);
      const subbed = vodItems.filter((m) => /multi[\s-]*subs?|\beng?[\s-]*subs?\b/i.test(`${m.name ?? ''} ${vodCatName.get(String(m.category_id)) ?? ''}`));
      // Make sure some of those are in the sample: they're the files most likely to carry subtitle tracks.
      for (const m of spread(subbed, (x) => String(x.category_id), (x) => Number(x.added) || 0, 6)) {
        if (items.some((i) => i.info?.stream_id === m.stream_id)) continue;
        items.push({ kind: 'movie', title: String(m.name ?? ''), category: vodCatName.get(String(m.category_id)) ?? '', url: `${base}/movie/${encodeURIComponent(user!)}/${encodeURIComponent(pass!)}/${m.stream_id}.${m.container_extension || 'mp4'}`, info: m });
      }
    }
    const results: { it: Item; p: MediaProbe | string }[] = [];
    if (hasProbe) {
      out(`Checked ${items.length} files with ${hasFfprobe ? 'ffprobe' : 'ffmpeg (ffprobe is not installed; ffmpeg lists the same tracks)'}, one at a time (your plan allows one connection, so nothing else should be playing). Each check reads only the start of the file.`);
      const t0 = performance.now();
      await timed(`Track check (${items.length} files)`, async () => {
        for (const it of items) results.push({ it, p: await probeOne(it.url) });
      });
      if (busy) out('(Another stream was using the account during this check, so the times below are inflated.)');
      out(`Average time to read one file's tracks: ${((performance.now() - t0) / Math.max(1, items.length) / 1000).toFixed(1)} s (this is the wait before a movie starts when its page didn't read them first).`);
    } else {
      out('ffprobe is not installed, so only what the provider reports about each movie (usually just the first audio track) is shown. Install ffmpeg (macOS: `brew install ffmpeg`) and run again for the full picture.');
      for (const it of items.filter((x) => x.kind === 'movie')) {
        try {
          const r = await getText(api({ action: 'get_vod_info', vod_id: String(it.info?.stream_id) }), 30_000);
          const info = (JSON.parse(r.text) as { info?: { audio?: { codec_name?: string; channels?: number; tags?: { language?: string } }; video?: { codec_name?: string; width?: number; height?: number } } }).info ?? {};
          results.push({ it, p: { duration: null, container: String(it.info?.container_extension ?? '') || undefined, ...(info.video ? { video: { codec: info.video.codec_name ?? '?', width: info.video.width, height: info.video.height } } : {}), audio: info.audio ? [{ index: 0, codec: info.audio.codec_name ?? '?', channels: info.audio.channels, lang: info.audio.tags?.language }] : [], subtitles: [] } });
        } catch (e) {
          results.push({ it, p: why(e) });
        }
      }
    }
    out();
    const ok = results.filter((r): r is { it: Item; p: MediaProbe } => typeof r.p !== 'string');
    const failed = results.filter((r) => typeof r.p === 'string');
    const count = (f: (p: MediaProbe) => boolean) => ok.filter((r) => f(r.p)).length;
    const langs = (pick: (p: MediaProbe) => (string | undefined)[]) => {
      const m = new Map<string, number>();
      for (const r of ok) for (const l of new Set(pick(r.p))) m.set(languageName(l) ?? 'untagged', (m.get(languageName(l) ?? 'untagged') ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ') || '–';
    };
    const browserAudio = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
    const box = (c?: string) => (!c ? '?' : /mp4|mov/.test(c) ? 'mp4' : /matroska|webm/.test(c) ? 'mkv' : c.split(',')[0]);
    table(['', 'Files', 'Share'], [
      ['Checked', `${ok.length} of ${results.length}`, pct(ok.length, results.length)],
      ['More than one audio track', count((p) => p.audio.length > 1), pct(count((p) => p.audio.length > 1), ok.length)],
      ['Built-in subtitles (any)', count((p) => p.subtitles.length > 0), pct(count((p) => p.subtitles.length > 0), ok.length)],
      ['…text subtitles the app can show', count((p) => p.subtitles.some((x) => x.text)), pct(count((p) => p.subtitles.some((x) => x.text)), ok.length)],
      ['…picture subtitles only (PGS/VobSub)', count((p) => p.subtitles.length > 0 && !p.subtitles.some((x) => x.text)), pct(count((p) => p.subtitles.length > 0 && !p.subtitles.some((x) => x.text)), ok.length)],
      ['Audio browsers can\'t play (AC3/EAC3/DTS…)', count((p) => p.audio.length > 0 && !browserAudio.has(p.audio[0].codec)), pct(count((p) => p.audio.length > 0 && !browserAudio.has(p.audio[0].codec)), ok.length)],
    ]);
    out(`Containers: ${top(ok, (r) => box(r.p.container)).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}`);
    out(`Audio languages: ${langs((p) => p.audio.map((a) => a.lang))}`);
    out(`Subtitle languages: ${langs((p) => p.subtitles.map((x) => x.lang))}`);
    out();
    table(
      ['Title', 'Category', 'File', 'Audio', 'Subtitles'],
      results.map(({ it, p }) =>
        typeof p === 'string'
          ? [it.title.slice(0, 60), it.category, '–', `failed: ${p.slice(0, 80)}`, '']
          : [
              it.title.slice(0, 60),
              it.category,
              `${box(p.container)} ${p.video ? `${p.video.codec} ${p.video.height ?? ''}p` : ''}`.trim(),
              p.audio.map((a) => `${a.lang ?? '?'} ${a.codec}${a.channels ? ` ${a.channels}ch` : ''}`).join(', ') || 'none',
              p.subtitles.map((x) => `${x.lang ?? '?'} ${x.codec}${x.forced ? ' forced' : ''}`).join(', ') || 'none',
            ],
      ),
    );
    if (failed.length) out(`${failed.length} file(s) could not be read; see the table.`);
    out();
  }

  // ---------------------------------------------------------------- one stream
  if (!flag('no-stream') && !m3u && channels.length) {
    out('## Stream check (one channel)');
    const ch = channels.find((c) => sportsCats.includes(c.category)) ?? channels[0];
    for (const ext of ['m3u8', 'ts']) {
      const url = `${base}/live/${encodeURIComponent(user!)}/${encodeURIComponent(pass!)}/${ch.id}.${ext}`;
      const t1 = performance.now();
      try {
        const ctl = new AbortController();
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(15_000)]) });
        const reader = res.body?.getReader();
        const first = reader ? await reader.read() : undefined;
        const firstMs = Math.round(performance.now() - t1);
        ctl.abort();
        const redirected = res.redirected ? `redirected to another ${new URL(res.url).host === new URL(base).host ? 'path' : 'host'}` : 'no redirect';
        out(`- .${ext}: HTTP ${res.status}, ${res.headers.get('content-type') ?? '?'}, first data after ${firstMs} ms, ${redirected}${first?.value ? `, ${first.value.length} bytes` : ''}`);
      } catch (e) {
        out(`- .${ext}: failed (${why(e)})`);
      }
    }
    out(`  (tested on \`${ch.name}\`; each check opened and closed one connection)`);
    out();
  }

  // ---------------------------------------------------------------- timings
  out('## Timings');
  table(['Step', 'Time'], timings.map(([k, ms]) => [k, ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`]));
  out(`Peak memory: ${mb(process.memoryUsage().rss)}`);
  writeFileSync(OUT, `${lines.join('\n')}\n`);
  process.stdout.write(`\nReport saved to ${OUT} — paste it into the chat.\n`);
}

main().catch((e) => {
  out(`\n**Diagnostic stopped:** ${why(e)}`);
  try {
    writeFileSync(OUT, `${lines.join('\n')}\n`);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
