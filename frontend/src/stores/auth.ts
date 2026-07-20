import { authClient } from '../lib/auth-client';
import type { AuthUser } from '../types';

type Listener = () => void;

function createAuthStore() {
    const listeners = new Set<Listener>();

    return {
        get user(): AuthUser | null {
            const raw = typeof window !== 'undefined' ? localStorage.getItem('webmedia_user:v1') : null;
            if (!raw) return null;
            try { return JSON.parse(raw); } catch { return null; }
        },

        setSession(user: AuthUser) {
            if (typeof window === 'undefined') return;
            localStorage.setItem('webmedia_user:v1', JSON.stringify(user));
            localStorage.setItem('webmedia_email_verified:v1', String(!!user.emailVerified));
            listeners.forEach(l => l());
        },

        isEmailVerified(): boolean {
            if (typeof window === 'undefined') return true;
            return localStorage.getItem('webmedia_email_verified:v1') !== 'false';
        },

        logout() {
            if (typeof window === 'undefined') return;
            localStorage.removeItem('webmedia_user:v1');
            localStorage.removeItem('better-auth_session_token:v1');
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
