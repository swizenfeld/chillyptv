import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarClock, Clapperboard, Film, Heart, History, Home, LayoutGrid, RefreshCw, Search, Settings, Snowflake, Tv, Video, UserCircle2, AlertTriangle } from 'lucide-react';
import { useActiveProfile } from '../store/profiles';
import { useCatalog } from '../store/catalog';
import { useEpg } from '../store/epg';
import { useSettings } from '../store/settings';
import { formatClock } from '../lib/format';
import { useNow } from './ui';
import { backendHealth } from '../lib/api';

const NAV = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/live', icon: Tv, label: 'Live TV' },
  { to: '/movies', icon: Film, label: 'Movies' },
  { to: '/series', icon: Clapperboard, label: 'Series' },
  // "secondary" items are also Home shortcuts, so the phone bottom bar can drop them.
  { to: '/guide', icon: CalendarClock, label: 'TV Guide', secondary: true },
  { to: '/catchup', icon: History, label: 'Catch-up', secondary: true },
  { to: '/multiview', icon: LayoutGrid, label: 'Multi-View', secondary: true },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/favorites', icon: Heart, label: 'Favourites' },
  { to: '/recordings', icon: Video, label: 'Recordings', secondary: true },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Shell() {
  const profile = useActiveProfile();
  const { refreshing, error, account, status } = useCatalog();
  const epgStatus = useEpg((s) => s.status);
  const clock24 = useSettings((s) => s.clock24);
  const useProxy = useSettings((s) => s.useProxy);
  const now = useNow(15000);
  const navigate = useNavigate();
  const load = useCatalog((s) => s.load);
  const daysLeft = account?.expDate ? Math.ceil((account.expDate - now) / 86_400_000) : null;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand" onClick={() => navigate('/')} role="button" tabIndex={0}>
          <span className="brand-mark">
            <Snowflake size={18} strokeWidth={2.4} aria-hidden />
          </span>
          <span className="brand-name">ChillyPTV</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''} ${'secondary' in n && n.secondary ? 'secondary-nav' : ''}`} title={n.label}>
            <n.icon size={20} aria-hidden />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="profile-chip" onClick={() => navigate('/profiles')} title="Switch playlist">
            <span className="dot" style={{ background: profile?.color }} />
            <span className="name">{profile?.name ?? 'No playlist'}</span>
            <UserCircle2 size={16} />
          </button>
          {daysLeft !== null && (
            <button className={`chip ${daysLeft < 7 ? 'warn' : ''}`} onClick={() => navigate('/account')} title="Account">
              {daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}
            </button>
          )}
          {status === 'ready' && epgStatus === 'loading' && <span className="chip subtle">Loading guide…</span>}
          {error && (
            <span className="chip warn" title={error}>
              <AlertTriangle size={14} /> {status === 'ready' ? 'Offline – showing cached list' : 'Error'}
            </span>
          )}
          {useProxy && backendHealth() === null && (
            <span className="chip warn" title="The ChillyPTV server is not reachable, streams are requested directly by the browser.">
              <AlertTriangle size={14} /> Server offline
            </span>
          )}
          <div className="spacer" />
          <button className="icon-btn" title="Refresh playlist" onClick={() => profile && load(profile, { force: true })} disabled={refreshing}>
            <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
          </button>
          <time className="clock">{formatClock(now, clock24)}</time>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
