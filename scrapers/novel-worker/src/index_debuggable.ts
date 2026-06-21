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

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Supabase client for jobs
const supabaseClient = postgres(process.env.SUPABASE_DATABASE_URL || '', { prepare: false });
const sb = drizzle(supabaseClient);

export async function processJob(job: any) {
    console.log(`🚀 [JOB] Processing novel: ${job.title} (${job.mediaId})`);
    
    const tempDir = path.join('/tmp', `novel-worker-${job.id}`);
    const sqlitePath = path.join(tempDir, 'isolated.db');

    try {
        await fs.mkdir(tempDir, { recursive: true });

        // Step 1: Search for links
        let sources = [];
        if (job.slug && job.slug.startsWith('http')) {
            sources.push({ url: job.slug, site: 'Source' });
        } else {
            console.log(`🔍 Searching for sources for: ${job.title}`);
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

        if (sources.length === 0) {
            throw new Error('No sources found');
        }

        // Step 2: Ingest links via Internal API
        console.log(`📥 Ingesting ${sources.length} links for media ${job.mediaId}`);
        
        const response = await axios.post(`${INTERNAL_API_URL}/ingest/liens`, {
            mediaId: job.mediaId,
            links: sources.map(s => ({
                source_site: s.site,
                player_host: new URL(s.url).hostname,
                url: s.url,
                qualite: 'Novel',
                langue: 'EN'
            }))
        }, {
            headers: { 'X-Internal-API-Key': INTERNAL_API_KEY }
        });
        console.log('API Response:', response.data);

        // Step 3: Mark job as completed
        await sb.update(scrapingJobs)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(scrapingJobs.id, job.id));

        console.log(`✅ [JOB] Success: ${job.title}`);

    } catch (error: any) {
        console.error(`❌ [JOB] Failed: ${job.title}`);
        console.error('Stack Trace:', error.stack); // Full trace
        if (error.response) {
            console.error('API Error Response:', error.response.data);
        }
        await sb.update(scrapingJobs)
            .set({ status: 'failed', lastError: error.message, updatedAt: new Date() })
            .where(eq(scrapingJobs.id, job.id));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function startWorker() {
    console.log('🤖 Novel Worker Polling Started...');
    
    while (true) {
        try {
            const pendingJobs = await sb.select()
                .from(scrapingJobs)
                .where(and(
                    eq(scrapingJobs.workerType, 'novel'),
                    eq(scrapingJobs.status, 'pending')
                ))
                .limit(5);

            for (const job of pendingJobs) {
                // Optimistic locking
                await sb.update(scrapingJobs)
                    .set({ status: 'processing', lockedAt: new Date() })
                    .where(eq(scrapingJobs.id, job.id));
                
                await processJob(job);
            }
        } catch (err: any) {
            console.error('💥 Worker Error:', err.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

startWorker();
