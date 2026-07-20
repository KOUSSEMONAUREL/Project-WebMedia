import { useState, useEffect, Suspense, lazy } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { authClient } from '../../lib/auth-client';
import { getApiHeaders } from '../../lib/api';
import { AuthenticatedLayout } from './layout/authenticated-layout';
import { Header } from './layout/header';
import { Main } from './layout/main';
import { Search } from '@/components/search';
import { ThemeSwitch } from '@/components/theme-switch';
import { ProfileDropdown } from '@/components/profile-dropdown';
import MediasTab from './tabs/MediasTab';
import EpisodesTab from './tabs/EpisodesTab';
import LiensTab from './tabs/LiensTab';
import JobsTab from './tabs/JobsTab';

const DashboardTab = lazy(() => import('./DashboardTabContent'));

const API_BASE = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';
const API_KEY = import.meta.env.PUBLIC_API_KEY || '';

type Stats = { medias: number; episodes: number; liens: number; pendingJobs: number };
type RecentItem = { id: string; title: string; type: string; image: string | null; created_at: string };
type TypeCount = { type: string; count: number };
type Tab = 'dashboard' | 'medias' | 'episodes' | 'liens' | 'jobs';

export default function AdminApp() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'admin'>('loading');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [byType, setByType] = useState<TypeCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const session = await authClient.getSession();
        if (!session?.data?.session) {
          if (!cancelled) setStatus('forbidden');
          return;
        }
        const token = session.data.session.token;
        const [statsRes, recentRes, typeRes] = await Promise.all([
          fetch(`${API_BASE}/admin/stats`, { credentials: 'include', headers: getApiHeaders({ Authorization: `Bearer ${token}` }) }),
          fetch(`${API_BASE}/admin/recent`, { credentials: 'include', headers: getApiHeaders({ Authorization: `Bearer ${token}` }) }),
          fetch(`${API_BASE}/admin/by-type`, { credentials: 'include', headers: getApiHeaders({ Authorization: `Bearer ${token}` }) }),
        ]);
        if (!cancelled) {
          if (statsRes.ok) setStatus('admin');
          else { setStatus('forbidden'); return; }
          if (statsRes.ok) setStats(await statsRes.json());
          if (recentRes.ok) setRecent(await recentRes.json());
          if (typeRes.ok) setByType(await typeRes.json());
        }
      } catch {
        if (!cancelled) setStatus('forbidden');
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground text-sm">Verification...</div>
      </div>
    );
  }

  if (status === 'forbidden') {
    window.location.href = '/';
    return null;
  }

  return (
    <AuthenticatedLayout currentTab={tab} onTabChange={setTab}>
      <Header>
        <Search />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main>
        {tab === 'dashboard' && <ErrorBoundary key="dash"><Suspense fallback={<div className="flex items-center justify-center h-64 text-muted-foreground/50 text-sm">Chargement...</div>}><DashboardTab stats={stats} byType={byType} recent={recent} /></Suspense></ErrorBoundary>}
        {tab === 'medias' && <ErrorBoundary key="med"><MediasTab /></ErrorBoundary>}
        {tab === 'episodes' && <ErrorBoundary key="ep"><EpisodesTab /></ErrorBoundary>}
        {tab === 'liens' && <ErrorBoundary key="ln"><LiensTab /></ErrorBoundary>}
        {tab === 'jobs' && <ErrorBoundary key="jb"><JobsTab /></ErrorBoundary>}
      </Main>
    </AuthenticatedLayout>
  );
}



