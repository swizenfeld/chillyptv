/**
 * End-to-end smoke test: starts the mock Xtream provider and the ChillyPTV server,
 * then drives the built app in Chromium (Playwright) through every major feature.
 *
 *   npm run build && npm run test:e2e
 *
 * Screenshots are written to test-results/.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCK_PORT = 18788;
const APP_PORT = 18787;
const MOCK = `http://localhost:${MOCK_PORT}`;
const APP = `http://localhost:${APP_PORT}`;
const OUT = join(root, 'test-results');
mkdirSync(OUT, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'chilly-e2e-'));

const procs = [];
function start(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${args[1] ?? cmd}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${args[1] ?? cmd}] ${d}`));
  procs.push(p);
  return p;
}
async function waitFor(url, ms = 120000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
function cleanup() {
  for (const p of procs) p.kill('SIGTERM');
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {}
}
process.on('exit', cleanup);

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  ✗ ${name}: ${e.message.split('\n').slice(0, 4).join(' | ')}`);
    try {
      await page.screenshot({ path: join(OUT, `FAIL-${name.replace(/\W+/g, '_')}.png`) });
    } catch {}
  }
}

const tsx = join(root, 'node_modules', '.bin', 'tsx');
start(tsx, ['mock/server.ts'], { MOCK_PORT: String(MOCK_PORT), MOCK_VOD_DELAY_MS: '4000' });
const serverEntry = process.env.E2E_USE_SOURCE ? [tsx, ['server/index.ts']] : ['node', ['dist-server/server/index.js']];
start(serverEntry[0], serverEntry[1], { PORT: String(APP_PORT), CHILLY_DATA_DIR: dataDir, CHILLY_STATIC_DIR: join(root, 'dist'), CHILLY_FIXTURES_BASE: `${MOCK}/espn` });
await waitFor(`${MOCK}/`);
await waitFor(`${APP}/api/health`);
// Give the mock live encoders a few seconds to produce the first segments.
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const playing = (selector, min = 1.5, timeout = 30000) =>
  page.waitForFunction(
    ([sel, m]) => {
      const v = document.querySelector(sel);
      return !!v && v.currentTime > m && v.readyState >= 2 && !v.paused;
    },
    [selector, min],
    { timeout },
  );

console.log('ChillyPTV e2e');

await step('add Xtream playlist', async () => {
  await page.goto(`${APP}/`);
  await page.waitForURL(/\/profiles/);
  await page.getByPlaceholder('http://provider.example:8080').fill(MOCK);
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill('demo');
  await page.getByLabel('Playlist name').fill('Mock provider');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Add & connect' }).click();
  await page.waitForURL(`${APP}/`);
  await page.getByText('232').first().waitFor();
  // The mock's movie list takes 4 s; channels must not wait for it.
  if (Date.now() - t0 > 3500) throw new Error(`channels took ${Date.now() - t0} ms: Live TV waited for the movie list`);
  await page.getByText(/days left/).waitFor();
});

await step('home dashboard', async () => {
  await page.locator('.hero').waitFor();
  // "New releases" comes from the provider's own "|EN| NEW RELEASED" category once movies arrive.
  const row = page.locator('section.row-section', { has: page.getByRole('heading', { name: 'New releases' }) });
  await row.locator('.poster-card').first().waitFor({ timeout: 30000 });
  const href = await row.locator('.row-link').getAttribute('href');
  const cats = await (await fetch(`${MOCK}/player_api.php?username=demo&password=demo&action=get_vod_categories`)).json();
  const id = cats.find((c) => c.category_name === '|EN| NEW RELEASED').category_id;
  if (!href.includes(`cat=${id}`)) throw new Error(`New releases links to ${href}`);
  const vod = await (await fetch(`${MOCK}/player_api.php?username=demo&password=demo&action=get_vod_streams&category_id=${id}`)).json();
  const first = vod.sort((a, b) => b.added - a.added)[0].name;
  await row.locator('.poster-title').first().getByText(first, { exact: true }).waitFor();
  await page.screenshot({ path: join(OUT, '01-home.png') });
});

await step('live TV preview plays (HLS)', async () => {
  await page.locator('.rail-item', { hasText: 'Live TV' }).click();
  await page.locator('.channel-row').first().waitFor();
  await page.locator('.channel-row').nth(2).click();
  await playing('.player-preview video');
  await page.locator('.channel-row .now-title').first().waitFor({ timeout: 20000 });
  await page.locator('.epg-item.now').first().waitFor();
  await page.screenshot({ path: join(OUT, '02-live.png') });
});

await step('fullscreen player, zapping and banner', async () => {
  await page.locator('.channel-row').nth(2).dblclick();
  await page.waitForURL(/\/play/);
  await playing('.player-full video');
  const t1 = await page.locator('.player-title .t1').textContent();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((t) => document.querySelector('.player-title .t1')?.textContent !== t, t1);
  await playing('.player-full video');
  await page.locator('.live-banner').waitFor();
  await page.screenshot({ path: join(OUT, '03-player-live.png') });
  // Stats overlay + settings menu
  await page.keyboard.press('s');
  await page.locator('.stats-overlay').waitFor();
  await page.mouse.move(700, 500);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.player-menu').getByText('Playback engine').waitFor();
  await page.screenshot({ path: join(OUT, '04-player-menu.png') });
  await page.keyboard.press('Escape');
  // Channel list overlay
  await page.keyboard.press('c');
  await page.locator('.channel-overlay').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/live/);
});

await step('number zap + previous channel', async () => {
  await page.locator('.channel-row').first().dblclick();
  await page.waitForURL(/\/play/);
  await playing('.player-full video');
  const first = (await page.locator('.player-title .t1').textContent()).trim();
  // Type at human speed: the player re-renders between keystrokes, and digits must survive it.
  await page.keyboard.press('1');
  await page.locator('.zap-digits').waitFor();
  await page.waitForTimeout(700);
  await page.keyboard.press('2');
  await page.waitForFunction(() => /\b12\b/.test(document.querySelector('.player-title .t1')?.textContent ?? ''), null, { timeout: 8000 });
  await playing('.player-full video');
  // Backspace returns to the channel we came from.
  await page.keyboard.press('Backspace');
  await page.waitForFunction((t) => document.querySelector('.player-title .t1')?.textContent?.trim() === t, first, { timeout: 8000 });
  await page.keyboard.press('Escape');
});

await step('sports today: fixtures matched to channels', async () => {
  await page.goto(`${APP}/live?cat=__sports`);
  await page.locator('.match-card').first().waitFor({ timeout: 30000 });
  // The live Premier League match is on the two channels whose guide names it, spelled differently.
  const live = page.locator('.match-card.state-in', { hasText: 'Chelsea' });
  await live.locator('.match-ch').nth(1).waitFor({ timeout: 30000 });
  const chans = await live.locator('.match-ch-name').allTextContents();
  if (chans.length < 2) throw new Error(`expected 2+ channels, got ${chans}`);
  // Event/PPV channels carry the match in their name (no guide entry at all).
  await page.locator('.match-card', { hasText: 'Boca Juniors' }).locator('.match-ch', { hasText: 'PPV 3' }).waitFor();
  // US-style event channels: short provider labels, the ended slot last, empty slots never listed.
  const villa = page.locator('.match-card', { hasText: 'Aston Villa' });
  await villa.locator('.match-ch').nth(1).waitFor();
  const first3 = await villa.locator('.match-ch-name').allTextContents();
  if (first3[0] === 'SOCCER PPV 128' || first3.some((n) => n.includes('|'))) throw new Error(`event feeds not cleaned up: ${first3}`);
  if (await villa.locator('.match-more').count()) await villa.locator('.match-more').first().click();
  await villa.locator('.match-ch', { hasText: 'SOCCER PPV 128' }).getByText('Ended').waitFor();
  if (await page.locator('.match-ch', { hasText: 'PPV 410' }).count()) throw new Error('empty event slot listed as a feed');
  // Fixtures none of your channels carry are folded away; opened, they say so and name the broadcaster.
  await page.locator('.sports-fold').click();
  await page.locator('.match-card', { hasText: 'Levante' }).getByText('Not found in your channels').waitFor();
  await page.screenshot({ path: join(OUT, '04b-sports-today.png') });
  await live.locator('.match-ch').first().click();
  await playing('.player-preview video');
});

await step('backup feed takes over when a match stream dies', async () => {
  await page.goto(`${APP}/live?cat=__sports`);
  const card = page.locator('.match-card.state-in', { hasText: 'Chelsea' });
  await card.locator('.match-more').waitFor({ timeout: 30000 }); // guide loaded: all feeds known
  await card.locator('.match-ch').first().dblclick();
  await page.waitForURL(/\/play/);
  await playing('.player-full video');
  const first = (await page.locator('.player-title .t1').textContent()).trim();
  const streams = await (await fetch(`${MOCK}/player_api.php?username=demo&password=demo&action=get_live_streams`)).json();
  const id = streams.find((s) => s.name === first).stream_id;
  await fetch(`${MOCK}/__mock/kill?id=${id}`);
  try {
    await page.waitForFunction((t) => (document.querySelector('.player-title .t1')?.textContent ?? '').trim() !== t, first, { timeout: 60000 });
    await playing('.player-full video');
    await page.locator('.toast', { hasText: 'Switched to' }).waitFor();
  } finally {
    await fetch(`${MOCK}/__mock/kill?id=${id}&on=0`);
  }
  await page.keyboard.press('Escape');
});

await step('guide fixes: extra source and manual link', async () => {
  await page.goto(`${APP}/settings`);
  const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'TV guide' }) });
  await card.locator('.guide-sources .value').first().waitFor();
  const before = await card.locator('.guide-sources .value').first().textContent();
  await card.locator('textarea').fill(`${MOCK}/extra-epg.xml.gz`);
  await card.getByRole('button', { name: 'Save and load' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.source-list li').length >= 2, null, { timeout: 60000 });
  await page.waitForFunction((b) => document.querySelector('.guide-sources .value')?.textContent !== b, before, { timeout: 30000 });
  // The extra source fills the 27 music channels; the 4 event slots have no guide anywhere.
  const covered = (t) => Number(t.replace(/,/g, '').match(/^(\d+)/)[1]);
  const after = await card.locator('.guide-sources .value').first().textContent();
  if (covered(after) - covered(before) !== 27) throw new Error(`coverage ${before} → ${after}`);
  // ...two of them get a listing from their own name (one has no time, one is an empty slot).
  await card.locator('.from-name', { hasText: '2 listed from their names' }).waitFor();
  // A news channel relinked by hand to another guide channel, then reset.
  await page.goto(`${APP}/live`);
  await page.locator('.cat-item', { hasText: 'News' }).click();
  await page.locator('.channel-row').nth(4).click();
  await page.getByRole('button', { name: 'Wrong guide? Fix it' }).click();
  await page.locator('.modal input[aria-label="Search"]').fill('Metro News 1');
  await page.locator('.modal .overlay-ch', { hasText: 'ch1.mock' }).click();
  await page.locator('.toast', { hasText: 'now uses the guide of Metro News 1' }).waitFor();
  await page.getByRole('button', { name: 'Wrong guide? Fix it' }).click();
  await page.getByText('You linked this channel to').waitFor();
  await page.getByRole('button', { name: 'Use automatic matching' }).click();
  await page.locator('.toast', { hasText: 'back to automatic' }).waitFor();
});

await step('guide trimmed to the playlist; event channels listed from their names', async () => {
  // The server keeps listings only for linked guide channels, but still names every guide channel.
  const epgUrl = `${APP}/api/epg?${new URLSearchParams({ url: `${MOCK}/xmltv.php?username=demo&password=demo` })}`;
  const full = await fetch(epgUrl);
  const fullData = await full.json();
  const trimmed = await fetch(epgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wants: [['ch1.mock', 'Metro News 1']], keep: ['unlisted.3'] }) });
  const data = await trimmed.json();
  const kept = Object.keys(data.programmes).sort().join(',');
  if (kept !== 'ch1.mock,unlisted.3') throw new Error(`trimmed guide kept ${kept}`);
  if (Object.keys(data.channels).length !== Object.keys(fullData.channels).length || !data.counts['unlisted.9']) throw new Error('trimmed guide lost guide channel names or counts');
  // The app's own guide has none of the 60 unlisted channels...
  await page.goto(`${APP}/live`);
  // ...yet "Fix guide" still offers them, and linking one fetches its listings.
  await page.locator('.cat-item', { hasText: 'News' }).click();
  await page.locator('.channel-row').nth(6).click();
  await page.getByRole('button', { name: 'Wrong guide? Fix it' }).click();
  await page.locator('.modal input[aria-label="Search"]').fill('Unlisted Regional 7');
  const option = page.locator('.modal .overlay-ch', { hasText: 'unlisted.7' });
  await option.getByText(/\d+ listings/).waitFor();
  await option.click();
  await page.locator('.epg-list, .channel-epg').getByText('Regional Hour 7').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Wrong guide? Fix it' }).click();
  await page.getByRole('button', { name: 'Use automatic matching' }).click();
  // An event slot with no guide gets its listing from the name.
  await page.locator('.cat-item', { hasText: /^\s*Sports\s*\d+\s*$/ }).click();
  await page.locator('.channel-row', { hasText: 'Peacock 013' }).click();
  await page.getByText('Aston Villa v. Fulham').first().waitFor();
  await page.screenshot({ path: join(OUT, '07c-event-listing.png') });
});

await step('MPEG-TS live via mpegts.js', async () => {
  await page.evaluate(async () => {
    const raw = JSON.parse(localStorage.getItem('chilly.profiles'));
    raw.state.profiles[0].output = 'ts';
    localStorage.setItem('chilly.profiles', JSON.stringify(raw));
  });
  await page.goto(`${APP}/live`);
  await page.locator('.channel-row').nth(4).dblclick();
  await playing('.player-full video', 2, 40000);
  const engine = await page.locator('.player').getAttribute('data-engine');
  if (engine !== 'mpegts') throw new Error(`expected mpegts engine, got ${engine}`);
  await page.evaluate(async () => {
    const raw = JSON.parse(localStorage.getItem('chilly.profiles'));
    raw.state.profiles[0].output = 'm3u8';
    localStorage.setItem('chilly.profiles', JSON.stringify(raw));
  });
  await page.goto(`${APP}/`);
});

await step('TV guide grid', async () => {
  await page.locator('.rail-item', { hasText: 'TV Guide' }).click();
  await page.locator('.guide-prog').first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(OUT, '05-guide.png') });
  await page.locator('.guide-prog.now').first().click();
  await page.getByRole('button', { name: /Watch live/ }).waitFor();
  await page.screenshot({ path: join(OUT, '05b-guide-programme.png') });
  await page.keyboard.press('Escape');
});

await step('reminder from guide', async () => {
  const future = page.locator('.guide-prog:not(.now):not(.past)').first();
  await future.click();
  await page.getByRole('button', { name: /Remind me/ }).click();
  await page.keyboard.press('Escape');
  await page.locator('.rail-item', { hasText: 'Home' }).click();
  await page.getByRole('heading', { name: 'Reminders' }).waitFor();
});

await step('catch-up playback (timeshift)', async () => {
  await page.locator('.rail-item', { hasText: 'Catch-up' }).click();
  await page.locator('.archive .epg-item .btn').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(OUT, '06-catchup.png') });
  await page.locator('.archive li:not(.now) .btn').first().click();
  await page.waitForURL(/\/play/);
  await playing('.player-full video', 1.5, 40000);
  await page.keyboard.press('Escape');
});

await step('movie detail + playback + resume', async () => {
  await page.locator('.rail-item', { hasText: 'Movies' }).click();
  await page.locator('.poster-card').first().waitFor();
  await page.screenshot({ path: join(OUT, '07-movies.png') });
  await page.locator('.poster-card:has-text("Return of the") .poster-btn').first().click();
  await page.getByRole('button', { name: /^Play$/ }).click();
  await page.waitForURL(/\/play/);
  await playing('.player-full video', 12, 40000);
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/movies\/\d+/);
  await page.getByRole('button', { name: /Resume from/ }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(OUT, '08-movie-detail.png') });
});

await step('MKV with AC3 audio (auto remux)', async () => {
  // Movie index 3 is an MKV with AC3 audio, which Chromium plays silently → engine must switch to remux.
  await page.goto(`${APP}/movies/5003`);
  await page.getByRole('button', { name: /^Play$/ }).click();
  await playing('.player-full video', 1);
  await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-engine') === 'remux', null, { timeout: 20000 });
  await playing('.player-full video', 1.5, 30000);
  await page.keyboard.press('Escape');
});

await step('series + episode autoplay', async () => {
  await page.locator('.rail-item', { hasText: 'Series' }).click();
  await page.locator('.poster-card .poster-btn').first().click();
  await page.locator('.episode').first().waitFor();
  await page.screenshot({ path: join(OUT, '09-series.png') });
  await page.locator('.episode').first().click();
  await page.waitForURL(/\/play/);
  await playing('.player-full video');
  // Jump close to the end and wait for the next-episode countdown.
  await page.evaluate(() => {
    const v = document.querySelector('.player-full video');
    v.currentTime = v.duration - 1;
  });
  await page.locator('.next-up').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Play now/ }).click();
  await page.waitForFunction(() => /E2/.test(document.querySelector('.player-title .t2')?.textContent ?? ''));
  await page.keyboard.press('Escape');
});

await step('continue watching on home', async () => {
  await page.locator('.rail-item', { hasText: 'Home' }).click();
  await page.getByRole('heading', { name: 'Continue watching' }).waitFor();
  await page.screenshot({ path: join(OUT, '10-home-continue.png') });
});

await step('global search incl. EPG', async () => {
  await page.locator('.rail-item', { hasText: 'Search' }).click();
  await page.getByLabel('Search', { exact: true }).fill('champions');
  await page.getByRole('heading', { name: 'On TV' }).waitFor({ timeout: 15000 });
  await page.getByLabel('Search', { exact: true }).fill('nova');
  await page.getByRole('heading', { name: 'Channels' }).waitFor();
  await page.screenshot({ path: join(OUT, '11-search.png') });
});

await step('multi-view with two streams', async () => {
  await page.locator('.rail-item', { hasText: 'Multi-View' }).click();
  for (const n of [0, 1]) {
    await page.locator('.mv-empty').first().click();
    await page.locator('.picker-list .overlay-ch').nth(n * 3).click();
  }
  await playing('.mv-tile:nth-child(1) video');
  await playing('.mv-tile:nth-child(2) video');
  const muted = await page.$$eval('.mv-tile video', (vs) => vs.map((v) => v.muted));
  if (muted.filter((m) => !m).length !== 1) throw new Error(`expected exactly one unmuted tile, got ${JSON.stringify(muted)}`);
  await page.screenshot({ path: join(OUT, '12-multiview.png') });
  await page.locator('.rail-item', { hasText: 'Home' }).click();
});

await step('parental lock on adult category', async () => {
  await page.locator('.rail-item', { hasText: 'Settings' }).click();
  await page.getByRole('button', { name: 'Set PIN' }).click();
  await page.getByLabel('New PIN (4–8 digits)').fill('1234');
  await page.getByLabel('Repeat PIN').fill('1234');
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await page.screenshot({ path: join(OUT, '13-settings.png'), fullPage: true });
  await page.evaluate(() => sessionStorage.removeItem('chilly.unlocked'));
  await page.goto(`${APP}/live`);
  await page.locator('.cat-item', { hasText: 'Adult XXX' }).click();
  await page.getByLabel('PIN').waitFor();
  await page.getByLabel('PIN').fill('0000');
  await page.getByText('Wrong PIN').waitFor();
  await page.getByLabel('PIN').fill('1234');
  await page.locator('.cat-item.active', { hasText: 'Adult XXX' }).waitFor();
});

await step('server recording', async () => {
  const now = Date.now();
  const res = await fetch(`${APP}/api/recordings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${MOCK}/live/demo/demo/1.ts`, title: 'E2E recording', channel: 'Metro News 1', start: now, end: now + 12000 }),
  });
  if (!res.ok) throw new Error(`create failed ${res.status}`);
  await page.goto(`${APP}/recordings`);
  await page.getByText('E2E recording').waitFor();
  await page.getByRole('button', { name: /^Play$/ }).waitFor({ timeout: 40000 });
  await page.screenshot({ path: join(OUT, '14-recordings.png') });
  await page.getByRole('button', { name: /^Play$/ }).click();
  await playing('.player-full video', 1);
  await page.keyboard.press('Escape');
});

await step('M3U file playlist', async () => {
  const m3u = await (await fetch(`${MOCK}/get.php?username=demo&password=demo&type=m3u_plus`)).text();
  const file = join(dataDir, 'mock.m3u');
  writeFileSync(file, m3u);
  await page.goto(`${APP}/profiles`);
  await page.getByRole('button', { name: 'Add playlist' }).click();
  await page.getByRole('tab', { name: /M3U file/ }).click();
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByLabel('Playlist name').fill('M3U file');
  await page.getByRole('button', { name: 'Add & connect' }).click();
  await page.waitForURL(`${APP}/`);
  await page.locator('.rail-item', { hasText: 'Live TV' }).click();
  await page.locator('.channel-row').nth(1).click();
  await playing('.player-preview video');
  await page.locator('.channel-row .now-title').first().waitFor({ timeout: 30000 });
  await page.locator('.rail-item', { hasText: 'Series' }).click();
  await page.locator('.poster-card .poster-btn').first().click();
  await page.locator('.episode').first().waitFor();
});

await step('mobile layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/`);
  await page.locator('.hero').waitFor();
  await page.screenshot({ path: join(OUT, '15-mobile-home.png') });
  await page.goto(`${APP}/live`);
  await page.locator('.channel-row').first().waitFor();
  await page.screenshot({ path: join(OUT, '16-mobile-live.png') });
});

await browser.close();
const failed = results.filter((r) => !r.ok);
const relevantErrors = consoleErrors.filter((e) => !/Failed to load resource|net::ERR_ABORTED|ERR_CONNECTION/.test(e));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (relevantErrors.length) console.log(`Console errors (${relevantErrors.length}):\n  ${[...new Set(relevantErrors)].slice(0, 15).join('\n  ')}`);
cleanup();
process.exit(failed.length ? 1 : 0);
