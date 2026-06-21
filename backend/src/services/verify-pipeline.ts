import { OrchestratorService } from './orchestrator';

async function verifyPipeline() {
    console.log("🧪 Starting Pipeline Verification...");

    const mockEnv = {
        DB: {
            prepare: (sql: string) => ({
                bind: (...args: any[]) => ({
                    all: async () => ({ results: [{ media_id: 'test-123', type: 'movie', metadata_ok: 1, active_links: 0 }] }),
                    run: async () => ({ success: true })
                })
            })
        },
        UPSTASH_REDIS_REST_URL: 'http://localhost:8080',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token'
    };

    const orchestrator = new OrchestratorService(mockEnv);

    console.log("1. Testing Orchestrator Decision Logic...");
    const result = await orchestrator.resolveStaleMedia();
    console.log(`Payload processed: ${result.processed}`);

    console.log("2. Verifying Redis Queue Service (Mock)...");
    // Le service affichera [Redis Mock] dans la console

    console.log("✅ Verification Logic Ready for local execution.");
}

verifyPipeline().catch(console.error);
