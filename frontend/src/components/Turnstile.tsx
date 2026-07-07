import { useRef, useCallback, useEffect } from 'react';

declare global {
    interface Window {
        turnstile?: {
            render: (container: string | HTMLElement, options: {
                sitekey: string;
                callback?: (token: string) => void;
                'expired-callback'?: () => void;
                'error-callback'?: () => void;
                theme?: 'light' | 'dark' | 'auto';
                size?: 'normal' | 'compact' | 'invisible';
                tabindex?: number;
            }) => string;
            reset: (widgetId: string) => void;
            remove: (widgetId: string) => void;
            getResponse: (widgetId: string) => string | undefined;
        };
    }
}

const SCRIPT_ID = 'cf-turnstile';
const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;

function loadScript(): Promise<void> {
    return new Promise((resolve) => {
        if (document.getElementById(SCRIPT_ID) && window.turnstile) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        document.head.appendChild(script);
    });
}

export function useTurnstile() {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const resolveRef = useRef<((token: string) => void) | null>(null);
    const tokenRef = useRef<string | null>(null);

    useEffect(() => {
        if (!SITE_KEY) return;

        let cancelled = false;

        (async () => {
            await loadScript();
            if (cancelled || !containerRef.current || !window.turnstile) return;

            if (widgetId.current) {
                window.turnstile.remove(widgetId.current);
            }

            widgetId.current = window.turnstile.render(containerRef.current, {
                sitekey: SITE_KEY,
                callback: (token: string) => {
                    tokenRef.current = token;
                    if (resolveRef.current) {
                        resolveRef.current(token);
                        resolveRef.current = null;
                    }
                },
                'expired-callback': () => {
                    tokenRef.current = null;
                },
                'error-callback': () => {
                    tokenRef.current = null;
                    if (resolveRef.current) {
                        resolveRef.current('');
                        resolveRef.current = null;
                    }
                },
            });
        })();

        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) {
                window.turnstile.remove(widgetId.current);
            }
        };
    }, []);

    const getToken = useCallback(async (): Promise<string> => {
        if (tokenRef.current) return tokenRef.current;
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            if (widgetId.current && window.turnstile) {
                window.turnstile.reset(widgetId.current);
            }
        });
    }, []);

    const reset = useCallback(() => {
        tokenRef.current = null;
        if (widgetId.current && window.turnstile) {
            window.turnstile.reset(widgetId.current);
        }
    }, []);

    return { containerRef, getToken, reset };
}

const VERIFY_URL = import.meta.env.PUBLIC_API_URL?.replace(/\/api\/?$/, '') + '/api/verify-turnstile';

export async function verifyTurnstileToken(token: string): Promise<boolean> {
    try {
        const res = await fetch(VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        const data = await res.json();
        return data.success === true;
    } catch {
        return false;
    }
}

export function TurnstileWidget() {
    const { containerRef } = useTurnstile();

    if (!SITE_KEY) return null;

    return (
        <div
            ref={containerRef}
            className="turnstile-widget"
            style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}
        />
    );
}
