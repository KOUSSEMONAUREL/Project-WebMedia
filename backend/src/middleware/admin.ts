import { createMiddleware } from 'hono/factory';
import { getSupabaseHttpClient } from '../db/singleton';

export const adminMiddleware = createMiddleware<{
    Bindings: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };
    Variables: {
        user: { id: string; name: string; email: string } | null;
        session: { userId: string } | null;
    };
}>(async (c, next) => {
    const user = c.get('user');
    const session = c.get('session');

    if (!user || !session) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
        const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL || '';
        const supabaseKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
        if (!supabaseUrl || !supabaseKey) {
            return c.json({ error: 'Internal error' }, 500);
        }
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);
        const { data: admin } = await supabase
            .from('admin_users')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!admin) {
            return c.json({ error: 'Forbidden' }, 403);
        }
    } catch {
        return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
});
