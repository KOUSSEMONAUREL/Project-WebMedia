-- ============================================================
-- SUPABASE ROW LEVEL SECURITY (RLS) — WebMedia
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- 1. TABLE: users
-- Chaque utilisateur ne voit et ne modifie que son propre profil.
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Lecture : uniquement son propre profil
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.uid());

-- Mise à jour : uniquement ses propres données
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());

-- Insertion : le service role (backend) peut créer un user
-- → Via le backend Hono uniquement, jamais côté client
CREATE POLICY "users_insert_service_role" ON users
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Suppression : uniquement soi-même
CREATE POLICY "users_delete_own" ON users
  FOR DELETE USING (id = auth.uid());


-- ============================================================
-- 2. TABLE: reviews
-- Lecture publique, écriture/suppression limitées à l'auteur.
-- ============================================================
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Lecture : toutes les reviews sont publiques (pour affichage frontend)
CREATE POLICY "reviews_select_public" ON reviews
  FOR SELECT USING (true);

-- Insertion : uniquement si user_id correspond au JWT
CREATE POLICY "reviews_insert_own" ON reviews
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Mise à jour : uniquement l'auteur peut modifier sa review
CREATE POLICY "reviews_update_own" ON reviews
  FOR UPDATE USING (user_id = auth.uid());

-- Suppression : uniquement l'auteur
CREATE POLICY "reviews_delete_own" ON reviews
  FOR DELETE USING (user_id = auth.uid());


-- ============================================================
-- 3. TABLE: favorites
-- Complètement privé — chaque user voit seulement ses favoris.
-- ============================================================
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_select_own" ON favorites
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "favorites_insert_own" ON favorites
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "favorites_delete_own" ON favorites
  FOR DELETE USING (user_id = auth.uid());


-- ============================================================
-- INDEX MANQUANTS — performances
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reviews_media_id ON reviews(media_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_media ON reviews(user_id, media_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_status_type ON scraping_jobs(status, worker_type) WHERE status = 'pending';

-- ============================================================
-- 4. TABLES FUTURES (watch_history, watchlists, notifications)
-- À appliquer quand tu crées ces tables.
-- ============================================================

-- watch_history
-- ALTER TABLE watch_history ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "watch_history_own" ON watch_history
--   USING (user_id = auth.uid())
--   WITH CHECK (user_id = auth.uid());

-- watchlists
-- ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "watchlists_own" ON watchlists
--   USING (user_id = auth.uid())
--   WITH CHECK (user_id = auth.uid());

-- notifications
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "notifications_own" ON notifications
--   FOR SELECT USING (user_id = auth.uid());


-- ============================================================
-- MIGRATION : Ajouter password_hash si pas encore fait
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;


-- ============================================================
-- VÉRIFICATION : Lister les policies actives
-- ============================================================
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public';
