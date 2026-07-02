import { authClient } from '../lib/auth-client';
import type { AuthUser } from '../types';

type Listener = () => void;

function createAuthStore() {
    const listeners = new Set<Listener>();

    return {
        get user(): AuthUser | null {
            const raw = typeof window !== 'undefined' ? localStorage.getItem('webmedia_user') : null;
            if (!raw) return null;
            try { return JSON.parse(raw); } catch { return null; }
        },

        setSession(user: AuthUser) {
            if (typeof window === 'undefined') return;
            localStorage.setItem('webmedia_user', JSON.stringify(user));
            listeners.forEach(l => l());
        },

        logout() {
            if (typeof window === 'undefined') return;
            localStorage.removeItem('webmedia_user');
            localStorage.removeItem('better-auth_session_token');
            authClient.signOut();
            listeners.forEach(l => l());
        },

        subscribe(listener: Listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export const authStore = createAuthStore();
