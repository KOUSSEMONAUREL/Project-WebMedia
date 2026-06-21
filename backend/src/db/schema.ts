/**
 * @deprecated Ce fichier est obsolète et n'est plus importé nulle part.
 * La source de vérité est divisée en:
 *   - backend/src/db/neon/schema.ts     → Catalogue médias (Neon)
 *   - backend/src/db/supabase/schema.ts  → Users, reviews, queue (Supabase)
 *   - backend/src/db/turso/schema.ts     → Cache edge (Turso/LibSQL)
 * 
 * Supprimer ce fichier une fois la migration confirmée.
 */
export * from './neon/schema';
