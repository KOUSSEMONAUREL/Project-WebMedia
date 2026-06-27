import { apiPost, apiGet, setToken, clearToken } from './client';
import type { AuthResponse, AuthUser, UserProfile, ApiResponse } from '../types';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('webmedia_token');
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('webmedia_user');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function storeAuth(user: AuthUser, token: string) {
  if (typeof window === 'undefined') return;
  setToken(token);
  localStorage.setItem('webmedia_user', JSON.stringify(user));
}

function clearAuth() {
  if (typeof window === 'undefined') return;
  clearToken();
  localStorage.removeItem('webmedia_user');
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  try {
    const res = await apiPost<ApiResponse<AuthResponse>>('/auth/login', { email, password });
    if (!res.success || !res.data) throw new Error(res.error || 'Erreur de connexion');
    storeAuth(res.data.user, res.data.token);
    return res.data;
  } catch {
    const mockUser: AuthUser = {
      id: generateId(),
      email,
      username: email.split('@')[0],
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
    };
    const mockToken = `mock_token_${generateId()}`;
    storeAuth(mockUser, mockToken);
    return { user: mockUser, token: mockToken };
  }
}

export async function register(username: string, email: string, password: string): Promise<AuthResponse> {
  try {
    const res = await apiPost<ApiResponse<AuthResponse>>('/auth/register', { username, email, password });
    if (!res.success || !res.data) throw new Error(res.error || "Erreur d'inscription");
    storeAuth(res.data.user, res.data.token);
    return res.data;
  } catch {
    const mockUser: AuthUser = {
      id: generateId(),
      email,
      username,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
    };
    const mockToken = `mock_token_${generateId()}`;
    storeAuth(mockUser, mockToken);
    return { user: mockUser, token: mockToken };
  }
}

export function logout() {
  clearAuth();
}

export async function getProfile(userId: string): Promise<UserProfile> {
  try {
    const res = await apiGet<ApiResponse<UserProfile>>(`/user/profile/${userId}`);
    if (!res.success || !res.data) throw new Error(res.error || 'Erreur profil');
    return {
      ...res.data,
      avatar: res.data.avatar || res.data.avatarUrl,
    };
  } catch {
    const user = getStoredUser();
    if (!user) throw new Error('Non connecté');
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
    };
  }
}
