import { useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useActiveProfile, useProfiles } from '../store/profiles';
import { useCatalog } from '../store/catalog';
import { programmesFor, resolveGuideKey, useEpg } from '../store/epg';
import { toast } from '../store/toast';

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname.length > 30 ? `${x.pathname.slice(0, 28)}…` : x.pathname}`;
  } catch {
    return u;
  }
}

/** Guide coverage, per-source status and extra XMLTV sources for the active playlist. */
export function GuideSources() {
  const profile = useActiveProfile();
  const update = useProfiles((s) => s.update);
  const catalog = useCatalog((s) => s.catalog);
  const sources = useEpg((s) => s.sources);
  const version = useEpg((s) => s.version);
  const status = useEpg((s) => s.status);
  const [text, setText] = useState((profile?.extraEpgUrls ?? []).join('\n'));

  const coverage = useMemo(() => {
    if (!catalog) return null;
    let n = 0;
    let fromName = 0;
    for (const ch of catalog.channels) {
      if (resolveGuideKey(ch)) n++;
      else if (programmesFor(ch)[0]?.fromName) fromName++;
    }
    return { n, fromName, total: catalog.channels.length };
  }, [catalog, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile || !catalog) return null;
  const save = () => {
    const urls = [...new Set(text.split(/\s+/).map((u) => u.trim()).filter(Boolean))];
    const bad = urls.filter((u) => !/^https?:\/\//i.test(u));
    if (bad.length) return toast.error(`Not a web address: ${bad[0]}`);
    update(profile.id, { extraEpgUrls: urls });
    void useEpg.getState().load({ ...profile, extraEpgUrls: urls }, catalog, { force: true });
    toast.info(urls.length ? `Loading ${urls.length} extra guide source${urls.length === 1 ? '' : 's'}…` : 'Extra guide sources removed');
  };
  const pct = coverage && coverage.total ? Math.round((coverage.n / coverage.total) * 100) : 0;

  return (
    <div className="guide-sources">
      {coverage && (
        <div className="setting">
          <span>
            Guide coverage
            <small className="hint">Channels with programme listings in {profile.name}</small>
          </span>
          <span className="value tabular">
            {coverage.n.toLocaleString()} of {coverage.total.toLocaleString()} ({pct}%)
          </span>
        </div>
      )}
      {coverage && coverage.fromName > 0 && (
        <div className="setting">
          <span>
            Event channels
            <small className="hint">Channels without a guide whose name gives the event and time (“… | Team A vs. Team B (2026-10-31 14:00)”)</small>
          </span>
          <span className="value tabular from-name">{coverage.fromName.toLocaleString()} listed from their names</span>
        </div>
      )}
      {sources.length > 0 && (
        <ul className="source-list" aria-label="Guide sources">
          {sources.map((src, i) => (
            <li key={src.url}>
              {src.ok ? <CheckCircle2 size={15} className="ok" aria-hidden /> : <AlertCircle size={15} className="error-text" aria-hidden />}
              <span className="grow">
                <span className="source-name">{i === 0 ? 'Provider guide' : shortUrl(src.url)}</span>
                <span className="muted small">{src.ok ? `${src.channels.toLocaleString()} channels` : src.error}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>
          Extra guide sources
          <small className="hint">XMLTV links (.xml or .xml.gz), one per line. They fill channels your provider's guide leaves empty; the provider's guide wins where both have listings.</small>
        </span>
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://example.com/guide.xml.gz" spellCheck={false} />
      </label>
      <div className="row gap">
        <button className="btn" onClick={save} disabled={status === 'loading'}>
          Save and load
        </button>
        <span className="muted small">To fix a single channel, open it in Live TV and choose “Wrong guide? Fix it”.</span>
      </div>
    </div>
  );
}
