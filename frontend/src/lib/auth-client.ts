import { createAuthClient } from 'better-auth/react';

const AUTH_URL = import.meta.env.PUBLIC_AUTH_URL || 'http://localhost:3000';

export const authClient = createAuthClient({
    baseURL: AUTH_URL,
    fetchOptions: {
        credentials: 'include',
    },
});

export const {
    signIn,
    signUp,
    useSession,
    signOut,
    getSession,
} = authClient;
