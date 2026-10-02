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

const MAX_CHARS = 600;
const CACHE_TTL = 60 * 60 * 24 * 365;
const GTX_COOLDOWN_KEY = 'tr:upstream:gtx:down';
const GTX_COOLDOWN_TTL = 600;

const ENTITIES: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

function decodeEntities(input: string): string {
    return input.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

async function kvGet(c: any, key: string): Promise<string | null> {
    try {
        if (!c.env?.KV) return null;
        return await c.env.KV.get(key);
    } catch {
        return null;
    }
}

async function kvPut(c: any, key: string, value: string, ttl: number): Promise<void> {
    try {
        if (!c.env?.KV) return;
        await c.env.KV.put(key, value, { expirationTtl: ttl });
    } catch {}
}

async function viaGoogle(text: string, target: string): Promise<string> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`gtx ${res.status}`);
    const data: any = await res.json();
    if (!Array.isArray(data?.[0])) throw new Error('gtx payload');
    return data[0].map((r: any) => r?.[0] ?? '').join('');
}

async function viaMyMemory(text: string, target: string): Promise<string> {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`fr|${target}`)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`mymemory ${res.status}`);
    const data: any = await res.json();
    const out = data?.responseData?.translatedText;
    if (typeof out !== 'string' || !out.trim()) throw new Error('mymemory payload');
    if (data?.responseStatus && Number(data.responseStatus) >= 400) throw new Error('mymemory quota');
    return decodeEntities(out);
}

translate.get('/', async (c) => {
    const raw = (c.req.query('q') || '').trim();
    const lang = (c.req.query('tl') || c.req.query('lang') || '').trim();
    if (!raw) return c.json({ success: false, error: 'missing q' }, 400);
    if (raw.length > MAX_CHARS) return c.json({ success: false, error: 'q too long' }, 413);

    const text = raw;
    const target = CODES[lang] || lang;
    if (!target || target === 'fr') return c.json({ success: true, translated: text });

    const key = `tr:${target}:${text.slice(0, MAX_CHARS)}`;
    const hit = await kvGet(c, key);
    if (hit) return c.json({ success: true, translated: hit, cached: true });

    const errors: string[] = [];
    const gtxDown = await kvGet(c, GTX_COOLDOWN_KEY);

    if (!gtxDown) {
        try {
            const translated = await viaGoogle(text, target);
            if (translated.trim()) {
                await kvPut(c, key, translated, CACHE_TTL);
                return c.json({ success: true, translated, engine: 'google' });
            }
            errors.push('gtx empty');
        } catch (e: any) {
            errors.push(e?.message || 'gtx error');
            await kvPut(c, GTX_COOLDOWN_KEY, '1', GTX_COOLDOWN_TTL);
        }
    } else {
        errors.push('gtx cooldown');
    }

    try {
        const translated = await viaMyMemory(text, target);
        if (translated.trim()) {
            await kvPut(c, key, translated, CACHE_TTL);
            return c.json({ success: true, translated, engine: 'mymemory' });
        }
        errors.push('mymemory empty');
    } catch (e: any) {
        errors.push(e?.message || 'mymemory error');
    }

    return c.json({ success: false, error: errors.join(' | ') }, 502);
});

export default translate;
