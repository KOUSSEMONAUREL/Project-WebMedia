const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyCloudflareTurnstile(token: string, secret: string): Promise<boolean> {
    if (!token || !secret) return false;
    try {
        const formData = new URLSearchParams();
        formData.append('secret', secret);
        formData.append('response', token);

        const res = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json() as { success?: boolean };
        return data.success === true;
    } catch {
        return false;
    }
}
