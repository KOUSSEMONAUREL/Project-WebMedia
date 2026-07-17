import { useRef, useCallback, useState, useEffect } from 'react';

declare global {
    interface Window {
        turnstile?: {
            render: (container: string | HTMLElement, options: {
                sitekey: string;
                callback?: (token: string) => void;
                'expired-callback'?: () => void;
                'error-callback'?: (errorCode: string) => void;
                'timeout-callback'?: () => void;
                theme?: 'light' | 'dark' | 'auto';
                size?: 'normal' | 'compact' | 'invisible';
                tabindex?: number;
                retry?: 'auto' | 'never';
                'retry-interval'?: number;
                'refresh-expired'?: 'auto' | 'manual' | 'never';
                execution?: 'render' | 'execute';
            }) => string;
            execute: (container: string | HTMLElement) => void;
            reset: (widgetId: string) => void;
            remove: (widgetId: string) => void;
            getResponse: (widgetId: string) => string | undefined;
        };
    }
}

const SCRIPT_ID = 'cf-turnstile';
const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
const LOAD_TIMEOUT = 10000;
const TOKEN_TIMEOUT = 15000;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// ── Module-level shared widget (used by both hook and direct API) ──

let sharedInit: Promise<void> | null = null;
let sharedWidgetId: string | null = null;
let sharedContainer: HTMLDivElement | null = null;
let sharedToken: string | null = null;
let sharedResolve: ((token: string) => void) | null = null;

function loadScript(): Promise<void> {
    if (document.getElementById(SCRIPT_ID) && window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.getElementById(SCRIPT_ID);
        if (existing && window.turnstile) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        const timer = setTimeout(() => {
            script.onload = null;
            script.onerror = null;
            reject(new Error('Le script Turnstile ne charge pas (timout). Verifie ton bloqueur de pubs ou reseau.'));
        }, LOAD_TIMEOUT);
        script.onload = () => {
            clearTimeout(timer);
            const check = () => {
                if (window.turnstile) resolve();
                else setTimeout(check, 50);
            };
            check();
        };
        script.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Echec de chargement du script Turnstile. Verifie ton bloqueur de pubs.'));
        };
        document.head.appendChild(script);
    });
}

function initSharedWidget() {
    if (sharedWidgetId || !window.turnstile) return;
    if (!sharedContainer) {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = '-9999px';
        div.style.top = '-9999px';
        div.className = 'turnstile-widget';
        document.body.appendChild(div);
        sharedContainer = div;
    }
    sharedWidgetId = window.turnstile.render(sharedContainer, {
        sitekey: SITE_KEY!,
        execution: 'execute',
        retry: 'never',
        'refresh-expired': 'manual',
        callback: (token: string) => {
            sharedToken = token;
            if (sharedResolve) {
                sharedResolve(token);
                sharedResolve = null;
            }
        },
        'expired-callback': () => { sharedToken = null; },
        'error-callback': () => {
            if (sharedResolve) {
                sharedResolve('');
                sharedResolve = null;
            }
            sharedToken = null;
        },
        'timeout-callback': () => {
            if (sharedResolve) {
                sharedResolve('');
                sharedResolve = null;
            }
        },
    });
}

async function ensureSharedWidget(): Promise<void> {
    if (sharedWidgetId && window.turnstile) return;
    if (!sharedInit) {
        sharedInit = loadScript().then(() => { initSharedWidget(); });
    }
    await sharedInit;
}

async function getSharedToken(): Promise<string> {
    if (sharedToken) return sharedToken;
    await ensureSharedWidget();
    if (!sharedWidgetId || !window.turnstile) return '';

    window.turnstile.execute(sharedContainer!);

    return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
            if (sharedResolve) {
                sharedResolve('');
                sharedResolve = null;
            }
            resolve('');
        }, TOKEN_TIMEOUT);

        sharedResolve = (t: string) => {
            clearTimeout(timer);
            resolve(t);
        };

        const existing = window.turnstile.getResponse(sharedWidgetId);
        if (existing) {
            clearTimeout(timer);
            sharedToken = existing;
            sharedResolve = null;
            resolve(existing);
        }
    });
}

function resetSharedWidget() {
    sharedToken = null;
    if (sharedWidgetId && window.turnstile) {
        try { window.turnstile.reset(sharedWidgetId); } catch { }
    }
}

function cleanupSharedWidget() {
    if (sharedContainer && sharedContainer.parentNode) {
        sharedContainer.parentNode.removeChild(sharedContainer);
    }
    sharedContainer = null;
    sharedWidgetId = null;
    sharedToken = null;
    sharedInit = null;
}

// ── React hook ──

export function useTurnstile() {
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
        SITE_KEY ? 'idle' : 'error'
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(
        SITE_KEY ? null : 'Cle Turnstile manquante'
    );
    const mounted = useRef(false);
    const busy = useRef(false);

    useEffect(() => {
        if (!SITE_KEY || mounted.current) return;
        mounted.current = true;
        setStatus('loading');

        loadScript()
            .then(() => {
                if (!mounted.current) return;
                setStatus('ready');
            })
            .catch((err: Error) => {
                if (!mounted.current) return;
                setStatus('error');
                setErrorMessage(err.message);
            });

        return () => {
            mounted.current = false;
        };
    }, []);

    const getToken = useCallback(async (): Promise<string> => {
        if (status === 'error') return '';
        if (busy.current) return '';
        busy.current = true;
        try {
            const token = await getSharedToken();
            return token;
        } finally {
            busy.current = false;
        }
    }, [status]);

    const reset = useCallback(() => {
        resetSharedWidget();
    }, []);

    return {
        getToken,
        reset,
        ready: status === 'ready',
        error: status === 'error',
        errorMessage,
        loading: status === 'loading',
    };
}

// ── Direct API for non-React code (sync-queue, reviews) ──

export async function getTurnstileTokenDirect(): Promise<string> {
    if (!SITE_KEY) return '';
    const token = await getSharedToken();
    return token;
}
