import { useState, useEffect } from 'react';
import { authClient } from '../../lib/auth-client';
import AdminLayout from './AdminLayout';

type Status = 'loading' | 'forbidden' | 'admin';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

export default function AdminDashboard() {
  const [status, setStatus] = useState<Status>('loading');

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

        if (!cancelled) {
          setStatus(res.ok ? 'admin' : 'forbidden');
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-white/40 text-sm">Verification...</div>
      </div>
    );
  }

  if (status === 'forbidden') {
    window.location.href = '/';
    return null;
  }

  return <AdminLayout />;
}
