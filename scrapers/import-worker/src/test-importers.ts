import { importGutenberg } from './importers/gutendex.js';
import { importOpenLibrary } from './importers/open-library.js';
import { importNosLivres } from './importers/noslivres.js';

// URL de connexion vers le conteneur Docker local
const DB_URL = "postgres://user:password@localhost:5432/webmedia_test";

async function runTests() {
    console.log("🧪 Démarrage des tests d'import locaux...");
    
    try {
        await importGutenberg(DB_URL);
        await importOpenLibrary(DB_URL, "fiction");
        await importNosLivres(DB_URL);
        console.log("✅ Tests d'import terminés.");
    } catch (e) {
        console.error("❌ Erreur pendant les tests:", e);
    }
}

runTests();
