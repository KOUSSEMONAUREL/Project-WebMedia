import { getStoredUser, getStoredToken, logout as authLogout } from '../services/auth';
import type { AuthUser } from '../types';

type Listener = () => void;

function createAuthStore() {
  let user: AuthUser | null = getStoredUser();
  let token: string | null = getStoredToken();
  const listeners = new Set<Listener>();

  return {
    get user() { return user; },
    get token() { return token; },
    get isAuthenticated() { return !!token && !!user; },

    setSession(newUser: AuthUser, newToken: string) {
      user = newUser;
      token = newToken;
      listeners.forEach(l => l());
    },

    logout() {
      authLogout();
      user = null;
      token = null;
      listeners.forEach(l => l());
    },

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const authStore = createAuthStore();
