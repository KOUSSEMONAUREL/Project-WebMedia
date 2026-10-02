import { Hono } from 'hono';

type Bindings = {
    KV: KVNamespace;
};

const translate = new Hono<{ Bindings: Bindings }>();

const CODES: Record<string, string> = {
    french: 'fr', english: 'en', spanish: 'es', german: 'de', italian: 'it',
    portuguese: 'pt', japanese: 'ja', korean: 'ko', chinese_simplified: 'zh-CN',
    russian: 'ru', arabic: 'ar', dutch: 'nl', polish: 'pl', turkish: 'tr', swedish: 'sv',
};

translate.get('/', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const lang = (c.req.query('tl') || c.req.query('lang') || '').trim();
    if (!q) return c.json({ success: false, error: 'missing q' }, 400);
    const target = CODES[lang] || lang;
    if (!target || target === 'fr') return c.json({ success: true, translated: q });

    const key = `tr:${target}:${q.slice(0, 300)}`;
    try {
        if (c.env?.KV) {
            const hit = await c.env.KV.get(key);
            if (hit) return c.json({ success: true, translated: hit, cached: true });
        }
    } catch {}

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return c.json({ success: false, error: `upstream ${res.status}` }, 502);
        const data: any = await res.json();
        const translated = Array.isArray(data?.[0])
            ? data[0].map((r: any) => r?.[0] ?? '').join('')
            : q;
        try {
            if (c.env?.KV) await c.env.KV.put(key, translated, { expirationTtl: 60 * 60 * 24 * 365 });
        } catch {}
        return c.json({ success: true, translated });
    } catch (e: any) {
        return c.json({ success: false, error: e?.message || 'translate error' }, 500);
    }
});

export default translate;
