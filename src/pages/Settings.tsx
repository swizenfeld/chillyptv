import { useMemo, useState } from 'react';
import { del } from 'idb-keyval';
import { Download, EyeOff, Keyboard, Lock, Palette, PlayCircle, RefreshCw, Shield, Upload, Wifi, CalendarClock, Database, Cloud, Trophy } from 'lucide-react';
import { SportsSettings } from '../components/SportsSettings';
import { GuideSources } from '../components/GuideSources';
import { useSettings, isAdultName, type AspectMode, type Theme } from '../store/settings';
import { useCatalog } from '../store/catalog';
import { useEpg } from '../store/epg';
import { useActiveProfile } from '../store/profiles';
import { backendHealth, checkBackend } from '../lib/api';
import { exportState, importState } from '../lib/sync';
import { quickFilter } from '../lib/search';
import { Modal, Segmented, Toggle } from '../components/ui';
import { useParental } from '../components/Parental';
import { toast } from '../store/toast';
import type { ContentKind } from '../lib/types';

// Curated signature accents: cinema red, gold, signal green, ice blue, violet, platinum.
const ACCENTS = ['#e50914', '#d4a24c', '#00c805', '#a8c7fa', '#9b7bff', '#e4e4e7'];

const TRACK_LANGS: [string, string][] = [
  ['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['nl', 'Dutch'],
  ['ru', 'Russian'], ['ar', 'Arabic'], ['tr', 'Turkish'], ['pl', 'Polish'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'],
];

export function SettingsPage() {
  const s = useSettings();
  const set = s.set;
  const profile = useActiveProfile();
  const catalog = useCatalog((x) => x.catalog);
  const { requestPin } = useParental();
  const [pinDialog, setPinDialog] = useState(false);
  const [catKind, setCatKind] = useState<ContentKind | null>(null);
  const [health, setHealth] = useState(backendHealth());

  const withPin = (fn: () => void) => (s.pin ? requestPin(fn, 'Enter your PIN to change parental settings') : fn());

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(exportState(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chillyptv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importFile = async (file: File) => {
    try {
      importState(JSON.parse(await file.text()));
      toast.success('Backup restored');
    } catch (e) {
      toast.error(`Could not restore: ${(e as Error).message}`);
    }
  };

  return (
    <div className="settings">
      <h1>Settings</h1>

      <section className="card">
        <h2>
          <Palette size={18} /> Appearance
        </h2>
        <div className="setting">
          <span>Theme</span>
          <Segmented<Theme> value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: 'dark', label: 'Dark' }, { value: 'oled', label: 'OLED black' }, { value: 'light', label: 'Light' }]} />
        </div>
        <div className="setting">
          <span>Accent colour</span>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button key={c} className={`swatch ${s.accent === c ? 'active' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={`Accent ${c}`} />
            ))}
            <input type="color" value={s.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Custom accent colour" />
          </div>
        </div>
        <Toggle checked={s.clock24} onChange={(clock24) => set({ clock24 })} label="24-hour clock" />
      </section>

      <section className="card">
        <h2>
          <PlayCircle size={18} /> Playback
        </h2>
        <div className="setting">
          <span>Default aspect ratio</span>
          <select className="select" value={s.defaultAspect} onChange={(e) => set({ defaultAspect: e.target.value as AspectMode })}>
            <option value="contain">Fit</option>
            <option value="cover">Zoom / crop</option>
            <option value="fill">Stretch</option>
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
          </select>
        </div>
        <div className="setting">
          <span>
            Live buffer
            <small className="hint">More buffer = fewer stalls, more delay</small>
          </span>
          <div className="row gap">
            <input type="range" min={6} max={90} step={2} value={s.liveBufferSec} onChange={(e) => set({ liveBufferSec: Number(e.target.value) })} aria-label="Live buffer seconds" />
            <span className="value">{s.liveBufferSec}s</span>
          </div>
        </div>
        <Toggle checked={s.autoReconnect} onChange={(autoReconnect) => set({ autoReconnect })} label="Auto-reconnect live streams" hint="Retries with back-off and switches HLS ↔ TS when a stream drops." />
        <Toggle checked={s.livePreview} onChange={(livePreview) => set({ livePreview })} label="Preview channels in the Live TV list" hint="Uses one provider connection while browsing." />
        <Toggle checked={s.autoplayNext} onChange={(autoplayNext) => set({ autoplayNext })} label="Autoplay next episode" />
        <Toggle checked={s.preferRemux} onChange={(preferRemux) => set({ preferRemux })} label="Prefer server remux for MKV" hint="Converts MKV/AVI on the server (fixes missing audio for AC3/DTS). Seeking reloads the stream." />
        <Toggle checked={s.showStats} onChange={(showStats) => set({ showStats })} label="Show stream statistics by default" />
        <div className="field-row">
          <label className="field">
            <span>Preferred audio language</span>
            <select className="select" value={s.preferredAudioLang} onChange={(e) => set({ preferredAudioLang: e.target.value })}>
              <option value="">The file's default</option>
              {TRACK_LANGS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <small className="hint">Movies and episodes with several audio tracks start in this language.</small>
          </label>
          <label className="field">
            <span>Preferred subtitle language</span>
            <select className="select" value={s.preferredSubLang} onChange={(e) => set({ preferredSubLang: e.target.value })}>
              <option value="">Off</option>
              {TRACK_LANGS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <small className="hint">Shown automatically when a movie or episode has text subtitles in this language.</small>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>
          <CalendarClock size={18} /> TV guide
        </h2>
        <div className="setting">
          <span>
            Time shift
            <small className="hint">Fix guides that are a few hours off</small>
          </span>
          <div className="row gap">
            <input type="range" min={-12} max={12} step={0.5} value={s.epgShiftHours} onChange={(e) => set({ epgShiftHours: Number(e.target.value) })} aria-label="EPG time shift hours" />
            <span className="value">{s.epgShiftHours > 0 ? '+' : ''}{s.epgShiftHours}h</span>
          </div>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Days of history</span>
            <input className="input" type="number" min={0} max={14} value={s.epgPastDays} onChange={(e) => set({ epgPastDays: Math.max(0, Math.min(14, Number(e.target.value))) })} />
          </label>
          <label className="field">
            <span>Days ahead</span>
            <input className="input" type="number" min={1} max={14} value={s.epgFutureDays} onChange={(e) => set({ epgFutureDays: Math.max(1, Math.min(14, Number(e.target.value))) })} />
          </label>
        </div>
        <button
          className="btn"
          onClick={() => {
            if (profile && catalog) {
              void useEpg.getState().load(profile, catalog, { force: true });
              toast.info('Refreshing the TV guide…');
            }
          }}
        >
          <RefreshCw size={16} /> Refresh guide now
        </button>
        <GuideSources />
        <Toggle
          checked={s.notifications}
          onChange={(notifications) => {
            set({ notifications });
            if (notifications && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
          }}
          label="Desktop notifications for reminders"
        />
      </section>

      <section className="card">
        <h2>
          <Trophy size={18} /> Sports
        </h2>
        <p className="muted">“Sports today” in Live TV lists today's matches for the competitions you follow and the channels in your guide that show them.</p>
        <Toggle
          checked={s.sportsOnline}
          onChange={(sportsOnline) => set({ sportsOnline })}
          label="Use online fixtures"
          hint="Kick-off times, live scores and broadcasters from ESPN, via your ChillyPTV server. Off: matches are found from the TV guide only."
        />
        <SportsSettings />
      </section>

      <section className="card">
        <h2>
          <Shield size={18} /> Parental control
        </h2>
        <div className="setting">
          <span>{s.pin ? 'PIN is set' : 'No PIN set — parental control is off'}</span>
          <div className="row gap">
            <button className="btn" onClick={() => withPin(() => setPinDialog(true))}>
              <Lock size={16} /> {s.pin ? 'Change PIN' : 'Set PIN'}
            </button>
            {s.pin && (
              <button className="btn" onClick={() => withPin(() => set({ pin: null }))}>
                Remove PIN
              </button>
            )}
          </div>
        </div>
        <Toggle checked={s.autoLockAdult} onChange={(autoLockAdult) => withPin(() => set({ autoLockAdult }))} label="Automatically lock adult categories" hint="Categories with names like Adult, XXX or 18+." />
        <Toggle checked={s.hideLockedContent} onChange={(hideLockedContent) => withPin(() => set({ hideLockedContent }))} label="Hide locked categories completely" />
        <p className="hint">Lock individual categories in the category manager below.</p>
      </section>

      <section className="card">
        <h2>
          <EyeOff size={18} /> Categories
        </h2>
        <p className="muted">Hide categories you never watch, or lock them behind your PIN.</p>
        <div className="row gap wrap">
          <button className="btn" onClick={() => withPin(() => setCatKind('live'))} disabled={!catalog}>
            Live TV ({catalog?.categories.live.length ?? 0})
          </button>
          <button className="btn" onClick={() => withPin(() => setCatKind('movie'))} disabled={!catalog}>
            Movies ({catalog?.categories.movie.length ?? 0})
          </button>
          <button className="btn" onClick={() => withPin(() => setCatKind('series'))} disabled={!catalog}>
            Series ({catalog?.categories.series.length ?? 0})
          </button>
        </div>
      </section>

      <section className="card">
        <h2>
          <Wifi size={18} /> Network
        </h2>
        <div className="setting">
          <span>ChillyPTV server</span>
          <span className={`chip ${health?.ok ? 'ok' : 'warn'}`}>
            {health?.ok ? `Connected · v${health.version}${health.ffmpeg ? ' · ffmpeg' : ''}` : 'Not reachable'}
          </span>
          <button className="icon-btn" onClick={async () => setHealth(await checkBackend())} aria-label="Re-check server">
            <RefreshCw size={16} />
          </button>
        </div>
        <Toggle checked={s.useProxy} onChange={(useProxy) => set({ useProxy })} label="Route requests through the ChillyPTV server" hint="Needed for most providers: avoids CORS and mixed-content blocking, applies custom User-Agents." />
        <label className="field">
          <span>Default User-Agent</span>
          <input className="input" value={s.userAgent} onChange={(e) => set({ userAgent: e.target.value })} placeholder="Server default (desktop browser)" />
        </label>
      </section>

      <section className="card">
        <h2>
          <Cloud size={18} /> Sync & backup
        </h2>
        <Toggle checked={s.syncEnabled} onChange={(syncEnabled) => set({ syncEnabled })} label="Sync playlists, favourites and history via your server" hint="Every device using the same server and sync name shares the same library." />
        {s.syncEnabled && (
          <label className="field">
            <span>Sync name</span>
            <input className="input" value={s.syncKey} onChange={(e) => set({ syncKey: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} />
          </label>
        )}
        <div className="row gap wrap">
          <button className="btn" onClick={exportFile}>
            <Download size={16} /> Export backup
          </button>
          <label className="btn">
            <Upload size={16} /> Import backup
            <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>
          <Database size={18} /> Storage
        </h2>
        <div className="row gap wrap">
          <button
            className="btn"
            disabled={!profile}
            onClick={async () => {
              if (!profile) return;
              await del(`catalog:${profile.id}`);
              await del(`epg:${profile.id}`);
              useCatalog.getState().clear();
              void useCatalog.getState().load(profile, { force: true });
              toast.success('Cache cleared, reloading playlist');
            }}
          >
            Clear cached playlist & guide
          </button>
          <button className="btn" onClick={() => confirm('Reset all settings to defaults?') && useSettings.getState().reset()}>
            Reset settings
          </button>
        </div>
      </section>

      <section className="card">
        <h2>
          <Keyboard size={18} /> Keyboard & remote shortcuts
        </h2>
        <div className="shortcuts">
          {[
            ['Space / K', 'Play / pause'],
            ['↑ ↓ / PgUp PgDn', 'Channel up / down (live)'],
            ['0–9', 'Jump to channel number'],
            ['Backspace / B', 'Previous channel'],
            ['C / Enter', 'Channel list overlay'],
            ['← →', 'Seek 10s (or rewind live)'],
            ['J / L', 'Seek 30s'],
            ['F', 'Fullscreen'],
            ['M', 'Mute'],
            ['P', 'Picture-in-picture'],
            ['I', 'Programme info'],
            ['S', 'Stream statistics'],
            ['N', 'Next episode'],
            ['Esc', 'Close player'],
          ].map(([k, v]) => (
            <div key={k} className="shortcut">
              <kbd>{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </section>

      {pinDialog && <SetPinDialog onClose={() => setPinDialog(false)} />}
      {catKind && <CategoryManager kind={catKind} onClose={() => setCatKind(null)} />}
    </div>
  );
}

function SetPinDialog({ onClose }: { onClose: () => void }) {
  const set = useSettings((s) => s.set);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const valid = /^\d{4,8}$/.test(a) && a === b;
  return (
    <Modal
      title="Set parental PIN"
      onClose={onClose}
      footer={
        <div className="row gap end">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              set({ pin: a });
              toast.success('PIN saved');
              onClose();
            }}
          >
            Save PIN
          </button>
        </div>
      }
    >
      <div className="form">
        <label className="field">
          <span>New PIN (4–8 digits)</span>
          <input className="input pin-input" type="password" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} maxLength={8} />
        </label>
        <label className="field">
          <span>Repeat PIN</span>
          <input className="input pin-input" type="password" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} maxLength={8} />
        </label>
      </div>
    </Modal>
  );
}

function CategoryManager({ kind, onClose }: { kind: ContentKind; onClose: () => void }) {
  const catalog = useCatalog((s) => s.catalog);
  const { hiddenCategories, lockedCategories, pin, autoLockAdult, set } = useSettings();
  const [q, setQ] = useState('');
  const cats = useMemo(() => quickFilter(catalog?.categories[kind] ?? [], q, (c) => c.name), [catalog, kind, q]);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Modal title={`${kind === 'live' ? 'Live TV' : kind === 'movie' ? 'Movie' : 'Series'} categories`} onClose={onClose} wide>
      <div className="row gap">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter categories" />
        <button className="btn small" onClick={() => set({ hiddenCategories: hiddenCategories.filter((id) => !cats.some((c) => c.id === id)) })}>
          Show all
        </button>
        <button className="btn small" onClick={() => set({ hiddenCategories: [...new Set([...hiddenCategories, ...cats.map((c) => c.id)])] })}>
          Hide all
        </button>
      </div>
      {!pin && <p className="hint">Set a PIN to be able to lock categories.</p>}
      <div className="cat-manager">
        <div className="cat-manager-head">
          <span>Category</span>
          <span>Visible</span>
          <span>Locked</span>
        </div>
        {cats.map((c) => {
          const auto = autoLockAdult && isAdultName(c.name);
          return (
            <div key={c.id} className="cat-manager-row">
              <span className="grow">{c.name}</span>
              <input type="checkbox" className="switch" checked={!hiddenCategories.includes(c.id)} onChange={() => set({ hiddenCategories: toggle(hiddenCategories, c.id) })} aria-label={`Show ${c.name}`} />
              <input type="checkbox" className="switch" disabled={!pin || auto} checked={auto || lockedCategories.includes(c.id)} onChange={() => set({ lockedCategories: toggle(lockedCategories, c.id) })} aria-label={`Lock ${c.name}`} title={auto ? 'Locked automatically (adult)' : undefined} />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
