import 'dotenv/config';
import { createDbClient } from './src/db/client';

const DATABASE_URL = process.env.DIRECT_DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL non configurée dans le fichier .env');
    process.exit(1);
}

async function testConnection() {
    console.log('🔍 Test de connexion à Supabase...');

    try {
        const db = createDbClient(DATABASE_URL!, 'supabase');

        // Test simple : récupérer la version PostgreSQL
        const result = await db.execute('SELECT version()');

        console.log('✅ Connexion réussie !');
        console.log('📊 Version PostgreSQL :', Array.isArray(result) ? result[0] : result);

        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur de connexion :', error);
        console.error('\n💡 Vérifiez que :');
        console.error('  1. Votre mot de passe est correct dans backend/.env');
        console.error('  2. Votre IP est autorisée dans Supabase (ou désactiver IPv4-only)');
        process.exit(1);
    }
}

testConnection();
