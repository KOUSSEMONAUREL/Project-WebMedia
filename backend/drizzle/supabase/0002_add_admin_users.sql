CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
    "created_at" timestamp WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);
