export const generateEmbeds = (type: 'movie' | 'tv' | 'anime', id: string, season?: number, episode?: number) => {
    const links = [];

    if (type === 'movie') {
        links.push(
            { site: 'vidsrc', url: `https://vidsrc.me/embed/movie?tmdb=${id}`, quality: '1080p' },
            { site: 'embed.su', url: `https://embed.su/embed/movie/${id}`, quality: '1080p' },
            { site: 'multiembed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1`, quality: '1080p' },
            { site: 'ezvidapi', url: `https://ezvidapi.com/embed/movie/${id}`, quality: '1080p' }
        );
    } else if (type === 'tv' || type === 'anime') {
        const s = season || 1;
        const e = episode || 1;
        links.push(
            { site: 'vidsrc', url: `https://vidsrc.me/embed/tv?tmdb=${id}&sea=${s}&epi=${e}`, quality: '1080p' },
            { site: 'embed.su', url: `https://embed.su/embed/tv/${id}/${s}/${e}`, quality: '1080p' },
            { site: 'multiembed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`, quality: '1080p' },
            { site: 'ezvidapi', url: `https://ezvidapi.com/embed/tv/${id}/${s}/${e}`, quality: '1080p' }
        );
    }
    
    return links;
};
