import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { scrapingJobs } from './db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createLog } from './log.js';

dotenv.config();

const execPromise = promisify(exec);
const lncrawlBin = process.env.LNCRAWL_PATH || 'lncrawl';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const supabaseClient = postgres(process.env.SUPABASE_DATABASE_URL || '', { prepare: false });
const sb = drizzle(supabaseClient);

function extractUrls(text: string): string[] {
    const urls: string[] = [];
    for (const line of text.split('\n')) {
        if (line.includes('http') && !line.includes('peps.python')) {
            const match = line.match(/https?:\/\/[^\s]+/);
            if (match) urls.push(match[0]);
        }
    }
    return urls;
}

async function runSearch(title: string, tempDir: string, sqlitePath: string): Promise<string[]> {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { stdout } = await execPromise(`"${lncrawlBin}" search --timeout 30 "$TITLE"`, {
                env: {
                    PATH: process.env.PATH || '',
                    DATABASE_URL: `sqlite:///${sqlitePath}`,
                    LNCRAWL_DATA_PATH: tempDir,
                    TITLE: title,
                },
                timeout: 60000,
            });
            const urls = extractUrls(stdout);
            if (urls.length > 0) return urls;
            return [];
        } catch (err: any) {
            const partial = extractUrls(err.stdout || '');
            if (partial.length > 0) return partial;
            if (attempt === maxRetries) throw err;
            await fs.rm(sqlitePath, { force: true }).catch(() => {});
        }
    }
    return [];
}

async function processJob(job: any) {
    const tempDir = path.join('/tmp', `novel-worker-${job.id}`);
    const sqlitePath = path.join(tempDir, 'isolated.db');

    try {
        await fs.mkdir(tempDir, { recursive: true });

        let sources: { url: string; site: string }[] = [];
        if (job.slug && job.slug.startsWith('http')) {
            sources.push({ url: job.slug, site: 'Source' });
        } else {
            const urls = await runSearch(job.title, tempDir, sqlitePath);
            for (const url of urls) {
                sources.push({ url, site: 'Auto-Found' });
            }
        }

        if (sources.length === 0) throw new Error('No sources found');

        try {
            await axios.post(`${INTERNAL_API_URL}/ingest/liens`, {
                mediaId: job.mediaId,
                links: sources.map(s => ({
                    source_site: s.site,
                    player_host: new URL(s.url).hostname,
                    url: s.url,
                    qualite: 'Novel',
                    langue: 'EN'
                }))
            }, {
                headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
                timeout: 10000
            });
        } catch (axiosError: any) {
            throw axiosError;
        }

        await sb.update(scrapingJobs)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(scrapingJobs.id, job.id));

    } catch (error: any) {
        try {
            await sb.update(scrapingJobs)
                .set({ status: 'failed', lastError: error.message || 'Unknown error', updatedAt: new Date() })
                .where(eq(scrapingJobs.id, job.id));
        } catch (dbErr) {
            console.error('Fatal DB Update Error:', dbErr);
        }
        throw error;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function runOneShot() {
    const log = createLog('Novel Worker', 'one-shot');
    log.header();

    const MAX_JOBS = 10;
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < MAX_JOBS; i++) {
        try {
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

            if (!job) break;

            processed++;
            log.start(`Processing`, { title: job.title, id: job.id });
            await processJob(job);
            log.success(`Completed: ${job.title}`);
        } catch (err: any) {
            errors++;
            log.error(err.message);
        }
    }

    log.summary(processed, errors);
    process.exit(0);
}

runOneShot();
