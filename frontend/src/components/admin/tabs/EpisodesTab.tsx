import { useState, useEffect, useMemo } from 'react';
import { queryLocalDb } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Edit, Trash2, Search } from 'lucide-react';
import Pagination from './Pagination';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

async function getToken() {
  const session = await authClient.getSession();
  return session?.data?.session?.token;
}

type EpisodeRow = {
  id: string; media_id: string; season_number: number; episode_number: number;
  title: string; synopsis: string; air_date: string; thumbnail_url: string;
  duration: number; media_title: string; media_type: string; media_slug: string;
};

export default function EpisodesTab() {
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<EpisodeRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EpisodeRow | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let rows = await queryLocalDb(
        `SELECT e.*, m.title as media_title, m.type as media_type, m.slug as media_slug
         FROM episodes e JOIN medias m ON e.media_id = m.id
         ORDER BY m.title, e.season_number, e.episode_number`
      );
      if (!rows) {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/admin/episodes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) rows = await res.json();
      }
      setEpisodes(rows || []);
    } catch (e) {
      console.error('load episodes', e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search) return episodes;
    const q = search.toLowerCase();
    return episodes.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.media_title?.toLowerCase().includes(q)
    );
  }, [episodes, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [search]);

  function openEdit(ep: EpisodeRow) {
    setForm({
      title: ep.title || '',
      synopsis: ep.synopsis || '',
      season_number: ep.season_number,
      episode_number: ep.episode_number,
      air_date: ep.air_date || '',
      thumbnail_url: ep.thumbnail_url || '',
      duration: ep.duration || '',
    });
    setEditTarget(ep);
  }

  async function handleSave() {
    if (!editTarget) return;
    setSaving(true);
    try {
      const token = await getToken();
      const body: any = { ...form };
      if (body.duration) body.duration = parseInt(body.duration, 10);
      if (body.season_number) body.season_number = parseInt(body.season_number, 10);
      if (body.episode_number) body.episode_number = parseInt(body.episode_number, 10);

      const res = await fetch(`${API_BASE}/admin/episodes/${editTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Episode mis a jour');
      setEditTarget(null);
      setEpisodes(prev => prev.map(ep => ep.id === editTarget.id ? { ...ep, ...body } : ep));
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
      const res = await fetch(`${API_BASE}/admin/episodes/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Episode supprime');
      setDeleteTarget(null);
      setEpisodes(prev => prev.filter(ep => ep.id !== deleteTarget.id));
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Chargement...</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Episodes ({episodes.length})</h1>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Rechercher par titre ou media..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Media</TableHead>
              <TableHead className="w-[60px]">S</TableHead>
              <TableHead className="w-[60px]">Ep</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map(ep => (
              <TableRow key={ep.id}>
                <TableCell>
                  <div className="text-sm font-medium truncate max-w-[250px]">{ep.media_title}</div>
                  <div className="text-[10px] text-muted-foreground">{ep.media_type}</div>
                </TableCell>
                <TableCell>{ep.season_number}</TableCell>
                <TableCell>{ep.episode_number}</TableCell>
                <TableCell className="max-w-[300px] truncate">{ep.title || '-'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(ep)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(ep)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {pageItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Aucun episode trouve</TableCell>
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
            <DialogTitle>Editer episode</DialogTitle>
            {editTarget && <p className="text-sm text-muted-foreground">{editTarget.media_title} - S{editTarget.season_number} Ep{editTarget.episode_number}</p>}
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Titre</label>
              <Input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Saison</label>
                <Input type="number" value={form.season_number || ''} onChange={e => setForm({ ...form, season_number: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Episode</label>
                <Input type="number" value={form.episode_number || ''} onChange={e => setForm({ ...form, episode_number: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Duree (min)</label>
                <Input type="number" value={form.duration || ''} onChange={e => setForm({ ...form, duration: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Synopsis</label>
              <textarea
                value={form.synopsis || ''}
                onChange={e => setForm({ ...form, synopsis: e.target.value })}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Thumbnail URL</label>
              <Input value={form.thumbnail_url || ''} onChange={e => setForm({ ...form, thumbnail_url: e.target.value })} />
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
            <AlertDialogTitle>Supprimer l&apos;episode ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.media_title} - S{deleteTarget?.season_number} Ep{deleteTarget?.episode_number}
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
