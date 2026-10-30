const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const publicUrl = import.meta.env.PUBLIC_API_URL;
const authUrl = import.meta.env.PUBLIC_AUTH_URL;

if (!publicUrl || !authUrl) {
    throw new Error('PUBLIC_API_URL and PUBLIC_AUTH_URL are required');
}

export const PUBLIC_ORIGIN = trimTrailingSlashes(publicUrl);
export const AUTH_ORIGIN = trimTrailingSlashes(authUrl);
export const PUBLIC_API_BASE = `${PUBLIC_ORIGIN}/api`;
export const AUTH_API_BASE = `${AUTH_ORIGIN}/api`;
