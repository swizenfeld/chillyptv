import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { set as idbSet } from 'idb-keyval';
import { Check, FileUp, Link2, Pencil, Plus, Server, Snowflake, Trash2, Tv } from 'lucide-react';
import { PROFILE_COLORS, useProfiles } from '../store/profiles';
import { useCatalog, fetchCatalog } from '../store/catalog';
import { normalizeServer, parseXtreamLink } from '../lib/xtream';
import { uid, relativeTime } from '../lib/format';
import type { AccountInfo, Catalog, Profile } from '../lib/types';
import { Modal, Segmented } from '../components/ui';
import { toast } from '../store/toast';

type Mode = 'xtream' | 'm3u-url' | 'm3u-file';

export function ProfilesPage() {
  const { profiles, activeId, setActive, remove } = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(profiles.length ? null : 'new');
  const navigate = useNavigate();
  const clear = useCatalog((s) => s.clear);

  return (
    <div className="profiles-page">
      <div className="profiles-hero">
        <div className="brand big">
          <span className="brand-mark">
            <Snowflake size={30} strokeWidth={2.2} aria-hidden />
          </span>{' '}
          ChillyPTV
        </div>
        <p className="muted">Choose a playlist, or add an Xtream Codes account or M3U playlist.</p>
      </div>
      <div className="profile-grid">
        {profiles.map((p) => (
          <div key={p.id} className={`profile-card ${p.id === activeId ? 'active' : ''}`}>
            <button
              className="profile-main"
              onClick={() => {
                if (p.id !== activeId) clear();
                setActive(p.id);
                navigate('/');
              }}
            >
              <div className="avatar" style={{ background: p.color }}>
                {p.type === 'xtream' ? <Server size={26} /> : <Tv size={26} />}
              </div>
              <div className="profile-name">{p.name}</div>
              <div className="muted small">
                {p.type === 'xtream' ? `Xtream · ${p.username}` : p.m3uUrl ? 'M3U URL' : `M3U file${p.m3uFileName ? ` · ${p.m3uFileName}` : ''}`}
              </div>
              <div className="muted small">Added {relativeTime(p.createdAt)}</div>
              {p.id === activeId && (
                <span className="badge">
                  <Check size={12} /> Active
                </span>
              )}
            </button>
            <div className="profile-actions">
              <button className="icon-btn" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                <Pencil size={16} />
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${p.name}`}
                onClick={() => {
                  if (confirm(`Delete "${p.name}"? Favourites and history for it are kept until you clear them.`)) remove(p.id);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        <button className="profile-card add" onClick={() => setEditing('new')}>
          <Plus size={32} />
          <span>Add playlist</span>
        </button>
      </div>
      {editing && <ProfileEditor profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => navigate('/')} />}
    </div>
  );
}

function ProfileEditor({ profile, onClose, onSaved }: { profile: Profile | null; onClose: () => void; onSaved: () => void }) {
  const { add, update, profiles } = useProfiles();
  const [mode, setMode] = useState<Mode>(profile ? (profile.type === 'xtream' ? 'xtream' : profile.m3uUrl ? 'm3u-url' : 'm3u-file') : 'xtream');
  const [name, setName] = useState(profile?.name ?? '');
  const [server, setServer] = useState(profile?.server ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [password, setPassword] = useState(profile?.password ?? '');
  const [m3uUrl, setM3uUrl] = useState(profile?.m3uUrl ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [epgUrl, setEpgUrl] = useState(profile?.epgUrl ?? '');
  const [userAgent, setUserAgent] = useState(profile?.userAgent ?? '');
  const [output, setOutput] = useState<'m3u8' | 'ts'>(profile?.output ?? 'm3u8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(!!(profile?.epgUrl || profile?.userAgent));

  const onUrlPaste = (value: string) => {
    // Paste an Xtream get.php link into the M3U field → offer the Xtream login instead.
    const x = parseXtreamLink(value);
    if (x && mode === 'm3u-url') {
      setMode('xtream');
      setServer(x.server);
      setUsername(x.username);
      setPassword(x.password);
      toast.info('Detected an Xtream Codes link — switched to Xtream login for full features (catch-up, VOD info).');
      return;
    }
    setM3uUrl(value);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const id = profile?.id ?? uid();
      const base: Profile = {
        id,
        name: name.trim() || (mode === 'xtream' ? (() => { try { return new URL(normalizeServer(server)).hostname; } catch { return 'Xtream'; } })() : file?.name.replace(/\.m3u8?$/i, '') || 'My playlist'),
        type: mode === 'xtream' ? 'xtream' : 'm3u',
        output,
        color: profile?.color ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
        createdAt: profile?.createdAt ?? Date.now(),
        epgUrl: epgUrl.trim() || undefined,
        userAgent: userAgent.trim() || undefined,
      };
      if (mode === 'xtream') {
        if (!server.trim() || !username.trim()) throw new Error('Server, username and password are required.');
        Object.assign(base, { server: normalizeServer(server), username: username.trim(), password });
      } else if (mode === 'm3u-url') {
        if (!/^https?:\/\//i.test(m3uUrl.trim())) throw new Error('Enter a valid http(s) playlist URL.');
        base.m3uUrl = m3uUrl.trim();
      } else {
        if (!file && !profile) throw new Error('Choose an .m3u file.');
        if (file) {
          const text = await file.text();
          await idbSet(`m3u:${id}`, text);
          base.m3uFileName = file.name;
        } else {
          base.m3uFileName = profile?.m3uFileName;
        }
      }
      // Validate by actually loading the catalog. Channels arrive first; on big providers the movie
      // list takes far longer, so the dialog closes on channels and movies/series follow in the background.
      let onChannels!: (v: { catalog: Catalog; account: AccountInfo | null }) => void;
      const channelsFirst = new Promise<{ catalog: Catalog; account: AccountInfo | null }>((r) => (onChannels = r));
      const full = fetchCatalog(base, undefined, (catalog, account) => onChannels({ catalog, account }));
      full.catch(() => {}); // a later failure is handled by the catalogue store
      let first = await Promise.race([channelsFirst, full]);
      if (first.catalog.libraryPending && !first.catalog.channels.length) first = await full; // nothing to show yet
      const { catalog } = first;
      const total = catalog.channels.length + catalog.movies.length + catalog.series.length;
      if (!total && !catalog.libraryPending) throw new Error('Logged in, but the playlist is empty.');
      if (!catalog.libraryPending) await idbSet(`catalog:${id}`, catalog).catch(() => {});
      if (profile) update(profile.id, base);
      else add(base);
      useCatalog.getState().clear();
      if (catalog.libraryPending) useCatalog.getState().adopt(id, first, full);
      useProfiles.getState().setActive(id);
      toast.success(
        catalog.libraryPending
          ? `${base.name}: ${catalog.channels.length.toLocaleString()} channels. Movies and series are still loading.`
          : `${base.name}: ${catalog.channels.length} channels, ${catalog.movies.length} movies, ${catalog.series.length} series`,
      );
      onClose();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={profile ? 'Edit playlist' : 'Add playlist'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'xtream', label: <><Server size={16} /> Xtream Codes</> },
            { value: 'm3u-url', label: <><Link2 size={16} /> M3U URL</> },
            { value: 'm3u-file', label: <><FileUp size={16} /> M3U file</> },
          ]}
        />
        <label className="field">
          <span>Playlist name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living room" />
        </label>
        {mode === 'xtream' && (
          <>
            <label className="field">
              <span>Server URL</span>
              <input className="input" value={server} onChange={(e) => {
                const x = parseXtreamLink(e.target.value);
                if (x) {
                  setServer(x.server);
                  setUsername(x.username);
                  setPassword(x.password);
                } else setServer(e.target.value);
              }} placeholder="http://provider.example:8080" autoComplete="url" required />
              <small className="hint">Tip: paste a full get.php link and the fields fill themselves.</small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Username</span>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </label>
              <label className="field">
                <span>Password</span>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </label>
            </div>
            <label className="field">
              <span>Live stream format</span>
              <Segmented<'m3u8' | 'ts'> size="small" value={output} onChange={setOutput} options={[{ value: 'm3u8', label: 'HLS (.m3u8)' }, { value: 'ts', label: 'MPEG-TS (.ts)' }]} />
              <small className="hint">The other format is tried automatically if one fails.</small>
            </label>
          </>
        )}
        {mode === 'm3u-url' && (
          <label className="field">
            <span>Playlist URL</span>
            <input className="input" value={m3uUrl} onChange={(e) => onUrlPaste(e.target.value)} placeholder="https://example.com/playlist.m3u" required />
          </label>
        )}
        {mode === 'm3u-file' && (
          <label className="field">
            <span>Playlist file {profile?.m3uFileName && <em className="muted">(current: {profile.m3uFileName})</em>}</span>
            <input className="input" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        <button type="button" className="link-btn" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? 'Hide' : 'Show'} advanced options
        </button>
        {advanced && (
          <>
            <label className="field">
              <span>EPG (XMLTV) URL override</span>
              <input className="input" value={epgUrl} onChange={(e) => setEpgUrl(e.target.value)} placeholder={mode === 'xtream' ? 'Defaults to the provider xmltv.php' : 'Defaults to url-tvg from the playlist'} />
            </label>
            <label className="field">
              <span>Custom User-Agent</span>
              <input className="input" value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="Some providers require e.g. IPTVSmartersPro or VLC/3.0" />
            </label>
          </>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="row gap end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Connecting…' : profile ? 'Save' : 'Add & connect'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
