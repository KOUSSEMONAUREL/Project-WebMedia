# Backend WebMedia

API Backend pour la plateforme WebMedia, construite avec **Hono** et déployée sur **Cloudflare**.

## 🚀 Démarrage rapide

### Installation des dépendances

```bash
npm install
```

### Développement local

```bash
npm run dev
```

L'API sera accessible sur `http://localhost:8787`

### Déploiement sur Cloudflare

```bash
npm run deploy
```

## 📁 Structure du projet

```
backend/
├── src/
│   ├── index.ts           # Point d'entrée principal
│   ├── routes/            # Routes de l'API (media, search, auth)
│   ├── services/          # Services métier (cache, TMDB)
│   ├── db/                # Schémas DB et connexion
│   ├── middleware/        # Middlewares (auth, rate-limit)
│   └── utils/             # Utilitaires et helpers
├── package.json
├── tsconfig.json
└── wrangler.toml          # Config Cloudflare
```

## 🔧 Configuration

### Variables d'environnement (Secrets)

À définir via Wrangler CLI :

```bash
wrangler secret put JWT_SECRET
wrangler secret put TMDB_API_KEY
```

### Cloudflare KV (Cache)

```bash
wrangler kv:namespace create "KV"
```

Puis ajouter l'ID dans `wrangler.toml`.

### Cloudflare D1 (Database)

```bash
wrangler d1 create media_db
```

Puis ajouter l'ID dans `wrangler.toml`.

## 📚 Routes disponibles

- `GET /` - Health check
- `GET /api/ping` - Test de connexion
- `GET /api/media` - Liste des médias (à venir)
- `GET /api/search` - Recherche (à venir)

## 🛠 Stack technique

- **Runtime** : Cloudflare Workers
- **Framework** : Hono
- **Database** : Supabase PostgreSQL (via Drizzle ORM)
- **Cache** : Cloudflare KV
- **Auth** : JWT (Jose)
- **Validation** : Zod
