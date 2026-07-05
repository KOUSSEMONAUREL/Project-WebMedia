import { useState, useEffect } from 'react';
import { authClient } from '../../lib/auth-client';
import { AuthenticatedLayout } from './layout/authenticated-layout';
import { Header } from './layout/header';
import { Main } from './layout/main';
import { TopNav } from './layout/top-nav';
import { Search } from '@/components/search';
import { ThemeSwitch } from '@/components/theme-switch';
import { ProfileDropdown } from '@/components/profile-dropdown';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Overview } from './dashboard/overview';
import { Analytics } from './dashboard/analytics';
import { RecentSales } from './dashboard/recent-sales';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

export default function AdminApp() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'admin'>('loading');
  const [stats, setStats] = useState<Record<string, number> | null>(null);

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
        const res = await fetch(`${API_BASE}/admin/check`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setStatus(res.ok ? 'admin' : 'forbidden');
      } catch {
        if (!cancelled) setStatus('forbidden');
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== 'admin') return;
    let cancelled = false;
    async function loadStats() {
      try {
        const session = await authClient.getSession();
        if (!session?.data?.session) return;
        const token = session.data.session.token;
        const res = await fetch(`${API_BASE}/admin/stats`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) setStats(await res.json());
      } catch {}
    }
    loadStats();
    return () => { cancelled = true; };
  }, [status]);

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
    <AuthenticatedLayout>
      <Header>
        <TopNav links={topNav} className="me-auto" />
        <Search />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main>
        <div className="mb-2 flex items-center justify-between space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <Tabs orientation="vertical" defaultValue="overview" className="space-y-4">
          <div className="w-full overflow-x-auto pb-2">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Medias" value={stats?.medias ?? '...'} icon="film" />
              <StatCard title="Episodes" value={stats?.episodes ?? '...'} icon="clapperboard" />
              <StatCard title="Liens" value={stats?.liens ?? '...'} icon="link" />
              <StatCard title="Jobs en attente" value={stats?.pendingJobs ?? '...'} icon="briefcase" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
              <Card className="col-span-1 lg:col-span-4">
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent className="ps-2">
                  <Overview />
                </CardContent>
              </Card>
              <Card className="col-span-1 lg:col-span-3">
                <CardHeader>
                  <CardTitle>Recent Sales</CardTitle>
                  <CardDescription>You made 265 sales this month.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RecentSales />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="analytics" className="space-y-4">
            <Analytics />
          </TabsContent>
        </Tabs>
      </Main>
    </AuthenticatedLayout>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number | string; icon: string }) {
  const icons: Record<string, React.ReactNode> = {
    film: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" className="h-4 w-4 text-muted-foreground"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>,
    clapperboard: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" className="h-4 w-4 text-muted-foreground"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    link: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" className="h-4 w-4 text-muted-foreground"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    briefcase: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" className="h-4 w-4 text-muted-foreground"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icons[icon]}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

const topNav = [
  { title: 'Overview', href: '/admin', isActive: true, disabled: false },
  { title: 'Customers', href: '/admin/customers', isActive: false, disabled: true },
  { title: 'Products', href: '/admin/products', isActive: false, disabled: true },
  { title: 'Settings', href: '/admin/settings', isActive: false, disabled: true },
];
