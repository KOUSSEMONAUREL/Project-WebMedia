import { useState, useEffect, useMemo } from 'react';
import { authClient } from '@/lib/auth-client';
import { getApiHeaders } from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { RotateCcw, Search, RefreshCw } from 'lucide-react';
import Pagination from './Pagination';

const API_BASE = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';
const API_KEY = import.meta.env.PUBLIC_API_KEY || '';
const jobsCache: { data: Job[] | null } = { data: null };

async function getToken() {
  const session = await authClient.getSession();
  return session?.data?.session?.token;
}

type Job = {
  id: string; media_id: string; media_type: string; worker_type: string;
  title: string; slug: string; status: string; priority: number;
  attempts: number; last_error: string | null;
  locked_at: string | null; created_at: string; updated_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-600',
  processing: 'bg-blue-500/10 text-blue-600',
  completed: 'bg-green-500/10 text-green-600',
  failed: 'bg-red-500/10 text-red-600',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function JobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  async function load() {
    if (jobsCache.data) {
      setJobs(jobsCache.data);
      setLoading(false);
    }
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/jobs`, {
        headers: getApiHeaders({ Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      jobsCache.data = data;
      setJobs(data);
    } catch (e) {
      console.error('load jobs', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const filtered = useMemo(() => {
    let list = jobs;
    if (statusFilter !== 'all') list = list.filter(j => j.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        j.title?.toLowerCase().includes(q) ||
        j.media_id?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [jobs, search, statusFilter]);

  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const j of jobs) s[j.status] = (s[j.status] || 0) + 1;
    return s;
  }, [jobs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleRetry(job: Job) {
    setRetrying(job.id);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/jobs/${job.id}/retry`, {
        method: 'POST',
        headers: getApiHeaders({ Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Job relance');
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'pending', attempts: 0, last_error: null, locked_at: null } : j));
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    } finally {
      setRetrying(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Chargement...</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Jobs ({jobs.length})</h1>
        <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Actualiser
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5 mb-6">
        {['pending', 'processing', 'completed', 'failed', 'cancelled'].map(s => (
          <div key={s} className="rounded-lg border p-3 text-center">
            <div className={`text-lg font-bold ${STATUS_COLORS[s]?.split(' ')[1] || ''}`}>
              {stats[s] || 0}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{s}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="flex h-10 w-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="processing">En cours</option>
          <option value="completed">Termine</option>
          <option value="failed">Echoue</option>
          <option value="cancelled">Annule</option>
        </select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Titre</TableHead>
              <TableHead className="w-[80px]">Type</TableHead>
              <TableHead className="w-[80px]">Worker</TableHead>
              <TableHead className="w-[100px]">Statut</TableHead>
              <TableHead className="w-[60px]">Tentatives</TableHead>
              <TableHead className="max-w-[200px]">Erreur</TableHead>
              <TableHead className="w-[120px]">Cree le</TableHead>
              <TableHead className="w-[80px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map(job => (
              <TableRow key={job.id}>
                <TableCell className="font-medium text-sm truncate max-w-[200px]">
                  {job.title || job.media_id?.slice(0, 8)}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{job.media_type}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{job.worker_type}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[job.status] || 'bg-muted text-muted-foreground'}`}>
                    {job.status}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{job.attempts}</TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={job.last_error || ''}>
                  {job.last_error || '-'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {job.created_at ? new Date(job.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {['failed', 'cancelled'].includes(job.status) && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRetry(job)} disabled={retrying === job.id}>
                      <RotateCcw className={`h-4 w-4 ${retrying === job.id ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">Aucun job trouve</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}
