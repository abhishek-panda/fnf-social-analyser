# feed-collector

> Ingests Instagram posts tagged with F&F Clothing hashtags, downloads media, and enqueues embedding jobs for semantic indexing.

---

## Responsibilities

1. **Ingestion** — polls Instagram Graph API for posts by hashtag (recent + top media) on a configurable cron schedule
2. **Deduplication** — upserts posts by `(platform, external_id)` — re-ingesting the same post is safe
3. **Media download** — downloads post images to local storage for offline embedding
4. **Embedding queue** — pushes a BullMQ job to Redis after each post is saved; the embedded result is written back to `post_embeddings`
5. **Token lifecycle** — validates, seeds, and auto-refreshes the Instagram long-lived access token

---

## Setup

```bash
cd feed-collector
yarn install
```

---

## Running

```bash
yarn dev
```

Verify:

```bash
curl -s http://localhost:3000/health
```

---

## Scheduled Tasks

| Task | Schedule | Description |
|---|---|---|
| `FeedIngestionTask (recent_media)` | Every 30 min | Fetches latest posts for each tracked hashtag |
| `FeedIngestionTask (top_media)` | Every 30 min | Fetches top-performing posts for each tracked hashtag |
| `TokenRefreshTask` | Daily midnight | Proactively refreshes the Instagram token if expiry is within 7 days |

Schedules are configurable via env vars — see [Configuration](#configuration).

---

## Dev Endpoints

> These endpoints are internal and not exposed via any production gateway.

### `POST /__dev/sync`

Refreshes the Instagram token then runs a full ingestion cycle. Useful for triggering a manual sync during development.

```bash
curl -X POST http://localhost:3000/__dev/sync
```

**Response:**

```json
{
  "tokenRefreshed": false,
  "ingestion": {
    "total": 12,
    "matched": 0
  }
}
```

### `POST /__dev/ingest`

Fire-and-forget ingestion trigger. Returns `202 Accepted` immediately while ingestion runs in the background.

```bash
curl -X POST http://localhost:3000/__dev/ingest
```

---

## Ingestion Flow

```
Instagram Graph API (hashtag search)
        │
        ▼
Fetch posts (recent_media + top_media)
        │
        ▼
Upsert to posts table (deduplicate by platform + external_id)
        │
        ▼
Download image to media/instagram/{external_id}.{ext}
        │
        ▼
Enqueue BullMQ job → Redis
        │
        ▼ (EmbeddingWorker, concurrency: 1)
POST /embed/combined → embedding-service
        │
        ▼
Save embedding to post_embeddings table
```

---

## Token Lifecycle

Instagram long-lived tokens expire after 60 days. The service manages this fully automatically:

1. On startup — token is validated via Graph API and seeded to DB from `.env`
2. If token is invalid at startup — logs a warning, skips seed (DB untouched)
3. Daily cron — checks expiry; refreshes if within `TOKEN_REFRESH_DAYS_BEFORE_EXPIRY` days
4. After refresh — new token and expiry written back to `.env` and DB

To obtain a long-lived token manually:

```bash
curl "https://graph.facebook.com/v24.0/oauth/access_token
  ?grant_type=ig_exchange_token
  &client_id=$INSTAGRAM_APP_ID
  &client_secret=$INSTAGRAM_APP_SECRET
  &access_token=SHORT_LIVED_TOKEN"
```

---

## Configuration

All configuration is read from the root `.env` file.

| Variable | Default | Description |
|---|---|---|
| `FEED_COLLECTOR_SERVICE_PORT` | `3000` | HTTP server port |
| `INSTAGRAM_ACCESS_TOKEN` | — | Long-lived Instagram access token |
| `INSTAGRAM_TOKEN_EXPIRES_AT` | — | ISO-8601 token expiry — written back automatically after refresh |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | — | Instagram Business Account ID |
| `INSTAGRAM_APP_SECRET` | — | Meta app secret — used for token exchange |
| `INSTAGRAM_API_VERSION` | `v24.0` | Instagram Graph API version |
| `INSTAGRAM_TRACKED_HASHTAGS` | `fandfclothing,fandf` | Comma-separated hashtags to track (without `#`) |
| `TOKEN_REFRESH_DAYS_BEFORE_EXPIRY` | `7` | Days before expiry to trigger proactive refresh |
| `RECENT_MEDIA_CRON_SCHEDULE` | `*/30 * * * *` | Cron for recent media ingestion |
| `TOP_MEDIA_CRON_SCHEDULE` | `*/30 * * * *` | Cron for top media ingestion |
| `TOKEN_REFRESH_CRON_SCHEDULE` | `0 0 * * *` | Cron for token refresh check |
| `MEDIA_PATH` | `./media` | Base path for downloaded media files |
| `EMBEDDING_SERVICE_URL` | `http://localhost:7002` | embedding-service base URL |
| `EMBEDDING_SERVICE_ENABLED` | `true` | Set to `false` to disable embedding at ingest time |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ |
| `REDIS_PORT` | `6379` | Redis port |
| `NODE_EXTRA_CA_CERTS` | — | Absolute path to Tesco CA cert — required on Tesco network. Loaded from root `.env` via `dotenv-cli` before process startup. |

---

## Prerequisites

- PostgreSQL running with pgvector (`docker compose up -d`)
- Redis running (`docker compose up -d`)
- embedding-service running (see `../embedding-service/`)
- Ollama running (`ollama serve`)
- Valid Instagram access token in `.env`
