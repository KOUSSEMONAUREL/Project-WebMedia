import { useEffect } from 'react';
import { createAuthClient } from 'better-auth/react';

const AUTH_URL = (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_AUTH_URL) || 'http://localhost:3000';

const API_KEY = import.meta.env.PUBLIC_API_KEY || '';

export const authClient = createAuthClient({
    baseURL: AUTH_URL,
    fetchOptions: {
        credentials: 'include',
        headers: API_KEY ? { 'X-Internal-API-Key': API_KEY } : undefined,
    },
});

export const {
    signIn,
    signUp,
    signOut,
    getSession,
    sendVerificationEmail,
    requestPasswordReset,
    resetPassword,
    changePassword,
} = authClient;

const { useSession: _useSession } = authClient;

/**
 * Hook session avec cache localStorage + stale-while-revalidate.
 * Affiche la session cachee immediatement, revalide en arriere-plan.
 * Utilise le React Query de better-auth en dessous (deduplication inter-composants).
 *
 * Securite : ne stocke en localStorage que les donnees non sensibles
 * (user id, nom, email, avatar). Le token de session reste exclusivement
 * dans le cookie httpOnly géré par better-auth (back-end Render).
 */
const USER_CACHE_KEY = 'webmedia_user_cache';
const USER_CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

interface UserProfile {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    emailVerified: boolean;
}

function readUserCache(): UserProfile | null {
    try {
        const raw = localStorage.getItem(USER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < USER_CACHE_TTL) {
            return parsed.data;
        }
    } catch { /* ignore */ }
    return null;
}

function writeUserCache(user: UserProfile) {
    try {
        const safe: UserProfile = {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image ?? null,
            emailVerified: user.emailVerified,
        };
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ data: safe, ts: Date.now() }));
    } catch { /* ignore */ }
}

export function clearUserCache() {
    try { localStorage.removeItem(USER_CACHE_KEY); } catch { /* ignore */ }
}

export function useCachedSession() {
    const cachedUser = readUserCache();
    const { data: liveData, isPending: livePending, error } = _useSession();

    const cachedSession: Session | null = cachedUser
        ? { user: cachedUser, session: null }
        : null;

    useEffect(() => {
        if (liveData?.user) {
            writeUserCache(liveData.user as UserProfile);
        } else if (!livePending) {
            clearUserCache();
        }
    }, [liveData, livePending]);

    const data = liveData ?? cachedSession;

    return {
        data,
        isPending: !cachedUser && !liveData && livePending,
        error,
    };
}

/** Récupère le token de session Bearer pour les appels cross-domain */
export async function getAuthToken(): Promise<string | null> {
    try {
        const session = await authClient.getSession();
        return session?.data?.session?.token ?? null;
    } catch {
        return null;
    }
}
