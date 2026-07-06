import { useState, useEffect, useMemo } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Edit, Trash2, Search, ExternalLink } from 'lucide-react';
import Pagination from './Pagination';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

async function getToken() {
  const session = await authClient.getSession();
  return session?.data?.session?.token;
}

type LienRow = {
  id: string; media_id: string; episode_id: string | null;
  source_site: string; player_host: string; url: string;
  quality: string; language: string; has_subtitles: number;
  is_active: number; fail_count: number; last_verified: string;
  media_title: string; media_type: string;
};

export default function LiensTab() {
  const [liens, setLiens] = useState<LienRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editTarget, setEditTarget] = useState<LienRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LienRow | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let rows: LienRow[] | null = null;
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/liens`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) rows = await res.json();
      setLiens(rows || []);
    } catch (e) {
      console.error('load liens', e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let list = liens;
    if (activeFilter === 'active') list = list.filter(l => l.is_active === 1);
    else if (activeFilter === 'inactive') list = list.filter(l => l.is_active === 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.media_title?.toLowerCase().includes(q) ||
        l.source_site?.toLowerCase().includes(q) ||
        l.url?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [liens, search, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [search, activeFilter]);

  function openEdit(l: LienRow) {
    setForm({
      source_site: l.source_site || '',
      player_host: l.player_host || '',
      url: l.url || '',
      quality: l.quality || '',
      language: l.language || '',
      has_subtitles: l.has_subtitles ? 1 : 0,
      is_active: l.is_active ? 1 : 0,
    });
    setEditTarget(l);
  }

  async function handleSave() {
    if (!editTarget) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/liens/${editTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Lien mis a jour');
      setEditTarget(null);
      setLiens(prev => prev.map(l => l.id === editTarget.id ? { ...l, ...form } : l));
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/liens/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Lien supprime');
      setDeleteTarget(null);
      setLiens(prev => prev.filter(l => l.id !== deleteTarget.id));
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Chargement...</div>;
  }

  const activeCount = liens.filter(l => l.is_active === 1).length;
  const inactiveCount = liens.filter(l => l.is_active === 0).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Liens ({liens.length})</h1>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select
          value={activeFilter}
          onChange={e => setActiveFilter(e.target.value as any)}
          className="flex h-10 w-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Tous ({liens.length})</option>
          <option value="active">Actifs ({activeCount})</option>
          <option value="inactive">Inactifs ({inactiveCount})</option>
        </select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Media</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="w-[60px]">Qualite</TableHead>
              <TableHead className="w-[60px]">Langue</TableHead>
              <TableHead className="w-[60px]">Statut</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map(l => (
              <TableRow key={l.id}>
                <TableCell className="max-w-[200px] truncate text-sm">{l.media_title}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{l.source_site}</Badge></TableCell>
                <TableCell className="max-w-[250px] truncate">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs flex items-center gap-1">
                    {l.url?.slice(0, 50)}...
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </TableCell>
                <TableCell className="text-xs">{l.quality || '-'}</TableCell>
                <TableCell className="text-xs">{l.language || '-'}</TableCell>
                <TableCell>
                  {l.is_active ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600">Actif</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-600">Inactif</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(l)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(l)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {pageItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Aucun lien trouve</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={o => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editer le lien</DialogTitle>
            {editTarget && <p className="text-sm text-muted-foreground">{editTarget.media_title} - {editTarget.source_site}</p>}
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Source</label>
                <Input value={form.source_site || ''} onChange={e => setForm({ ...form, source_site: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Player</label>
                <Input value={form.player_host || ''} onChange={e => setForm({ ...form, player_host: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">URL</label>
              <Input value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Qualite</label>
                <Input value={form.quality || ''} onChange={e => setForm({ ...form, quality: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Langue</label>
                <Input value={form.language || ''} onChange={e => setForm({ ...form, language: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Sous-titres</label>
                <select
                  value={form.has_subtitles}
                  onChange={e => setForm({ ...form, has_subtitles: parseInt(e.target.value) })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value={0}>Non</option>
                  <option value={1}>Oui</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Statut</label>
              <select
                value={form.is_active}
                onChange={e => setForm({ ...form, is_active: parseInt(e.target.value) })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value={1}>Actif</option>
                <option value={0}>Inactif</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '...' : 'Enregistrer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le lien ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.source_site} - {deleteTarget?.media_title}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleDelete}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
