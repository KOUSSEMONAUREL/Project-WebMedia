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

dotenv.config();

const execPromise = promisify(exec);
const lncrawlBin = process.env.LNCRAWL_PATH || 'lncrawl';

// Ensure the backend is reachable
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Supabase client for jobs
const supabaseClient = postgres(process.env.SUPABASE_DATABASE_URL || '', { prepare: false });
const sb = drizzle(supabaseClient);

async function processJob(job: any) {
    console.log(`🚀 [JOB] Processing: ${job.title} (ID: ${job.id})`);
    
    const tempDir = path.join('/tmp', `novel-worker-${job.id}`);
    const sqlitePath = path.join(tempDir, 'isolated.db');

    try {
        await fs.mkdir(tempDir, { recursive: true });

        // Step 1: Search
        let sources = [];
        if (job.slug && job.slug.startsWith('http')) {
            sources.push({ url: job.slug, site: 'Source' });
        } else {
            console.log(`🔍 Searching: ${job.title}`);
            const searchCmd = `env -i PATH="${process.env.PATH}" DATABASE_URL="sqlite:///${sqlitePath}" LNCRAWL_DATA_PATH="${tempDir}" ${lncrawlBin} search "${job.title}"`;
            const { stdout } = await execPromise(searchCmd);
            
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes('http')) {
                    const match = line.match(/https?:\/\/[^\s]+/);
                    if (match) sources.push({ url: match[0], site: 'Auto-Found' });
                }
            }
        }

        if (sources.length === 0) throw new Error('No sources found');

        // Step 2: Ingest
        console.log(`📥 Ingesting to Backend API at ${INTERNAL_API_URL}...`);
        
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
            console.error('API CALL FAILED:', axiosError.message);
            if (axiosError.response) {
                console.error('API Response Data:', JSON.stringify(axiosError.response.data));
            }
            throw axiosError;
        }

        // Step 3: Success
        await sb.update(scrapingJobs)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(scrapingJobs.id, job.id));

        console.log(`✅ [JOB] Success: ${job.title}`);

    } catch (error: any) {
        console.error(`❌ [JOB] Failed: ${job.title}`);
        console.error('Full Error:', error);
        
        try {
            await sb.update(scrapingJobs)
                .set({ status: 'failed', lastError: error.message || 'Unknown error', updatedAt: new Date() })
                .where(eq(scrapingJobs.id, job.id));
        } catch (dbErr) {
            console.error('Fatal DB Update Error:', dbErr);
        }
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function runOneShot() {
    console.log('🤖 Novel Worker One-Shot Mode...');
    const MAX_JOBS = 10;
    let processed = 0;

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

            console.log(`🎯 [${processed + 1}/${MAX_JOBS}] ${job.title}`);
            await processJob(job);
            processed++;
        } catch (err: any) {
            console.error('💥 Worker Error:', err.message);
        }
    }

    console.log(`🏁 ${processed} job(s) novel traités.`);
    process.exit(0);
}

runOneShot();
