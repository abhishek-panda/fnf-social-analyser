# FNF Social Analyser — Setup Guide

> End-to-end setup for all three services: **feed-collector**, **embedding-service**, and **image-search**.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Structure](#2-project-structure)
3. [Environment Setup](#3-environment-setup)
4. [Services Overview](#4-services-overview)
5. [Starting the Services](#5-starting-the-services)
6. [First-Time Setup](#6-first-time-setup)
7. [Backfilling Embeddings](#7-backfilling-embeddings)
8. [API Reference](#8-api-reference)
9. [SSL on Tesco Network](#9-ssl-on-tesco-network)
10. [Switching Vision Models](#10-switching-vision-models)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 22+ | feed-collector, image-search |
| Python | 3.11+ | embedding-service |
| Docker | 24+ | PostgreSQL + Redis |
| Ollama | Latest | Local LLM for caption cleaning |
| Yarn | 1.22+ | Node.js package manager |

### Install Ollama and pull the LLM model

```bash
# Install Ollama (macOS)
brew install ollama

# Pull the caption cleaning model
ollama pull llama3.2:3b

# Start Ollama (runs on http://localhost:11434)
ollama serve
```

---

## 2. Project Structure

```
fnf-social-analyser/
├── feed-collector/       # Node.js — Instagram ingestion + embedding queue
├── embedding-service/    # Python/FastAPI — FashionCLIP/SigLIP + caption cleaning
├── image-search/         # Node.js — Product-to-post semantic search API
├── scripts/              # DB backup, restore, backfill utilities
├── media/                # Downloaded post images (gitignored)
├── docker-compose.yml    # PostgreSQL + Redis
├── .env                  # Root env file (shared by all services)
└── .env.example          # Template — copy to .env and fill in values
```

---

## 3. Environment Setup

Copy the template and fill in your values:

```bash
cp .env.example .env
```

### Key variables to fill in

```env
# Instagram Graph API
INSTAGRAM_ACCESS_TOKEN=your-long-lived-token
INSTAGRAM_BUSINESS_ACCOUNT_ID=your-business-account-id
INSTAGRAM_APP_SECRET=your-app-secret

# Media storage path
MEDIA_PATH=/absolute/path/to/fnf-social-analyser/media

# SSL (Tesco network only — see §9)
NODE_EXTRA_CA_CERTS=/absolute/path/to/fnf-social-analyser/tesco-ca.crt
```

### Ports

| Service | Variable | Default |
|---|---|---|
| feed-collector | `FEED_COLLECTOR_SERVICE_PORT` | `3000` |
| image-search | `IMAGE_SEARCH_SERVICE_PORT` | `3001` |
| embedding-service | `EMBEDDING_SERVICE_PORT` | `7002` |
| PostgreSQL | `DB_PORT` | `5432` |
| Redis | `REDIS_PORT` | `6379` |

---

## 4. Services Overview

```
┌─────────────────┐     Instagram Graph API
│  feed-collector │ ──────────────────────────► fetches posts by hashtag
│   (Node.js)     │ ──► saves to PostgreSQL
│   port: 3000    │ ──► downloads images to media/
│                 │ ──► queues embedding jobs (BullMQ → Redis)
└────────┬────────┘
         │ embed job
         ▼
┌─────────────────┐
│embedding-service│ ──► cleans caption (Ollama LLM)
│   (Python)      │ ──► generates 512-dim vector (SigLIP/FashionCLIP)
│   port: 7002    │ ──► returns embedding to consumer
└────────┬────────┘
         │ saves embedding
         ▼
┌─────────────────┐
│  PostgreSQL     │ ◄──── post_embeddings (pgvector)
│  + pgvector     │ ◄──── posts, instagram_tokens
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Tesco product (tpnb + imageUrl + caption)
│  image-search   │ ◄──────────────────────────────────────────────
│   (Node.js)     │ ──► embeds product via embedding-service
│   port: 3001    │ ──► pgvector cosine similarity search
│                 │ ──► returns matched social posts ranked by score
└─────────────────┘
```

---

## 5. Starting the Services

### Step 1 — Start PostgreSQL and Redis

```bash
docker compose up -d
```

Verify:

```bash
docker ps
# Should show: fnf_postgres, fnf_redis (or similar)
```

### Step 2 — Start embedding-service

```bash
cd embedding-service
python main.py
```

Port is read from `EMBEDDING_SERVICE_PORT` in root `.env` — no need to pass it on the command line.

On first run, the vision model will be downloaded from HuggingFace (~1–2GB). Once downloaded, set `HF_HUB_OFFLINE=1` in `.env` for faster offline startup.

Verify:

```bash
curl -s http://localhost:${EMBEDDING_SERVICE_PORT}/health | python3 -m json.tool
# Expected: { "status": "ok", "clip_model": "laion/CLIP-ViT-L-14-laion2B-s32B-b82K", ... }
```

### Step 3 — Start Ollama

```bash
ollama serve
```

### Step 4 — Start feed-collector

```bash
cd feed-collector
yarn install
yarn dev
```

Verify:

```bash
curl -s http://localhost:3000/health
# Expected: { "status": "ok", "env": "development" }
```

### Step 5 — Start image-search

```bash
cd image-search
yarn install
yarn dev
```

Verify:

```bash
curl -s http://localhost:3001/health
# Expected: { "status": "ok", "service": "image-search" }
```

---

## 6. First-Time Setup

### Install Node.js dependencies

```bash
# From repo root
cd feed-collector && yarn install
cd ../image-search && yarn install
```

### Install Python dependencies

```bash
cd embedding-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Initialise the database schema

The schema is created automatically when feed-collector starts (`db.initialise()` runs on every startup). It is idempotent — safe to run multiple times.

### Seed the Instagram token

Add your long-lived Instagram access token to `.env`:

```env
INSTAGRAM_ACCESS_TOKEN=your-token
INSTAGRAM_TOKEN_EXPIRES_AT=2026-12-01T00:00:00.000Z
```

On startup, feed-collector validates and seeds the token to the DB automatically.

To obtain a long-lived token:

```bash
# Exchange short-lived token for long-lived token
curl "https://graph.facebook.com/v24.0/oauth/access_token
  ?grant_type=ig_exchange_token
  &client_id=APP_ID
  &client_secret=APP_SECRET
  &access_token=SHORT_LIVED_TOKEN"
```

---

## 7. Backfilling Embeddings

After ingesting posts, generate embeddings for all posts that have an image and caption:

```bash
# From repo root
yarn backfill:embeddings
```

Prerequisites:
- PostgreSQL running
- embedding-service running (`python main.py` in `embedding-service/`)
- Ollama running

The script processes posts in batches of 10, sequentially. Each post:
1. Sends image path + caption to `/embed/combined`
2. embedding-service cleans the caption (Ollama) + encodes image+text (SigLIP)
3. Saves 512-dim vector to `post_embeddings` table

Progress is logged to console. Failed posts are skipped and counted in the summary.

### Re-backfilling after switching models

When you change `CLIP_MODEL_ID`, you must truncate and re-backfill:

```bash
# 1. Truncate old embeddings
docker exec -i fnf_postgres psql -U postgres -d fnf_social_analyser 
  -c "TRUNCATE TABLE post_embeddings;"

# 2. Restart embedding-service (picks up new CLIP_MODEL_ID from .env)

# 3. Re-backfill
yarn backfill:embeddings
```

---

## 8. API Reference

### feed-collector (port 3000)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/__dev/sync` | Refresh token + run ingestion cycle |
| `POST` | `/__dev/ingest` | Fire-and-forget ingestion (202) |

### embedding-service (port 7002)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — shows active model |
| `POST` | `/embed/combined` | Clean caption + embed image+text |
| `POST` | `/embed/text` | Embed text only |
| `POST` | `/embed/image` | Embed image only |
| `POST` | `/caption/clean` | Clean caption via LLM |

### image-search (port 3001)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/search` | Find social posts matching a product |

#### `POST /search` — Example

```bash
curl -s -X POST http://localhost:3001/search 
  -H "Content-Type: application/json" 
  -d '{
    "tpnb": "323951665",
    "imageUrl": "https://digitalcontent.api.tesco.com/v2/media/ghs/xxx/image.jpeg",
    "caption": "F&F Faux Leather Funnel Neck Oversized Fit Jacket in Black",
    "productUrl": "https://www.tesco.com/shop/en-GB/clothing/products/323951665"
  }' | python3 -m json.tool
```

**Response:**

```json
{
  "tpnb": "323951665",
  "total": 5,
  "matchType": "semantic",
  "posts": [
    {
      "postId": "uuid",
      "platform": "instagram",
      "url": "https://www.instagram.com/p/ABC123/",
      "caption": "...",
      "image_path": "17888291706617649.jpg",
      "published_at": "2026-09-25T11:27:38.000Z",
      "matchType": "semantic",
      "score": 0.82
    }
  ]
}
```

**Match types:**
- `direct` — post has a matching `product_id` tag or `product_url` in caption (score: 1.0)
- `semantic` — matched via pgvector cosine similarity (score: 0.0–1.0)
- `none` — no match found

---

## 9. SSL on Tesco Network

Tesco uses Zscaler to intercept HTTPS traffic and re-sign certificates with the Tesco Root CA. Without the CA bundle, all HTTPS calls fail.

### Single env var — source of truth

Set only this in root `.env`:

```env
NODE_EXTRA_CA_CERTS=/absolute/path/to/fnf-social-analyser/tesco-ca.crt
```

### Node.js services

`feed-collector` and `image-search` both use `dotenv-cli` in their `yarn dev` script (`dotenv -e ../.env -- ts-node src/index.ts`). This loads the root `.env` into the shell environment before Node.js starts, so `NODE_EXTRA_CA_CERTS` is available at process startup and appended to Node.js's built-in Mozilla CA bundle natively.

### Python embedding-service

No additional `.env` vars needed. `embedding-service/services/clip_service.py` reads `NODE_EXTRA_CA_CERTS` at runtime and programmatically sets `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` from it. Do **not** add `REQUESTS_CA_BUNDLE` or `CURL_CA_BUNDLE` to `.env` — they are derived at runtime only.

### Generating tesco-ca.crt

```bash
# Extract the full chain from Facebook (Zscaler-intercepted)
echo | openssl s_client -connect graph.facebook.com:443 -showcerts 2>/dev/null > /tmp/fullchain.txt

# Export Tesco Root CA from Mac keychain
security find-certificate -c "Tesco Root CA" -p > /tmp/tesco-root.pem

# Combine into a single PEM bundle (run python3 extraction script)
# Output: tesco-ca.crt in repo root
```

> `tesco-ca.crt` is gitignored — never commit it.
> If the cert rotates: re-extract and restart all services.

---

## 10. Switching Vision Models

Change `CLIP_MODEL_ID` in `.env` to any HuggingFace-compatible model:

| Model | ID | Notes |
|---|---|---|
| SigLIP SO400M *(default)* | `google/siglip-so400m-patch14-384` | Best colour/attribute understanding |
| SigLIP Base | `google/siglip-base-patch16-224` | Smaller, faster |
| FashionCLIP | `patrickjohncyh/fashion-clip` | Fashion-specific training |
| OpenAI CLIP ViT-L/14 | `openai/clip-vit-large-patch14` | Strong general model |

After changing the model:

1. Set `HF_HUB_OFFLINE=0` to allow download (if not cached)
2. Restart embedding-service
3. Verify: `curl http://localhost:${EMBEDDING_SERVICE_PORT}/health`
4. Truncate `post_embeddings` and re-backfill (see §7)
5. Set `HF_HUB_OFFLINE=1` after download completes

---

## 11. Troubleshooting

### `unable to get local issuer certificate`

You're on the Tesco network. Set `NODE_EXTRA_CA_CERTS` in `.env` — see §9.

### `BullMQ could not load the optional 'ioredis' package`

```bash
cd feed-collector && yarn add ioredis
```

### `extension "vector" is not available`

The `docker-compose.yml` uses `pgvector/pgvector:pg16` which includes the extension. Ensure you are using the correct image:

```bash
docker compose down -v && docker compose up -d
```

### Embedding service returns 503

Ollama is not running. Start it:

```bash
ollama serve
```

### Same search score after switching model

The post embeddings in DB were generated by the old model. Truncate and re-backfill:

```bash
docker exec -i fnf_postgres psql -U postgres -d fnf_social_analyser 
  -c "TRUNCATE TABLE post_embeddings;"
yarn backfill:embeddings
```

### DB backup and restore

```bash
# Backup
yarn db:backup

# Restore
yarn db:restore backups/fnf_backup_YYYYMMDD_HHMMSS.sql
```

---

*Last updated: September 2026*
