import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ParentalProvider } from './components/Parental';
import { Spinner, Toasts } from './components/ui';
import { useBoot } from './hooks/useBoot';
import { useActiveProfile } from './store/profiles';
import { HomePage } from './pages/Home';
import { ProfilesPage } from './pages/Profiles';
import { LiveTVPage } from './pages/LiveTV';
import { MoviesPage, SeriesPage } from './pages/Movies';
import { MovieDetailPage, SeriesDetailPage } from './pages/Details';
import { GuidePage } from './pages/Guide';
import { CatchUpPage } from './pages/CatchUp';
import { MultiViewPage } from './pages/MultiView';
import { SearchPage } from './pages/Search';
import { FavoritesPage } from './pages/Favorites';
import { RecordingsPage } from './pages/Recordings';
import { SettingsPage } from './pages/Settings';
import { AccountPage } from './pages/Account';
import { PlayerPage } from './pages/PlayerPage';

function RequireProfile({ children }: { children: React.ReactNode }) {
  const profile = useActiveProfile();
  if (!profile) return <Navigate to="/profiles" replace />;
  return <>{children}</>;
}

export default function App() {
  const ready = useBoot();
  if (!ready) return <div className="boot"><Spinner label="Starting ChillyPTV…" /></div>;
  return (
    <ParentalProvider>
      <Routes>
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/play" element={<RequireProfile><PlayerPage /></RequireProfile>} />
        <Route element={<RequireProfile><Shell /></RequireProfile>}>
          <Route index element={<HomePage />} />
          <Route path="live" element={<LiveTVPage />} />
          <Route path="movies" element={<MoviesPage />} />
          <Route path="movies/:id" element={<MovieDetailPage />} />
          <Route path="series" element={<SeriesPage />} />
          <Route path="series/:id" element={<SeriesDetailPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="catchup" element={<CatchUpPage />} />
          <Route path="multiview" element={<MultiViewPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="recordings" element={<RecordingsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </ParentalProvider>
  );
}
