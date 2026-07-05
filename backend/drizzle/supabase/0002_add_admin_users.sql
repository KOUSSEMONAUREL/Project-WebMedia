-- 1. Table admin_users
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
    "created_at" timestamp WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- 2. Politique : bloquer tout acces via API publique
CREATE POLICY "block_all" ON admin_users
  FOR ALL
  USING (false);

-- 3. Trouver ton user_id (a executer APRES t'etre connecte via l'app) :
-- SELECT id, email, name FROM "user";

-- 4. Ajouter ton user comme admin (remplacer <ton-user-id>) :
-- INSERT INTO admin_users (user_id) VALUES ('<ton-user-id>');
