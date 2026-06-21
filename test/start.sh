#!/usr/bin/env bash
set -e

# ═══════════════════════════════════════════════════════════
# WebMedia — Test Environment Launcher
# Démarre TOUT en local : bases, API, proxy, frontend, etc.
# ═══════════════════════════════════════════════════════════

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"

# ──────────────────────────────────────────────
# Couleurs
# ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERR]${NC}   $1"; }

# ──────────────────────────────────────────────
# Charge les variables de test
# ──────────────────────────────────────────────
set -a; source "$TEST_DIR/.env"; set +a
TURSO_DATABASE_URL="file:${TEST_DIR}/sqlite/turso.db"
D1_DATABASE_PATH="${TEST_DIR}/sqlite/d1.db"
PID_FILE="${TEST_DIR}/.pids"

cleanup() {
    info "Arrêt des services..."
    if [ -f "$PID_FILE" ]; then
        while read pid; do kill $pid 2>/dev/null; done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi
    cd "$TEST_DIR" && docker compose down 2>/dev/null || true
    ok "Tout est arrêté."
}
trap cleanup SIGINT SIGTERM EXIT

bgrun() {
    # Lance un processus en arrière-plan avec setsid + disown pour persistance
    local label="$1"; shift
    setsid "$@" > "/tmp/${label}.log" 2>&1 &
    local pid=$!
    disown $pid
    echo $pid >> "$PID_FILE"
    echo $pid
}

# ──────────────────────────────────────────────
# 1. Démarrage des bases de données (Docker)
# ──────────────────────────────────────────────
info "Démarrage PostgreSQL + Redis (Docker)..."
cd "$TEST_DIR" && docker compose up -d --wait postgres redis 2>&1 | sed 's/^/  /'
ok "Bases de données prêtes"

# ──────────────────────────────────────────────
# 2. Initialisation des schémas PostgreSQL
# ──────────────────────────────────────────────
info "Initialisation des schémas PostgreSQL..."

echo "  → Push schéma Neon (catalogue)..."
cd "$ROOT_DIR/backend"
NEON_DATABASE_URL="$NEON_DATABASE_URL" npx --yes drizzle-kit push --config neon.config.ts 2>&1 | tail -3

