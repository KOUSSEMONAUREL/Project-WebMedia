import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import pLimit from 'p-limit';
import { scrapingJobs } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { createLog } from './log.js';

dotenv.config();

const lncrawlBin = process.env.LNCRAWL_PATH || 'lncrawl';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const CONCURRENCY = 3;
const MAX_JOBS = 10;

const supabaseClient = postgres(process.env.SUPABASE_DATABASE_URL || '', { prepare: false });
const sb = drizzle(supabaseClient);

function jaccard(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/[\s\[\]\(\)\-:,!?']+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/[\s\[\]\(\)\-:,!?']+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersect = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersect++;
  return intersect / (wordsA.size + wordsB.size - intersect);
}

function parseLncrawlOutput(stdout: string, searchTitle: string): { url: string; site: string }[] {
  const sections: { title: string; count: number; lines: string[] }[] = [];
  let current: { title: string; count: number; lines: string[] } | null = null;
  for (const line of stdout.split('\n')) {
    const m = line.match(/^📖\s+(.+?)\s+\((\d+)\s+results\)/);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1].trim(), count: parseInt(m[2]), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  let best: typeof current = null;
  let bestScore = 0;
  for (const s of sections) {
    const score = jaccard(s.title, searchTitle);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best || bestScore <= 0.2) return [];

  const seen = new Set<string>();
  const urls: { url: string; site: string }[] = [];
  for (const line of best.lines) {
    const u = line.match(/➡\s*(https?:\/\/[^\s]+)/);
    if (u) {
      const url = u[1].replace(/\|$/, '').trim();
      if (url && !seen.has(url)) {
        seen.add(url);
        try { urls.push({ url, site: new URL(url).hostname.replace(/^www\./, '') }); } catch {}
      }
    }
  }
  return urls;
}

function runSearch(title: string, tempDir: string): Promise<{ url: string; site: string }[]> {
  return new Promise((resolve, reject) => {
    const configPath = path.join(tempDir, 'lncrawl-config.json');
    const sqlitePath = path.join(tempDir, 'isolated.db');

    fs.writeFile(configPath, JSON.stringify({
      database: { url: `sqlite:///${sqlitePath}` }
    })).then(() => {
      const env: Record<string, string> = {
        PATH: process.env.PATH || '',
        LNCRAWL_CONFIG: configPath,
        LNCRAWL_DATA_PATH: tempDir,
        COLUMNS: '9999',
      };

      const proc = spawn(lncrawlBin, ['search', title, '--timeout', '15'], {
        env, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'],
      });

      let stdout = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

      proc.on('close', (code) => {
        resolve(parseLncrawlOutput(stdout, title));
      });
      proc.on('error', reject);
    }).catch(reject);
  });
}

async function sendToIngest(mediaId: string, urls: { url: string; site: string }[]) {
  await axios.post(`${INTERNAL_API_URL}/ingest/liens`, {
    mediaId,
    links: urls.map(s => ({
      source_site: s.site,
      player_host: new URL(s.url).hostname,
      url: s.url,
      qualite: 'Novel',
      langue: 'EN',
    }))
  }, {
    headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
    timeout: 15000,
  });
}

async function processJob(job: any): Promise<void> {
  const tempDir = path.join('/tmp', `novel-worker-${job.id}`);
  let urls: { url: string; site: string }[] = [];

  try {
    await fs.mkdir(tempDir, { recursive: true });

    if (job.slug && job.slug.startsWith('http')) {
      urls.push({ url: job.slug, site: 'Source' });
    } else {
      urls = await runSearch(job.title, tempDir);
    }

    if (urls.length === 0) throw new Error('No sources found');

    await sendToIngest(job.media_id, urls);

    await sb.update(scrapingJobs)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(scrapingJobs.id, job.id));

  } catch (error: any) {
    try {
      await sb.update(scrapingJobs)
        .set({ status: 'failed', lastError: error.message || 'Unknown error', updatedAt: new Date() })
        .where(eq(scrapingJobs.id, job.id));
    } catch { /* ignore */ }
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function claimJob(): Promise<any> {
  const [job] = await supabaseClient`
    UPDATE scraping_jobs
    SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM scraping_jobs
      WHERE status = 'pending' AND worker_type = 'novel'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, media_id, media_type, title, slug, attempts
  `;
  return job || null;
}

async function runOneShot() {
  const log = createLog('Novel Worker', 'one-shot');
  log.header();

  const limit = pLimit(CONCURRENCY);
  const tasks: Promise<void>[] = [];
  let claimed = 0;

  for (let i = 0; i < MAX_JOBS; i++) {
    const job = await claimJob();
    if (!job) break;
    claimed++;

    tasks.push(limit(async () => {
      log.start(`Processing`, { title: job.title, id: job.id });
      try {
        await processJob(job);
        log.success(`Completed: ${job.title}`);
      } catch (err: any) {
        log.error(err.message);
      }
    }));
  }

  await Promise.all(tasks);
  log.summary(claimed, 0);
  process.exit(0);
}

runOneShot();
