import { getOffset, setOffset } from './offset-tracker.js';
import { createLog } from './log.js';

export interface RateLimitConfig {
  requestsPerSecond: number;
  maxConcurrent?: number;
}

export interface ProcessContext {
  db: any;
  internalApiUrl?: string;
  internalApiKey?: string;
  databaseUrl?: string;
}

export interface FreshnessResult {
  items: any[];
  nextCheckpoint: string;
}

export interface FetchResult {
  items: any[];
  total?: number;
  hasMore?: boolean;
}

export interface FreshnessConfig {
  maxHistoryDays?: number;
  defaultCheckpointAgeMs?: number;
  fetch: (limit: number, checkpoint: string, ctx: ProcessContext) => Promise<FreshnessResult>;
  process: (items: any[], ctx: ProcessContext, log: ReturnType<typeof createLog>) => Promise<number>;
}

export interface DiscoveryConfig {
  maxPages?: number;
  advanceBy?: number;
  fetchPage: (offset: number, limit: number) => Promise<FetchResult>;
  getTotal: (result: FetchResult) => number;
  process: (items: any[], ctx: ProcessContext, log: ReturnType<typeof createLog>) => Promise<number>;
}

export interface ScannerConfig {
  key: string;
  name: string;
  rateLimit: RateLimitConfig;
  freshness?: FreshnessConfig;
  discovery: DiscoveryConfig;
  init?: (ctx: ProcessContext) => Promise<void>;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private concurrent = 0;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private readonly maxConcurrent: number;

  constructor(config: RateLimitConfig) {
    this.maxTokens = Math.max(1, config.requestsPerSecond);
    this.tokens = this.maxTokens;
    this.refillIntervalMs = 1000 / config.requestsPerSecond;
    this.maxConcurrent = config.maxConcurrent ?? 1;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    for (;;) {
      if (this.concurrent < this.maxConcurrent) {
        this.refill();
        if (this.tokens >= 1) break;
      }
      await new Promise(r => setTimeout(r, Math.max(5, this.refillIntervalMs / 2)));
    }
    this.tokens -= 1;
    this.concurrent += 1;
  }

  release(): void {
    this.concurrent -= 1;
    if (this.concurrent < 0) this.concurrent = 0;
  }

  async withAcquire<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed / this.refillIntervalMs);
    this.lastRefill = now;
  }
}

export async function runScanner(config: ScannerConfig, ctx: ProcessContext, limit: number): Promise<number> {
  const log = createLog(config.name, 'one-shot');
  const bucket = new TokenBucket(config.rateLimit);
  let total = 0;

  log.start(`Run (limit=${limit})`);

  if (config.init) {
    await config.init(ctx);
  }

  if (config.freshness) {
    const key = `${config.key}:checkpoint`;
    const maxHistoryDays = config.freshness.maxHistoryDays ?? 1;
    const defaultAge = config.freshness.defaultCheckpointAgeMs ?? 24 * 3600 * 1000;
    const defaultCheckpoint = new Date(Date.now() - defaultAge).toISOString();
    const stored = await getOffset(key, ctx.databaseUrl);
    const checkpoint = stored ? new Date(stored).toISOString() : defaultCheckpoint;

    const effectiveStart = new Date(Math.max(
      new Date(checkpoint).getTime(),
      Date.now() - maxHistoryDays * 24 * 3600 * 1000
    )).toISOString();

    try {
      const fresh = await bucket.withAcquire(() =>
        config.freshness!.fetch(limit, effectiveStart, ctx)
      );
      if (fresh.items.length > 0) {
        const inserted = await config.freshness.process(fresh.items, ctx, log);
        if (inserted > 0) log.info(`Freshness: ${inserted} updated`);
        total += inserted;
      }
      const numericTs = new Date(fresh.nextCheckpoint).getTime();
      if (!isNaN(numericTs)) {
        await setOffset(key, numericTs, ctx.databaseUrl);
      }
    } catch (err: any) {
      log.warn(`Freshness pass failed: ${err.message}`);
    }
  }

  try {
    const offset = await getOffset(config.key, ctx.databaseUrl, 0);
    const page = await bucket.withAcquire(() =>
      config.discovery.fetchPage(offset, limit)
    );
    if (!page.items || page.items.length === 0) {
      log.skip(`Discovery offset ${offset}: no items`);
    } else {
      const inserted = await config.discovery.process(page.items, ctx, log);
      total += inserted;

      const step = config.discovery.advanceBy ?? limit;
      const totalResults = config.discovery.getTotal(page);
      const nextOffset = totalResults
        ? (offset + step) % totalResults
        : offset + step;
      await setOffset(config.key, nextOffset, ctx.databaseUrl);
    }
  } catch (err: any) {
    log.error(`Discovery pass failed: ${err.message}`);
  }

  log.success(`${config.name}: ${total} total`);
  return total;
}
