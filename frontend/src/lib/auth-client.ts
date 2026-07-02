import { createAuthClient } from 'better-auth/react';

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000/api';
const BETTER_AUTH_URL = API_URL.replace(/\/api$/, '');

export const authClient = createAuthClient({
    baseURL: BETTER_AUTH_URL,
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
