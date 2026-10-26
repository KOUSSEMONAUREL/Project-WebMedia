export function getExecutionContext(c: any): ExecutionContext | undefined {
    try {
        const ctx = c?.executionCtx;
        return ctx && typeof ctx.waitUntil === 'function' ? ctx : undefined;
    } catch {
        return undefined;
    }
}
