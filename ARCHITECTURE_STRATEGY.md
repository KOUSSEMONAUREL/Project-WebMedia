# Strategic Multi-Cloud Architecture (WebMedia)

Cette stratégie vise à obtenir une infrastructure de streaming robuste, distribuée et **0€/mois** en utilisant les limites gratuites des meilleurs hébergeurs.

## 🏗️ Répartition des Services

| Service | Plateforme | Rôle | Pourquoi ? |
| :--- | :--- | :--- | :--- |
| **Backend API** | Render / Vercel | Cerveau / Ingestion | Toujours allumé, gère D1 et la logique métier. |
| **API Gateway** | Cloudflare Workers| Proxy / Cache / Vigil | Protège le backend, gère le cache Edge KV (0€). |
| **All Workers** | GitHub Actions | Scraping & Import | **0€ Illimité** (Repo Public). Pas de stockage Docker payant. |
| **Orchestrateur** | Cloudflare Workers| Cron / SQL Queue | Remplit la file d'attente Supabase toutes les 60 min. |

## 🔄 Flux de Données
1. **Orchestrateur (CF)** -> Pousse des jobs dans **Supabase (PostgreSQL)** (0-cost SQL Locking).
2. **Workers (GitHub)** -> Se lancent par intervalle (Cron), vident la file Supabase, et font un `POST` au **Backend**.
3. **Backend** -> Valide et insère dans la base de données finale (Neon).

## 🛡️ Résilience & Économie
- **GitHub Actions Execution** : Utilise le processeur de GitHub pour le travail lourd. Évite les frais d'Artifact Registry (GCP).
- **Sweep & Die Strategy** : Les workers tournent, nettoient la file d'attente, puis s'arrêtent. Consommation CPU = 0 entre deux passages.
- **Failover SQL** : Les jobs en échec sont marqués dans Supabase pour un prochain essai automatique.
