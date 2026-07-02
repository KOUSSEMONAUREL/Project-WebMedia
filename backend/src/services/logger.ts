export type LogLevel = 'info' | 'warn' | 'error' | 'audit';

export interface LogEntry {
    level: LogLevel;
    service: string;
    message: string;
    details?: any;
    timestamp: Date;
}

class MongodbLogger {
    private client: any = null;
    private collection: any = null;
    private isNode: boolean;
    private isWorker: boolean;

    constructor() {
        this.isNode = typeof process !== 'undefined' && !!process.versions?.node;
        this.isWorker = typeof WebSocketPair !== 'undefined';
    }

    private async connect(uri: string) {
        if (this.isWorker) return null;
        if (!this.isNode) return null; 
        if (this.collection) return this.collection;

        try {
            // Import dynamique pour éviter de casser le déploiement Cloudflare
            const { MongoClient } = await import('mongodb');
            
            this.client = new MongoClient(uri);
            await this.client.connect();
            const db = this.client.db();
            this.collection = db.collection('logs');

            // Setup TTL index (7 days retention)
            await this.collection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
            
            return this.collection;
        } catch (error) {
            console.error('❌ MongoDB Logger Connection Error:', error);
            return null;
        }
    }

    async log(level: LogLevel, service: string, message: string, details?: any, envUri?: string) {
        const timestamp = new Date();
        const entry: LogEntry = { level, service, message, details, timestamp };

        // Always console log
        const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
        console[consoleMethod](`[${level.toUpperCase()}] [${service}] ${message}`, details || '');

        if (envUri && this.isNode) {
            const collection = await this.connect(envUri);
            if (collection) {
                try {
                    const safeDetails = details ? JSON.parse(JSON.stringify(details).substring(0, 5000)) : undefined;
                    await collection.insertOne({ ...entry, details: safeDetails });
                } catch (e) {
                    console.error('[Logger] MongoDB insert failed:', e);
                }
            }
        }
    }

    async info(service: string, message: string, details?: any, envUri?: string) {
        return this.log('info', service, message, details, envUri);
    }

    async warn(service: string, message: string, details?: any, envUri?: string) {
        return this.log('warn', service, message, details, envUri);
    }

    async error(service: string, message: string, details?: any, envUri?: string) {
        return this.log('error', service, message, details, envUri);
    }

    async audit(service: string, message: string, details?: any, envUri?: string) {
        return this.log('audit', service, message, details, envUri);
    }
}

export const logger = new MongodbLogger();
