import { processJob } from './index_debuggable'; // Assuming we export it
import * as dotenv from 'dotenv';

dotenv.config();

const mockJob = {
    id: 'debug-123',
    mediaId: '6fe28f02-25a1-404b-b04e-a7b44640db26',
    title: 'Shadow Slave (Test)',
    slug: 'https://www.wuxiaworld.com/novel/shadow-slave'
};

async function run() {
    console.log('--- STARTING DEBUG RUN ---');
    try {
        await processJob(mockJob);
        console.log('--- DEBUG RUN SUCCESSFUL ---');
    } catch (e) {
        console.error('--- DEBUG RUN FAILED ---');
        console.error(e);
    }
}
run();
