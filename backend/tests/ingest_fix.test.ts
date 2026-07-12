import { expect, test } from 'vitest';

// Simulation de la logique de transformation appliquée dans internal.ts
const processLinks = (episodeId: string | undefined, links: any[]) => {
    return links.map(link => ({
        ...link,
        episodeId: episodeId || null,
        quality: link.qualite || null,
        language: link.langue || null
    }));
};

test('La transformation des liens convertit undefined en null correctement pour la BDD', () => {
    const episodeId = undefined;
    const links = [{ qualite: undefined, langue: undefined, url: 'https://vidsrc.me/embed/movie?tmdb=123' }];

    const processed = processLinks(episodeId, links);

    expect(processed[0].episodeId).toBe(null);
    expect(processed[0].quality).toBe(null);
    expect(processed[0].language).toBe(null);
    expect(processed[0].url).toBe('https://vidsrc.me/embed/movie?tmdb=123');
});