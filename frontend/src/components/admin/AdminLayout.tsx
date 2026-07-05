import { useState } from 'react';
import DashboardTab from './DashboardTab';

type Tab = 'dashboard' | 'medias' | 'episodes' | 'liens' | 'jobs';

const NAV: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'medias', label: 'Medias' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'liens', label: 'Liens' },
  { key: 'jobs', label: 'Jobs' },
];

export default function AdminLayout() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="flex min-h-screen" style="background: #0a0a0f;">
      <aside className="w-56 shrink-0 border-r" style="border-color: rgba(255,255,255,0.06); background: rgba(255,255,255,0.02);">
        <div className="p-4 border-b" style="border-color: rgba(255,255,255,0.06);">
          <h1 className="text-sm font-bold tracking-widest" style="color: rgba(255,255,255,0.5);">ADMIN</h1>
        </div>
        <nav className="p-2 space-y-1">
          {NAV.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                background: tab === key ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: tab === key ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'medias' && <Placeholder title="Medias" />}
        {tab === 'episodes' && <Placeholder title="Episodes" />}
        {tab === 'liens' && <Placeholder title="Liens" />}
        {tab === 'jobs' && <Placeholder title="Jobs" />}
      </main>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <p style="color: rgba(255,255,255,0.3);">{title} - a venir</p>
    </div>
  );
}
