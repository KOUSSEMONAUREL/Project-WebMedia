import { describe, expect, test } from 'vitest';
import { planMediaStateReconcile, type ReconcileD1Row, type ReconcileMedia } from '../src/services/reconcile-state';

const media = (overrides: Partial<ReconcileMedia> = {}): ReconcileMedia => ({
    id: 'media-1',
    type: 'manga',
    title: 'Title',
    slug: 'title',
    activeLinksCount: 0,
    ...overrides,
});

const d1 = (overrides: Partial<ReconcileD1Row> = {}): ReconcileD1Row => ({
    media_id: 'media-1',
    active_links: 0,
    has_content: 0,
    ...overrides,
});

describe('planMediaStateReconcile', () => {
    test('ne planifie aucune mise a jour si les compteurs sont identiques', () => {
        expect(planMediaStateReconcile([media()], [d1()]).updates).toEqual([]);
    });

    test('planifie une mise a jour si active_links diverge', () => {
        const result = planMediaStateReconcile([media({ activeLinksCount: 3 })], [d1({ active_links: 0, has_content: 0 })]);
        expect(result.updates).toEqual([{ mediaId: 'media-1', activeLinks: 3, hasContent: 1 }]);
    });

    test('planifie une mise a jour si has_content diverge', () => {
        const result = planMediaStateReconcile([media({ activeLinksCount: 0 })], [d1({ active_links: 0, has_content: 1 })]);
        expect(result.updates).toEqual([{ mediaId: 'media-1', activeLinks: 0, hasContent: 0 }]);
    });

    test('ne retourne que les medias absents de D1', () => {
        const result = planMediaStateReconcile(
            [media(), media({ id: 'media-2' })],
            [d1()],
        );
        expect(result.missing.map(item => item.id)).toEqual(['media-2']);
        expect(result.updates).toEqual([]);
    });

    test('les mises a jour ne contiennent que active_links et has_content', () => {
        const result = planMediaStateReconcile([media({ activeLinksCount: 1 })], [d1()]);
        expect(Object.keys(result.updates[0]).sort()).toEqual(['activeLinks', 'hasContent', 'mediaId']);
    });
});
