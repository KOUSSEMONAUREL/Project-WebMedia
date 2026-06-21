
import { createDbClient } from "./src/db/client";

try {
    // Utilisation d'une URL bidon pour éviter la connexion réelle
    const db = createDbClient("postgres://user:pass@localhost:5432/db", "supabase");

    console.log("--- TEST DE VERIFICATION ---");
    console.log("Type de l'objet retourné :", typeof db);
    console.log("Possède une méthode 'select' :", typeof db.select === 'function');

    if (typeof db.select === 'function') {
        console.log("✅ SUCCÈS : Le client Supabase est bien une instance Drizzle.");
    } else {
        console.error("❌ ÉCHEC : L'objet retourné n'est pas une instance Drizzle.");
    }
} catch (e) {
    console.error("Erreur lors de l'instanciation :", e);
}
