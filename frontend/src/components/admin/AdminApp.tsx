import { useState, useEffect } from 'react';
import { authClient } from '../../lib/auth-client';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  SidebarInset,
  SidebarProvider,
} from '../ui/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { mainNav, type Tab } from './sidebar-data';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

export default function AdminApp() {
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'admin'>('loading');
  const [tab, setTab] = useState<Tab>('dashboard');
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
    <SidebarProvider defaultOpen={true}>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="text-sm font-bold tracking-widest text-muted-foreground/60 uppercase">WebMedia</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {mainNav.map((item) => (
              <SidebarMenuItem key={item.tab}>
                <SidebarMenuButton
                  isActive={tab === item.tab}
                  onClick={() => setTab(item.tab)}
                  tooltip={item.title}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="@container/content">
        <header className="flex h-14 items-center gap-4 border-b border-border/40 px-6">
          <h1 className="text-sm font-medium">{tabLabels[tab]}</h1>
        </header>
        <main className="flex-1 p-6">
          {tab === 'dashboard' && <DashboardPage stats={stats} />}
          {tab === 'medias' && <Placeholder title="Medias" />}
          {tab === 'episodes' && <Placeholder title="Episodes" />}
          {tab === 'liens' && <Placeholder title="Liens" />}
          {tab === 'jobs' && <Placeholder title="Jobs" />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

const tabLabels: Record<Tab, string> = {
  dashboard: 'Dashboard',
  medias: 'Medias',
  episodes: 'Episodes',
  liens: 'Liens',
  jobs: 'Jobs',
};

function DashboardPage({ stats }: { stats: Record<string, number> | null }) {
  const items = [
    { label: 'Medias', value: stats?.medias ?? '...', icon: '🎬' },
    { label: 'Episodes', value: stats?.episodes ?? '...', icon: '📺' },
    { label: 'Liens', value: stats?.liens ?? '...', icon: '🔗' },
    { label: 'Jobs en attente', value: stats?.pendingJobs ?? '...', icon: '⚙️' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ label, value, icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <span className="text-lg">{icon}</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-muted-foreground/50">{title} - a venir</p>
    </div>
  );
}
