import { useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { Empty, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

export function AccountPage() {
  const profile = useActiveProfile();
  const { account, catalog, status } = useCatalog();
  const navigate = useNavigate();
  if (!profile) return null;
  if (status === 'loading') return <Spinner />;
  const rows: [string, React.ReactNode][] = [];
  rows.push(['Playlist', profile.name]);
  rows.push(['Type', profile.type === 'xtream' ? 'Xtream Codes API' : 'M3U playlist']);
  if (profile.type === 'xtream') rows.push(['Server', profile.server]);
  if (account) {
    const days = account.expDate ? Math.ceil((account.expDate - Date.now()) / 86_400_000) : null;
    rows.push(['Username', account.username]);
    rows.push(['Status', <span className={`chip ${account.status === 'Active' ? 'ok' : 'warn'}`}>{account.status}</span>]);
    rows.push(['Expires', account.expDate ? `${formatDate(account.expDate)} (${days! > 0 ? `${days} days left` : 'expired'})` : 'Never / unlimited']);
    rows.push(['Connections', `${account.activeCons} active of ${account.maxConnections}`]);
    rows.push(['Trial', account.isTrial ? 'Yes' : 'No']);
    if (account.createdAt) rows.push(['Created', formatDate(account.createdAt)]);
    if (account.formats.length) rows.push(['Formats', account.formats.join(', ')]);
    if (account.serverTimezone) rows.push(['Server timezone', account.serverTimezone]);
    if (account.serverTimeOffsetMs !== undefined && Math.abs(account.serverTimeOffsetMs) > 120_000)
      rows.push(['Clock drift', `Server clock differs by ${Math.round(account.serverTimeOffsetMs / 60000)} min`]);
    if (account.message) rows.push(['Message', account.message]);
  }
  if (catalog) {
    rows.push(['Channels', catalog.channels.length.toLocaleString()]);
    rows.push(['Movies', catalog.movies.length.toLocaleString()]);
    rows.push(['Series', catalog.series.length.toLocaleString()]);
    rows.push(['Catch-up channels', catalog.channels.filter((c) => c.archive).length.toLocaleString()]);
    rows.push(['Last updated', new Date(catalog.fetchedAt).toLocaleString()]);
  }
  return (
    <div className="account">
      <h1>
        <UserRound size={22} /> Account
      </h1>
      {!account && profile.type === 'xtream' && <Empty title="Account details unavailable">The provider did not return account information.</Empty>}
      <dl className="kv card">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button className="btn" onClick={() => navigate('/profiles')}>
        Manage playlists
      </button>
    </div>
  );
}
