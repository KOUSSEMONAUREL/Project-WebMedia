import { useRef, useCallback, useState, useEffect } from 'react';

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

let scriptLoaded = false;
let widgetRendered = false;
let globalWidgetId: string | null = null;
let globalContainer: HTMLDivElement | null = null;
let globalToken: string | null = null;
let globalResolve: ((token: string) => void) | null = null;

function loadScript(): Promise<void> {
    if (scriptLoaded) return Promise.resolve();
    return new Promise((resolve) => {
        const existing = document.getElementById(SCRIPT_ID);
        if (existing && window.turnstile) {
            scriptLoaded = true;
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        script.defer = true;
        script.onload = () => {
            scriptLoaded = true;
            resolve();
        };
        document.head.appendChild(script);
    });
}

function initWidget() {
    if (widgetRendered || !window.turnstile || !globalContainer) return;
    widgetRendered = true;

    if (globalWidgetId) {
        window.turnstile.remove(globalWidgetId);
    }

    globalWidgetId = window.turnstile.render(globalContainer, {
        sitekey: SITE_KEY,
        callback: (token: string) => {
            globalToken = token;
            if (globalResolve) {
                globalResolve(token);
                globalResolve = null;
            }
        },
        'expired-callback': () => {
            globalToken = null;
        },
        'error-callback': () => {
            globalToken = null;
            if (globalResolve) {
                globalResolve('');
                globalResolve = null;
            }
        },
    });
}

export function useTurnstile() {
    const [ready, setReady] = useState(false);
    const mounted = useRef(false);

    useEffect(() => {
        if (!SITE_KEY || mounted.current) return;
        mounted.current = true;

        if (!globalContainer) {
            const div = document.createElement('div');
            div.style.position = 'absolute';
            div.style.left = '-9999px';
            div.style.top = '-9999px';
            div.className = 'turnstile-global-widget';
            document.body.appendChild(div);
            globalContainer = div;
        }

        (async () => {
            await loadScript();
            initWidget();
            setReady(true);
        })();

        return () => {
            if (globalContainer && globalContainer.parentNode) {
                globalContainer.parentNode.removeChild(globalContainer);
                globalContainer = null;
            }
            widgetRendered = false;
            if (globalWidgetId && window.turnstile) {
                window.turnstile.remove(globalWidgetId);
                globalWidgetId = null;
            }
        };
    }, []);

    const getToken = useCallback(async (): Promise<string> => {
        if (globalToken) return globalToken;
        return new Promise((resolve) => {
            globalResolve = resolve;
            if (globalWidgetId && window.turnstile) {
                window.turnstile.reset(globalWidgetId);
            }
        });
    }, []);

    const reset = useCallback(() => {
        globalToken = null;
        if (globalWidgetId && window.turnstile) {
            window.turnstile.reset(globalWidgetId);
        }
    }, []);

    return { getToken, reset, ready };
}

const VERIFY_URL = import.meta.env.PUBLIC_API_URL?.replace(/\/api\/?$/, '') + '/api/verify-turnstile';
const API_KEY = import.meta.env.PUBLIC_API_KEY || '';

export async function getTurnstileTokenDirect(): Promise<string> {
    if (globalToken) return globalToken;
    return new Promise((resolve) => {
        globalResolve = resolve;
        if (globalWidgetId && window.turnstile) {
            window.turnstile.reset(globalWidgetId);
        }
    });
}

export async function verifyTurnstileToken(token: string): Promise<boolean> {
    try {
        const res = await fetch(VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(API_KEY ? { 'X-Internal-API-Key': API_KEY } : {}),
            },
            body: JSON.stringify({ token }),
        });
        const data = await res.json();
        return data.success === true;
    } catch {
        return false;
    }
}
