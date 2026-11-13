export type ReconcileMedia = {
    id: string;
    type: string | null;
    title: string | null;
    slug: string | null;
    activeLinksCount: number | null;
};

export type ReconcileD1Row = {
    media_id: string;
    active_links: number | null;
    has_content: number | null;
};

export type ReconcileUpdate = {
    mediaId: string;
    activeLinks: number;
    hasContent: number;
};

export function planMediaStateReconcile(neon: ReconcileMedia[], d1: ReconcileD1Row[]) {
    const d1State = new Map(d1.map(row => [row.media_id, row]));
    const missing = neon.filter(media => !d1State.has(media.id));

    const updates: ReconcileUpdate[] = [];
    for (const media of neon) {
        const current = d1State.get(media.id);
        if (!current) continue;

        const activeLinks = media.activeLinksCount || 0;
        const hasContent = activeLinks > 0 ? 1 : 0;
        if ((current.active_links || 0) === activeLinks && (current.has_content || 0) === hasContent) continue;

        updates.push({ mediaId: media.id, activeLinks, hasContent });
    }

    return { missing, updates };
}
