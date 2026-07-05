import { useState, useEffect } from 'react';
import { authClient } from '../../lib/auth-client';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

type Stats = {
  medias: number;
  episodes: number;
  liens: number;
  pendingJobs: number;
};

export default function DashboardTab() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session = await authClient.getSession();
        if (!session?.data?.session) return;
        const token = session.data.session.token;
        const res = await fetch(`${API_BASE}/admin/stats`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          setStats(await res.json());
        }
      } catch {}
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const items = [
    { label: 'Medias', value: stats?.medias ?? '...' },
    { label: 'Episodes', value: stats?.episodes ?? '...' },
    { label: 'Liens', value: stats?.liens ?? '...' },
    { label: 'Jobs en attente', value: stats?.pendingJobs ?? '...' },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold mb-6" style="color: rgba(255,255,255,0.9);">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map(({ label, value }) => (
          <div key={label} className="rounded-xl p-4" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
            <div className="text-xs uppercase tracking-widest mb-1" style="color: rgba(255,255,255,0.35);">{label}</div>
            <div className="text-2xl font-bold" style="color: rgba(255,255,255,0.9);">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