echo "  → Création schéma Supabase (users)..."
PGPASSWORD=postgres psql -h localhost -U postgres -d webmedia_supabase -c "
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL UNIQUE, username varchar(100) NOT NULL UNIQUE, password_hash varchar(255), avatar_url text, is_verified boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, media_id varchar(100) NOT NULL, rating integer NOT NULL, comment text, spoiler boolean DEFAULT false, likes integer DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS favorites (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, media_id varchar(100) NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS scraping_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id varchar(100) NOT NULL, media_type varchar(20) NOT NULL, worker_type varchar(20) NOT NULL DEFAULT 'cheerio', title varchar(500), slug varchar(500), status varchar(20) NOT NULL DEFAULT 'pending', priority integer DEFAULT 0, attempts integer DEFAULT 0, last_error text, locked_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
" 2>&1 | head -1

ok "Schémas PostgreSQL créés"

# ──────────────────────────────────────────────
# 3. Initialisation SQLite (Turso / D1)
# ──────────────────────────────────────────────
info "Initialisation des bases SQLite..."
mkdir -p "$TEST_DIR/sqlite"

sqlite3 "$TEST_DIR/sqlite/turso.db" "
CREATE TABLE IF NOT EXISTS medias (id text PRIMARY KEY, external_id text, type text NOT NULL, title text NOT NULL, original_title text, slug text NOT NULL UNIQUE, synopsis text, year integer, author text, poster_url text, backdrop_url text, rating text, vote_count integer DEFAULT 0, status text, tmdb_id integer, imdb_id text, anilist_id integer, mal_id integer, kitsu_id integer, igdb_id integer, anidb_id integer, metadata_source text DEFAULT 'tmdb', metadata_fresh_at integer, links_last_scraped_at integer, active_links_count integer DEFAULT 0, created_at integer, updated_at integer);
CREATE TABLE IF NOT EXISTS episodes (id text PRIMARY KEY, media_id text NOT NULL REFERENCES medias(id) ON DELETE CASCADE, season_number integer NOT NULL, episode_number integer NOT NULL, title text, synopsis text, air_date integer, thumbnail_url text, duration integer);
CREATE TABLE IF NOT EXISTS liens (id text PRIMARY KEY, media_id text NOT NULL REFERENCES medias(id) ON DELETE CASCADE, episode_id text REFERENCES episodes(id) ON DELETE CASCADE, source_site text NOT NULL, player_host text, url text NOT NULL, quality text, language text, has_subtitles integer DEFAULT 0, is_active integer DEFAULT 1, fail_count integer DEFAULT 0, last_verified integer, scraped_at integer);
"
ok "Turso initialisé"

if command -v sqlite3 &>/dev/null; then
    sqlite3 "$D1_DATABASE_PATH" < "$ROOT_DIR/backend/d1-init.sql" 2>&1 && ok "D1 initialisé"
fi

# ──────────────────────────────────────────────
# 4. Backend API (Hono Node.js sur :8787)
# ──────────────────────────────────────────────
info "Démarrage du Backend API (:8787)..."
cd "$ROOT_DIR/backend"
PID=$(bgrun "backend" env TURSO_DATABASE_URL="$TURSO_DATABASE_URL" npx tsx src/server.ts)
BACKEND_PID=$PID
sleep 4
curl -sf http://localhost:8787/ > /dev/null 2>&1 && ok "Backend API sur :8787 (PID $BACKEND_PID)" \
    || { err "Backend API ne répond pas"; cat /tmp/backend.log; exit 1; }

# ──────────────────────────────────────────────
# 5. Proxy HTTP (:8788 → :8787)
# ──────────────────────────────────────────────
info "Démarrage du Proxy HTTP (:8788)..."
cd "$TEST_DIR/proxy"
PID=$(bgrun "proxy" node index.mjs)
PROXY_PID=$PID
sleep 1
curl -sf http://localhost:8788/ > /dev/null 2>&1 && ok "Proxy sur :8788 (PID $PROXY_PID)" \
    || warn "Proxy ne répond pas"

# ──────────────────────────────────────────────
# 6. Recommender (Python FastAPI sur :7860)
# ──────────────────────────────────────────────
info "Démarrage du Recommender (:7860)..."
cd "$ROOT_DIR/recommender"
if [ ! -d venv ]; then python3 -m venv venv && source venv/bin/activate && pip install -q -r requirements.txt; fi
source venv/bin/activate
PID=$(bgrun "recommender" env NEON_API_URL="http://localhost:8787/api" python3 app.py)
RECOMMENDER_PID=$PID
deactivate
sleep 4
curl -sf http://localhost:7860/ > /dev/null 2>&1 && ok "Recommender sur :7860 (PID $RECOMMENDER_PID)" \
    || warn "Recommender ne répond pas"

# ──────────────────────────────────────────────
# 7. Frontend (Astro sur :4321)
# ──────────────────────────────────────────────
info "Démarrage du Frontend (:4321)..."
cd "$ROOT_DIR/frontend"
PID=$(bgrun "frontend" env PUBLIC_API_URL="http://localhost:8788/api" npx astro dev --host 0.0.0.0 --port 4321)
FRONTEND_PID=$PID
sleep 6
curl -sf http://localhost:4321/ > /dev/null 2>&1 && ok "Frontend sur :4321 (PID $FRONTEND_PID)" \
    || warn "Frontend ne répond pas (vérifiez le log: /tmp/frontend.log)"

# ──────────────────────────────────────────────
# Résumé
# ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            WebMedia — Environnement de Test            ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                                        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}http://localhost:4321${NC}  Frontend (Astro)              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}http://localhost:8788${NC}  Proxy → Backend              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}http://localhost:8787${NC}  Backend API (Hono)           ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}http://localhost:7860${NC}  Recommender (FastAPI)        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}localhost:5432${NC}     PostgreSQL (2 bases)          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}localhost:6379${NC}     Redis                       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${YELLOW}Flux: Frontend → :8788 → :8787 → PostgreSQL/SQLite${NC}  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Logs: /tmp/{backend,proxy,recommender,frontend}.log  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
info "Appuyez sur Ctrl+C pour tout arrêter."
wait
