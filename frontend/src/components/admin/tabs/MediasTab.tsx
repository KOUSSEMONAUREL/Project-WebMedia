import { useState, useEffect, useMemo } from 'react';
import { getAllMedia, queryLocalDb, type Media } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
import { Edit, Trash2, Plus, Search, ExternalLink } from 'lucide-react';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

const MEDIA_TYPES = ['all', 'movie', 'serie', 'anime', 'game', 'comic', 'webtoon', 'book', 'novel'];

async function getToken() {
  const session = await authClient.getSession();
  return session?.data?.session?.token;
}

type FormData = {
  title: string; original_title: string; slug: string; type: string;
  year: string; synopsis: string; status: string; rating: string;
  genres: string; author: string; tagline: string;
  poster_url: string; backdrop_url: string;
};

const EMPTY_FORM: FormData = {
  title: '', original_title: '', slug: '', type: 'movie',
  year: '', synopsis: '', status: '', rating: '',
  genres: '', author: '', tagline: '',
  poster_url: '', backdrop_url: '',
};

export default function MediasTab() {
  const [medias, setMedias] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [editTarget, setEditTarget] = useState<Media | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Media | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMedias();
  }, []);

  async function loadMedias() {
    try {
      const data = await getAllMedia();
      setMedias(data);
    } catch (e) {
      console.error('Failed to load medias', e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let list = medias;
    if (typeFilter !== 'all') list = list.filter(m => m.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.title?.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [medias, search, typeFilter]);

  function fillForm(m: Media): FormData {
    const g = m.genres ? (Array.isArray(m.genres) ? m.genres.join(', ') : m.genres) : '';
    return {
      title: m.title || '',
      original_title: m.originalTitle || '',
      slug: m.slug || '',
      type: m.type || 'movie',
      year: m.year?.toString() || '',
      synopsis: m.synopsis || '',
      status: m.status || '',
      rating: m.rating?.toString() || '',
      genres: g,
      author: m.author || '',
      tagline: m.tagline || '',
      poster_url: m.posterUrl || '',
      backdrop_url: m.backdropUrl || '',
    };
  }

  async function handleSave(id: string) {
    setSaving(true);
    try {
      const token = await getToken();
      const body: any = { ...formData };
      if (body.year) body.year = parseInt(body.year, 10);
      if (body.rating) body.rating = parseFloat(body.rating as any);
      delete (body as any).id;

      const res = await fetch(`${API_BASE}/admin/medias/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Media mis a jour');
      setEditTarget(null);
      setMedias(prev => prev.map(m => m.id === id ? { ...m, ...body } : m));
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const token = await getToken();
      const id = crypto.randomUUID();
      const body: any = { ...formData, id };
      if (body.year) body.year = parseInt(body.year, 10);
      if (body.rating) body.rating = parseFloat(body.rating as any);

      const res = await fetch(`${API_BASE}/admin/medias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Media cree');
      setCreateOpen(false);
      setFormData(EMPTY_FORM);
      loadMedias();
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/medias/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Media supprime');
      setDeleteTarget(null);
      setMedias(prev => prev.filter(m => m.id !== id));
    } catch (e: any) {
      toast.error('Erreur: ' + e.message);
    }
  }

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of medias) {
      counts[m.type] = (counts[m.type] || 0) + 1;
    }
    return counts;
  }, [medias]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Chargement...</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Medias ({medias.length})</h1>
        <Button onClick={() => { setFormData(EMPTY_FORM); setCreateOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Ajouter
        </Button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="flex h-10 w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {MEDIA_TYPES.map(t => (
            <option key={t} value={t}>
              {t === 'all' ? 'Tous' : t} {t !== 'all' && typeCounts[t] !== undefined ? `(${typeCounts[t]})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>Titre</TableHead>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead className="w-[60px]">Annee</TableHead>
              <TableHead className="w-[60px]">Note</TableHead>
              <TableHead className="w-[100px]">Statut</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(m => (
              <TableRow key={m.id}>
                <TableCell>
                  {m.posterUrl ? (
                    <img src={m.posterUrl} alt="" className="w-8 h-11 rounded object-cover" />
                  ) : (
                    <div className="w-8 h-11 rounded bg-muted flex items-center justify-center text-[8px] text-muted-foreground">
                      {m.type?.slice(0, 2)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <div className="truncate max-w-[300px]">{m.title}</div>
                  {m.originalTitle && m.originalTitle !== m.title && (
                    <div className="text-xs text-muted-foreground truncate max-w-[300px]">{m.originalTitle}</div>
                  )}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{m.type}</Badge></TableCell>
                <TableCell className="text-muted-foreground text-sm">{m.year || '-'}</TableCell>
                <TableCell>{m.rating ? <span className="text-yellow-500 font-medium">{m.rating.toFixed(1)}</span> : '-'}</TableCell>
                <TableCell>
                  <StatusBadge status={m.status || ''} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setFormData(fillForm(m)); setEditTarget(m); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(m)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Aucun media trouve
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={o => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editer: {editTarget?.title}</DialogTitle>
          </DialogHeader>
          {editTarget && <MediaForm formData={formData} setFormData={setFormData} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
            <Button onClick={() => handleSave(editTarget!.id)} disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={o => { if (!o) setCreateOpen(false); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau media</DialogTitle>
          </DialogHeader>
          <MediaForm formData={formData} setFormData={setFormData} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Creation...' : 'Creer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le media ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irreversible. {deleteTarget?.title} et ses episodes/liens seront supprimes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDelete(deleteTarget!.id)}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MediaForm({ formData, setFormData }: { formData: FormData; setFormData: (d: FormData) => void }) {
  const set = (k: keyof FormData) => (e: any) => setFormData({ ...formData, [k]: e.target.value });
  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Titre</label>
          <Input value={formData.title} onChange={set('title')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Titre original</label>
          <Input value={formData.original_title} onChange={set('original_title')} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Slug</label>
          <Input value={formData.slug} onChange={set('slug')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Type</label>
          <select
            value={formData.type}
            onChange={set('type')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {MEDIA_TYPES.filter(t => t !== 'all').map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Annee</label>
          <Input type="number" value={formData.year} onChange={set('year')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Statut</label>
          <Input value={formData.status} onChange={set('status')} placeholder="released | ongoing | upcoming" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Note</label>
          <Input type="number" step="0.1" min="0" max="10" value={formData.rating} onChange={set('rating')} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Synopsis</label>
        <textarea
          value={formData.synopsis}
          onChange={set('synopsis')}
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Genres (separes par virgules)</label>
          <Input value={formData.genres} onChange={set('genres')} placeholder="Action, Drama, Sci-Fi" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Auteur</label>
          <Input value={formData.author} onChange={set('author')} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Tagline</label>
        <Input value={formData.tagline} onChange={set('tagline')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Poster URL</label>
          <Input value={formData.poster_url} onChange={set('poster_url')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Backdrop URL</label>
          <Input value={formData.backdrop_url} onChange={set('backdrop_url')} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    released: 'bg-green-500/10 text-green-600',
    ongoing: 'bg-blue-500/10 text-blue-600',
    upcoming: 'bg-yellow-500/10 text-yellow-600',
    cancelled: 'bg-red-500/10 text-red-600',
    unknown: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status] || map.unknown}`}>
      {status || 'unknown'}
    </span>
  );
}
