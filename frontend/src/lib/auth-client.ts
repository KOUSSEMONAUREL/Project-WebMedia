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
    useSession,
    signOut,
    getSession,
    sendVerificationEmail,
    requestPasswordReset,
    resetPassword,
    changePassword,
} = authClient;

/** Récupère le token de session Bearer pour les appels cross-domain */
export async function getAuthToken(): Promise<string | null> {
    try {
        const session = await authClient.getSession();
        return session?.data?.session?.token ?? null;
    } catch {
        return null;
    }
}
