CREATE TABLE IF NOT EXISTS watch_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    media_id VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    title TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    poster_url TEXT,
    visited_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watch_history_user_id ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_media_id ON watch_history(media_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_visited_at ON watch_history(visited_at DESC);

ALTER TABLE watch_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own history"
    ON watch_history FOR SELECT
    USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own history"
    ON watch_history FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own history"
    ON watch_history FOR DELETE
    USING (auth.uid()::text = user_id);
