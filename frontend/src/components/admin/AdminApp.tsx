import { useState, useEffect } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { authClient } from '../../lib/auth-client';
import { getApiHeaders } from '../../lib/api';
import { AuthenticatedLayout } from './layout/authenticated-layout';
import { Header } from './layout/header';
import { Main } from './layout/main';
import { Search } from '@/components/search';
import { ThemeSwitch } from '@/components/theme-switch';
import { ProfileDropdown } from '@/components/profile-dropdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import MediasTab from './tabs/MediasTab';
import EpisodesTab from './tabs/EpisodesTab';
import LiensTab from './tabs/LiensTab';
import JobsTab from './tabs/JobsTab';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';
const API_KEY = import.meta.env.PUBLIC_API_KEY || '';

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];

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
        {tab === 'dashboard' && <ErrorBoundary key="dash"><DashboardTab stats={stats} byType={byType} recent={recent} /></ErrorBoundary>}
        {tab === 'medias' && <ErrorBoundary key="med"><MediasTab /></ErrorBoundary>}
        {tab === 'episodes' && <ErrorBoundary key="ep"><EpisodesTab /></ErrorBoundary>}
        {tab === 'liens' && <ErrorBoundary key="ln"><LiensTab /></ErrorBoundary>}
        {tab === 'jobs' && <ErrorBoundary key="jb"><JobsTab /></ErrorBoundary>}
      </Main>
    </AuthenticatedLayout>
  );
}

function DashboardTab({ stats, byType, recent }: { stats: Stats | null; byType: TypeCount[]; recent: RecentItem[] }) {
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard title="Medias" value={stats?.medias ?? '...'} />
        <StatCard title="Episodes" value={stats?.episodes ?? '...'} />
        <StatCard title="Liens" value={stats?.liens ?? '...'} />
        <StatCard title="Jobs en attente" value={stats?.pendingJobs ?? '...'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-7 mb-8">
        <Card className="col-span-1 lg:col-span-4">
          <CardHeader>
            <CardTitle>Medias par type</CardTitle>
          </CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={byType}>
                  <XAxis dataKey="type" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground/50 text-sm">
                Chargement...
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle>Repartition</CardTitle>
          </CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={byType} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={100} label={({ type, count }) => `${type} (${count})`}>
                    {byType.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground/50 text-sm">
                Chargement...
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Medias recents</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map((item) => (
                <div key={item.id} className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-[10px] uppercase text-muted-foreground overflow-hidden shrink-0">
                    {item.image ? (
                      <img src={item.image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      item.type?.slice(0, 2)
                    )}
                  </div>
                  <span className="flex-1 truncate">{item.title}</span>
                  <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground/50 text-sm">
              Chargement...
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}


