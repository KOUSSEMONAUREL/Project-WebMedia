import { getExecutionContext } from './context';

type MemoryEntry = {
    value: unknown;
    expiresAt: number;
};

const store = new Map<string, MemoryEntry>();
const MAX_ENTRIES = 500;

export function memoryGet<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
    }
    return entry.value as T;
}

export function memoryPut<T>(key: string, value: T, ttlSeconds: number): void {
    if (store.size >= MAX_ENTRIES && !store.has(key)) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
    }
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function runInBackground(c: any, promise: Promise<unknown>): void {
    const ctx = getExecutionContext(c);
    if (ctx) {
        ctx.waitUntil(promise);
        return;
    }
    promise.catch(() => {});
}
