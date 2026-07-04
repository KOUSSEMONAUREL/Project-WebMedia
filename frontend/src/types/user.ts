export interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  emailVerified?: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface User extends AuthUser {
  passwordHash?: string;
  avatarUrl?: string;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  createdAt?: string;
}
